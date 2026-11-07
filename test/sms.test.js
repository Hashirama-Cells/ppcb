import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { normalizePhone, sendSms, twilioSignature, validateTwilioSignature, ownerAlertText } from "../src/sms.js";

test("normalizePhone", () => {
  assert.equal(normalizePhone("(555) 010-2200"), "+15550102200");
  assert.equal(normalizePhone("1-555-010-2200"), "+15550102200");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("555"), null);
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(undefined), null);
});

test("sendSms posts to Twilio with basic auth", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ sid: "SM123" }) };
  };
  const env = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "secret" };
  const r = await sendSms({ to: "(555) 010-7788", from: "+15550100001", body: "Hi!" }, { env, fetch: fakeFetch });
  assert.deepEqual(r, { sent: true, sid: "SM123" });
  assert.equal(calls[0].url, "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
  assert.equal(calls[0].init.headers.authorization, `Basic ${Buffer.from("AC1:secret").toString("base64")}`);
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get("To"), "+15550107788");
  assert.equal(body.get("From"), "+15550100001");
  assert.equal(body.get("Body"), "Hi!");
});

test("sendSms does nothing when Twilio or numbers are missing", async () => {
  let called = false;
  const fakeFetch = async () => { called = true; };
  assert.equal((await sendSms({ to: "5550107788", from: "+15550100001", body: "x" }, { env: {}, fetch: fakeFetch })).sent, false);
  const env = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "s" };
  assert.match((await sendSms({ to: "5550107788", from: null, body: "x" }, { env, fetch: fakeFetch })).reason, /smsNumber/);
  assert.match((await sendSms({ to: "12", from: "+15550100001", body: "x" }, { env, fetch: fakeFetch })).reason, /invalid phone/);
  assert.equal(called, false);
});

test("sendSms reports Twilio errors without throwing", async () => {
  const fakeFetch = async () => ({ ok: false, status: 400, json: async () => ({ message: "unverified number" }) });
  const r = await sendSms({ to: "5550107788", from: "+15550100001", body: "x" }, { env: { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "s" }, fetch: fakeFetch });
  assert.deepEqual(r, { sent: false, reason: "twilio 400: unverified number" });
});

test("Twilio signature: matches the documented algorithm and rejects tampering", () => {
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  // Twilio's documented example vector.
  assert.equal(twilioSignature("12345", url, params), "0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  const expected = crypto.createHmac("sha1", "12345")
    .update(url + "CallSidCA1234567890ABCDECaller+12349013030Digits1234From+12349013030To+18005551212")
    .digest("base64");
  assert.equal(twilioSignature("12345", url, params), expected);
  assert.equal(validateTwilioSignature("12345", url, params, expected), true);
  assert.equal(validateTwilioSignature("12345", url, { ...params, Digits: "9999" }, expected), false);
  assert.equal(validateTwilioSignature("wrong", url, params, expected), false);
  assert.equal(validateTwilioSignature("12345", url, params, undefined), false);
});

test("owner alerts", () => {
  const b = { name: "Summit" };
  assert.match(ownerAlertText({ type: "booking.created", lead: { name: "Kim", phone: "555" }, booking: { service: "Leak repair", slot: "2026-11-10 08:00" } }, b), /New booking: Kim 555, Leak repair at 2026-11-10 08:00/);
  assert.match(ownerAlertText({ type: "lead.needs_human", lead: { name: "Sam" }, reason: "flooding" }, b), /Needs you: Sam\. Reason: flooding/);
  assert.equal(ownerAlertText({ type: "lead.created" }, b), null);
});
