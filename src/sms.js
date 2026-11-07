// Text messages through Twilio's REST API (no SDK needed).
// Everything here is a no-op unless TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set,
// so demos keep working without a Twilio account.
import crypto from "node:crypto";

// US-centric E.164: "(555) 010-2200" -> "+15550102200". Returns null if it can't tell.
export function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// Only text numbers in these country codes (default "1" = US/Canada). Blocks "SMS pumping",
// where attackers submit forms with expensive foreign numbers to run up your Twilio bill.
export function smsAllowed(e164, env = process.env) {
  if (!e164) return false;
  const codes = String(env.SMS_ALLOWED_COUNTRY_CODES || "1").split(",").map((c) => c.trim()).filter(Boolean);
  return codes.some((c) => e164.startsWith(`+${c}`));
}

export function twilioConfigured(env = process.env) {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
}

// Sends one SMS. Returns {sent: true, sid} or {sent: false, reason}. Never throws for "not configured".
export async function sendSms({ to, from, body }, { env = process.env, fetch: doFetch = fetch } = {}) {
  const toE164 = normalizePhone(to);
  const fromE164 = normalizePhone(from);
  if (!twilioConfigured(env)) {
    console.log(`[sms:not-configured] to ${to}: ${body}`);
    return { sent: false, reason: "twilio not configured" };
  }
  if (!fromE164) return { sent: false, reason: "business has no smsNumber" };
  if (!toE164) return { sent: false, reason: `invalid phone ${to}` };
  if (!smsAllowed(toE164, env)) return { sent: false, reason: `country not allowed for ${toE164} (see SMS_ALLOWED_COUNTRY_CODES)` };

  const sid = env.TWILIO_ACCOUNT_SID;
  const res = await doFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: toE164, From: fromE164, Body: body }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[sms:error] ${res.status} ${data.message || ""}`);
    return { sent: false, reason: `twilio ${res.status}: ${data.message || "error"}` };
  }
  return { sent: true, sid: data.sid };
}

// Twilio signs each webhook: base64(HMAC-SHA1(authToken, url + sorted(key+value)...)).
export function twilioSignature(authToken, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validateTwilioSignature(authToken, url, params, signature) {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// Short one-line alerts to the business owner's phone.
export function ownerAlertText(event, business) {
  const who = event.lead ? `${event.lead.name || "Someone"} ${event.lead.phone || ""}`.trim() : "A lead";
  switch (event.type) {
    case "booking.created":
      return `New booking: ${who}, ${event.booking.service} at ${event.booking.slot}${event.booking.address ? `, ${event.booking.address}` : ""}. (${business.name} LeadBot)`;
    case "booking.updated":
      return `Address for ${who}'s visit (${event.booking.slot}): ${event.booking.address}`;
    case "lead.needs_human":
      return `Needs you: ${who}. Reason: ${event.reason || "asked for a person"}. Please call them.`;
    case "lead.not_a_fit":
      return `Not a fit: ${who}. Reason: ${event.reason || "n/a"}.`;
    default:
      return null;
  }
}
