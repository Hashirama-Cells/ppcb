// The dashboard's "Setup" checklist: verifies the live configuration so you can see
// at a glance whether AI replies, texting and saving actually work once deployed.
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, detectMode } from "./agent.js";
import { publicUrl } from "./config.js";
import { normalizePhone, twilioConfigured } from "./sms.js";

const ok = (label, detail) => ({ label, status: "ok", detail });
const warn = (label, detail) => ({ label, status: "warn", detail });
const bad = (label, detail) => ({ label, status: "error", detail });
const off = (label, detail) => ({ label, status: "off", detail });

async function checkAnthropic(env, makeClient) {
  const label = "AI replies";
  if (detectMode() !== "claude") return off(label, "Using scripted replies. Add ANTHROPIC_API_KEY in Render → Environment to turn on AI.");
  try {
    const client = makeClient();
    const model = await client.models.retrieve(MODEL);
    return ok(label, `Connected to Claude (${model.id}).`);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return bad(label, "Anthropic rejected the API key. Make a new key at console.anthropic.com and paste it into Render.");
    if (err instanceof Anthropic.PermissionDeniedError) return bad(label, "This API key isn't allowed to use the model. Check your Anthropic account and billing.");
    if (err instanceof Anthropic.NotFoundError) return bad(label, `Model ${MODEL} isn't available on this account. Set LEADBOT_MODEL to one that is.`);
    if (err instanceof Anthropic.RateLimitError) return warn(label, "Anthropic says you're over a rate or spend limit. Check console.anthropic.com → Billing.");
    if (err instanceof Anthropic.APIConnectionError) return warn(label, "Couldn't reach Anthropic just now. Try again in a minute.");
    return warn(label, `Unexpected answer from Anthropic: ${err.message}`);
  }
}

async function checkTwilio(env, doFetch) {
  const label = "Text messages (Twilio)";
  if (!twilioConfigured(env)) return off(label, "Off. Demos work without it. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN when you sign your first client.");
  try {
    const sid = env.TWILIO_ACCOUNT_SID;
    const res = await doFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}` },
    });
    if (res.status === 401) return bad(label, "Twilio rejected the Account SID or Auth Token. Copy them again from the Twilio console.");
    if (!res.ok) return warn(label, `Twilio answered ${res.status}.`);
    const account = await res.json();
    if (account.status && account.status !== "active") return bad(label, `Twilio account is ${account.status}.`);
    const trial = account.type === "Trial" ? " Trial account: it can only text numbers you've verified in Twilio." : "";
    return { ...ok(label, `Connected to Twilio.${trial}`), status: trial ? "warn" : "ok" };
  } catch (err) {
    return warn(label, `Couldn't reach Twilio: ${err.message}`);
  }
}

function checkStorage(env, dataFile) {
  const label = "Saving leads";
  try {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const probe = `${dataFile}.check`;
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe);
  } catch (err) {
    return bad(label, `Can't write to ${dataFile}: ${err.message}`);
  }
  if (env.RENDER && !dataFile.startsWith("/data/")) {
    return warn(label, "Saving works, but not on Render's disk, so leads are lost when the app restarts. Set DATA_FILE=/data/db.json and add a disk.");
  }
  return ok(label, "Leads and bookings are being saved.");
}

function businessLines(services) {
  return [...services.values()].map(({ business: b }) => {
    const label = b.name;
    if (b.demo === true) return off(label, "Demo: labeled as a demo, never sends texts.");
    const problems = [];
    if (!normalizePhone(b.smsNumber)) problems.push("no smsNumber (the Twilio number that texts their leads)");
    if (!normalizePhone(b.ownerPhone)) problems.push("no ownerPhone (where booking alerts go)");
    return problems.length ? warn(label, `Live client, but ${problems.join(" and ")}.`) : ok(label, `Live: texting from ${b.smsNumber}, alerts to ${b.ownerPhone}.`);
  });
}

export function createSetupChecker({ env = process.env, services, dataFile, fetch: doFetch = fetch, makeAnthropic = () => new Anthropic(), cacheMs = 5 * 60 * 1000 }) {
  let cached = null;
  return async ({ refresh = false } = {}) => {
    if (cached && !refresh && Date.now() - cached.at < cacheMs) return cached.result;
    const [ai, sms] = await Promise.all([checkAnthropic(env, makeAnthropic), checkTwilio(env, doFetch)]);
    const url = publicUrl(env);
    const result = {
      checkedAt: new Date().toISOString(),
      checks: [
        env.ADMIN_TOKEN ? ok("Dashboard password", "Set.") : warn("Dashboard password", "Not set. Fine on your own computer, required online."),
        checkStorage(env, dataFile),
        ai,
        sms,
        url ? ok("Public address", url) : off("Public address", "Not online yet (or set PUBLIC_URL)."),
      ],
      businesses: businessLines(services),
    };
    cached = { at: Date.now(), result };
    return result;
  };
}
