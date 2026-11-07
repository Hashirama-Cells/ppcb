import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Store } from "../src/store.js";
import { ScriptedAgent, ClaudeAgent } from "../src/agent.js";
import { LeadService, TooManyRequestsError } from "../src/leads.js";
import { loadBusiness, ROOT } from "../src/config.js";
import { createServer, buildServices, rateLimiter } from "../src/server.js";
import { smsAllowed, sendSms } from "../src/sms.js";

const business = loadBusiness(path.join(ROOT, "config", "businesses", "summit-plumbing.json"));
const now = () => new Date("2026-11-09T16:30:00Z");

function svc({ biz = business, agent = new ScriptedAgent(), smsEnabled = false } = {}) {
  const sent = [];
  const service = new LeadService({ store: new Store(null).forBusiness(biz.id), business: biz, agent, now, smsEnabled, sms: async (m) => { sent.push(m); return { sent: true }; } });
  return { service, sent };
}

test("a customer can only book one appointment (scripted)", async () => {
  const { service } = svc();
  const { lead } = await service.intake({ name: "Kim", phone: "5550100011" });
  await service.message(lead.id, "1");
  const again = await service.message(lead.id, "2");
  assert.match(again.reply, /To change or cancel, call us/);
  assert.equal(service.store.listBookings().length, 1);
});

test("a customer can only book one appointment (Claude tools)", async () => {
  let n = 0;
  let secondResult;
  const book = (id, slot) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name: "book_appointment", input: { slot, service: "x", notes: "" } }] });
  const client = { beta: { messages: { create: async (params) => {
    n++;
    if (n === 1) return book("t1", "2026-11-09 12:00");
    if (n === 2) return book("t2", "2026-11-09 14:00"); // tries to grab a second slot
    secondResult = params.messages.at(-1).content[0];
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Done" }] };
  } } } };
  const { service } = svc({ agent: new ClaudeAgent({ client }) });
  await service.intake({ name: "A", phone: "5550100011" });
  assert.equal(service.store.listBookings().length, 1);
  assert.equal(secondResult.is_error, true);
  assert.match(secondResult.content, /already booked/);
});

test("one phone number can't be used for endless leads", async () => {
  const { service } = svc();
  for (let i = 0; i < 3; i++) await service.intake({ name: `N${i}`, phone: "(555) 010-4444" });
  await assert.rejects(service.intake({ name: "N4", phone: "555-010-4444" }), TooManyRequestsError);
  await service.intake({ name: "Other", phone: "5550104445" }); // a different number still works
});

test("daily lead cap per business", async () => {
  const { service } = svc({ biz: { ...business, limits: { leadsPerDay: 2 } } });
  await service.intake({ name: "a", phone: "5550100001" });
  await service.intake({ name: "b", phone: "5550100002" });
  await assert.rejects(service.intake({ name: "c", phone: "5550100003" }), /call \(555\) 010-2200/);
});

test("long conversations are handed to a person and long texts are cut", async () => {
  const { service } = svc({ biz: { ...business, limits: { messagesPerLead: 2 } } });
  const { lead } = await service.intake({ name: "Chatty", phone: "5550100011" });
  await service.message(lead.id, "x".repeat(5000));
  assert.equal(lead.transcript.find((t) => t.role === "lead").text.length, 1000);
  await service.message(lead.id, "hello");
  const third = await service.message(lead.id, "hello again");
  assert.equal(third.reply, null);
  assert.equal(third.lead.status, "needs_human");
});

test("foreign numbers are not texted unless allowed", async () => {
  assert.equal(smsAllowed("+15550100011", {}), true);
  assert.equal(smsAllowed("+447700900123", {}), false);
  assert.equal(smsAllowed("+447700900123", { SMS_ALLOWED_COUNTRY_CODES: "1,44" }), true);
  let called = false;
  const r = await sendSms({ to: "+447700900123", from: "+15550100001", body: "x" }, { env: { TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" }, fetch: async () => { called = true; } });
  assert.match(r.reason, /country not allowed/);
  assert.equal(called, false);

  const { service, sent } = svc({ biz: { ...business, demo: false, smsNumber: "+15550100001" }, smsEnabled: true });
  const { lead } = await service.intake({ name: "Pump", phone: "+447700900123", smsConsent: true });
  assert.equal(lead.status, "needs_human");
  assert.match(lead.statusReason, /outside the allowed countries/);
  assert.equal(sent.length, 0); // no ownerPhone configured, and the lead isn't texted
});

test("rateLimiter allows `limit` hits per window", () => {
  let t = 0;
  const allow = rateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.deepEqual([allow("a"), allow("a"), allow("a"), allow("b")], [true, true, false, true]);
  t = 1000;
  assert.equal(allow("a"), true);
});

async function withServer(env, fn, limits) {
  const services = buildServices({ businesses: new Map([[business.id, business]]), store: new Store(null), agent: new ScriptedAgent(), notify: async () => {}, smsEnabled: false, now });
  const server = createServer({ services, defaultId: business.id, env, limits }).listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test("http: one visitor can't flood the lead form", async () => {
  await withServer({}, async (base) => {
    const post = (i) => fetch(`${base}/api/b/${business.id}/leads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x", phone: `55501000${10 + i}` }) });
    assert.equal((await post(1)).status, 201);
    assert.equal((await post(2)).status, 201);
    assert.equal((await post(3)).status, 429);
  }, { leadsPerIp: 2 });
});

test("http: dashboard needs ADMIN_TOKEN when online", async () => {
  await withServer({ NODE_ENV: "production" }, async (base) => {
    assert.equal((await fetch(`${base}/api/admin/businesses`)).status, 503);
  });
  await withServer({ ADMIN_TOKEN: "s3cret-token" }, async (base) => {
    const stats = `${base}/api/b/${business.id}/admin/stats`;
    assert.equal((await fetch(stats)).status, 401);
    assert.equal((await fetch(`${stats}?token=wrong`)).status, 401);
    assert.equal((await fetch(stats, { headers: { authorization: "Bearer s3cret-token" } })).status, 200);
    assert.equal((await fetch(`${stats}?token=s3cret-token`)).status, 200);
  });
});

test("http: incoming texts are refused when Twilio isn't set up", async () => {
  await withServer({}, async (base) => {
    const r = await fetch(`${base}/api/sms/inbound`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "From=%2B15550100011&To=%2B15550100001&Body=hi" });
    assert.equal(r.status, 503);
  });
});

test("http: no files outside public/, and safety headers are set", async () => {
  await withServer({}, async (base) => {
    for (const p of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json", "/../config/businesses/summit-plumbing.json"]) {
      const r = await fetch(base + p);
      assert.notEqual(r.status, 200, p);
    }
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  });
});
