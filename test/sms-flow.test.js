import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Store } from "../src/store.js";
import { ScriptedAgent } from "../src/agent.js";
import { LeadService, NotFoundError } from "../src/leads.js";
import { loadBusiness, ROOT } from "../src/config.js";
import { createServer, buildServices } from "../src/server.js";
import { twilioSignature } from "../src/sms.js";

const base = loadBusiness(path.join(ROOT, "config", "businesses", "summit-plumbing.json"));
const business = { ...base, smsNumber: "+15550100001", ownerPhone: "(555) 010-9999" };
const other = { ...base, id: "other-co", name: "Other Co", smsNumber: "+15550100002", ownerPhone: null };
const now = () => new Date("2026-11-09T16:30:00Z");

function fakeSms() {
  const sent = [];
  const sms = async (m) => { sent.push(m); return { sent: true, sid: `SM${sent.length}` }; };
  return { sent, sms };
}

function service({ biz = business, store = new Store(null), smsEnabled = true } = {}) {
  const { sent, sms } = fakeSms();
  const svc = new LeadService({ store: store.forBusiness(biz.id), business: biz, agent: new ScriptedAgent(), now, sms, smsEnabled });
  return { svc, sent, store };
}

test("consenting form lead is texted; booking alerts the owner", async () => {
  const { svc, sent } = service();
  const { lead, reply } = await svc.intake({ name: "Kim", phone: "(555) 010-7788", service: "Leak repair", smsConsent: true });
  assert.equal(lead.phoneE164, "+15550107788");
  assert.deepEqual(sent[0], { to: "+15550107788", from: "+15550100001", body: reply });
  await svc.message(lead.id, "1");
  assert.equal(sent.length, 3); // offer, confirmation, owner alert
  assert.match(sent[1].body, /You're booked/);
  assert.equal(sent[2].to, "(555) 010-9999");
  assert.match(sent[2].body, /^New booking: Kim/);
});

test("form lead without consent is not texted and goes to a human", async () => {
  const { svc, sent } = service();
  const { lead } = await svc.intake({ name: "Lee", phone: "(555) 010-7788", service: "Leak repair" });
  assert.equal(lead.status, "needs_human");
  assert.match(lead.statusReason, /consent/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "(555) 010-9999");
  assert.match(sent[0].body, /Needs you: Lee/);
});

test("with SMS off, nothing is texted and leads are not flagged", async () => {
  const { svc, sent } = service({ smsEnabled: false });
  const { lead } = await svc.intake({ name: "Lee", phone: "(555) 010-7788" });
  assert.equal(lead.status, "contacted");
  assert.equal(sent.length, 0);
});

test("inbound text from a new number creates a consenting lead and replies", async () => {
  const { svc, sent } = service();
  const { lead, reply } = await svc.inboundSms({ from: "+15550107788", body: "Do you fix water heaters?" });
  assert.equal(lead.source, "sms");
  assert.equal(lead.smsConsent, true);
  assert.equal(lead.status, "contacted");
  assert.match(reply, /^Hi there, this is Riley/);
  assert.equal(sent[0].to, "+15550107788");
  // A second text continues the same lead.
  const second = await svc.inboundSms({ from: "(555) 010-7788", body: "2" });
  assert.equal(second.lead.id, lead.id);
  assert.equal(second.lead.status, "booked");
});

test("businesses on one server are kept apart", async () => {
  const store = new Store(null);
  const a = service({ store }).svc;
  const b = service({ biz: other, store }).svc;
  const la = (await a.intake({ name: "A", phone: "5550100011", smsConsent: true })).lead;
  const lb = (await b.intake({ name: "B", phone: "5550100012", smsConsent: true })).lead;
  await a.message(la.id, "1");
  await b.message(lb.id, "1"); // same slot, different business: allowed
  assert.equal(a.store.listBookings()[0].slot, b.store.listBookings()[0].slot);
  assert.equal(a.stats().leads, 1);
  assert.equal(b.stats().booked, 1);
  await assert.rejects(a.message(lb.id, "hi"), NotFoundError);
});

test("old records without a businessId belong to the default business", () => {
  const store = new Store(null, { defaultBusinessId: "summit-plumbing" });
  store.data.leads.push({ id: "old", createdAt: "2026-01-01T00:00:00Z", transcript: [] });
  assert.equal(store.forBusiness("summit-plumbing").listLeads().length, 1);
  assert.equal(store.forBusiness("other-co").listLeads().length, 0);
});

test("http: Twilio webhook checks the signature, answers TwiML and texts the reply", async () => {
  const store = new Store(null);
  const { sent, sms } = fakeSms();
  const services = buildServices({ businesses: new Map([[business.id, business], [other.id, other]]), store, agent: new ScriptedAgent(), notify: async () => {}, sms, smsEnabled: true, now });
  const env = { TWILIO_AUTH_TOKEN: "tok", PUBLIC_URL: "https://bot.example.com/" };
  const server = createServer({ services, defaultId: business.id, env }).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/sms/inbound`;
  const post = (params, signature) => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
    body: new URLSearchParams(params).toString(),
  });
  try {
    const params = { From: "+15550107788", To: "+15550100002", Body: "Need a leak fixed", MessageSid: "SM1" };
    const sig = twilioSignature("tok", "https://bot.example.com/api/sms/inbound", params);

    let r = await post(params, "bad");
    assert.equal(r.status, 403);

    r = await post(params, sig);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "text/xml");
    assert.match(await r.text(), /<Response><\/Response>/);
    await server.drain();
    assert.equal(sent.length, 1);
    assert.deepEqual([sent[0].to, sent[0].from], ["+15550107788", "+15550100002"]);
    assert.equal(services.get("other-co").store.listLeads().length, 1);
    assert.equal(services.get("summit-plumbing").store.listLeads().length, 0);

    const unknown = { ...params, To: "+15550109999" };
    r = await post(unknown, twilioSignature("tok", "https://bot.example.com/api/sms/inbound", unknown));
    assert.equal(r.status, 404);
  } finally {
    server.close();
  }
});
