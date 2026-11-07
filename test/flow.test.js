import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Store } from "../src/store.js";
import { ScriptedAgent, ClaudeAgent } from "../src/agent.js";
import { LeadService } from "../src/leads.js";
import { loadBusiness, ROOT } from "../src/config.js";
import { createServer, buildServices } from "../src/server.js";

const business = loadBusiness(path.join(ROOT, "config", "businesses", "summit-plumbing.json"));
const now = () => new Date("2026-11-09T16:30:00Z"); // Monday morning in Denver

function setup(agent = new ScriptedAgent()) {
  const events = [];
  const store = new Store(null);
  const service = new LeadService({ store: store.forBusiness(business.id), business, agent, now, notify: async (e) => events.push(e), smsEnabled: false });
  return { store: service.store, service, events };
}

test("scripted: form lead gets slots, picks one, gets booked", async () => {
  const { store, service, events } = setup();
  const { lead, reply } = await service.intake({ name: "Jordan Lee", phone: "555", service: "Drain cleaning", message: "slow sink" });
  assert.match(reply, /Hi Jordan/);
  assert.match(reply, /Reply 1, 2 or 3/);
  assert.equal(lead.status, "contacted");
  assert.equal(typeof lead.firstResponseMs, "number");

  const r2 = await service.message(lead.id, "2 works");
  assert.match(r2.reply, /You're booked/);
  assert.equal(r2.lead.status, "booked");
  assert.equal(store.listBookings().length, 1);
  assert.deepEqual(events.map((e) => e.type), ["lead.created", "booking.created"]);
});

test("scripted: emergencies go to a human", async () => {
  const { service } = setup();
  const { lead, reply } = await service.intake({ name: "Sam", phone: "555", message: "basement is flooding" });
  assert.equal(lead.status, "needs_human");
  assert.match(reply, /call/i);
});

test("scripted: stop opts out and further texts are ignored", async () => {
  const { service } = setup();
  const { lead } = await service.intake({ name: "Sam", phone: "555", service: "Leak repair" });
  await service.message(lead.id, "STOP");
  const r = await service.message(lead.id, "hello?");
  assert.equal(r.lead.status, "opted_out");
  assert.equal(r.reply, null);
});

test("intake requires a way to contact the lead", async () => {
  const { service } = setup();
  await assert.rejects(service.intake({ name: "No contact" }), /phone or email/);
});

// Fake Anthropic client: asks for slots, then books the first one.
function fakeClient() {
  const calls = [];
  let n = 0;
  return {
    calls,
    beta: { messages: { create: async (params) => {
      calls.push(structuredClone(params));
      n++;
      if (n === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "get_available_slots", input: {} }] };
      if (n === 2) {
        const slot = params.messages.at(-1).content[0].content.split(" (")[0];
        return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "book_appointment", input: { slot, service: "Drain cleaning", notes: "slow sink" } }] };
      }
      return { stop_reason: "end_turn", content: [{ type: "text", text: "You're all set for Monday at noon!" }] };
    } } },
  };
}

test("claude agent: runs the tool loop and books", async () => {
  const client = fakeClient();
  const { store, service } = setup(new ClaudeAgent({ client }));
  const { lead, reply } = await service.intake({ name: "Jordan", phone: "555", service: "Drain cleaning" });
  assert.equal(reply, "You're all set for Monday at noon!");
  assert.equal(lead.status, "booked");
  assert.equal(store.listBookings()[0].slot, "2026-11-09 12:00");
  const p = client.calls[0];
  assert.equal(p.model, "claude-opus-5-5");
  assert.equal(p.fallbacks, "default");
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(client.calls[2].messages.length, 5); // user, asst, results, asst, results
});

test("claude agent: rejects a slot that isn't open", async () => {
  let n = 0;
  const client = { beta: { messages: { create: async (params) => {
    n++;
    if (n === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "book_appointment", input: { slot: "2026-11-11 03:00", service: "x", notes: "" } }] };
    const result = params.messages.at(-1).content[0];
    assert.equal(result.is_error, true);
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Let me check times." }] };
  } } } };
  const { store, service } = setup(new ClaudeAgent({ client }));
  await service.intake({ name: "A", phone: "1" });
  assert.equal(store.listBookings().length, 0);
});

test("claude agent: refusal hands off to a human and keeps history valid", async () => {
  const client = { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } };
  const { service } = setup(new ClaudeAgent({ client }));
  const { lead, reply } = await service.intake({ name: "A", phone: "1" });
  assert.equal(lead.status, "needs_human");
  assert.match(reply, /team/);
  assert.equal(lead.apiMessages.length, 0);
});

test("http: lead intake and reply endpoints", async () => {
  const store = new Store(null);
  const services = buildServices({ businesses: new Map([[business.id, business]]), store, agent: new ScriptedAgent(), notify: async () => {}, smsEnabled: false, now });
  const server = createServer({ services, defaultId: business.id, env: {} }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = `${base}/api/b/${business.id}`;
  try {
    let r = await fetch(`${base}/api/health`);
    assert.equal((await r.json()).defaultBusiness, "summit-plumbing");
    r = await fetch(`${api}/business`);
    assert.equal((await r.json()).name, business.name);
    r = await fetch(`${api}/leads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Kim", phone: "555", service: "Leak repair" }) });
    assert.equal(r.status, 201);
    const { lead } = await r.json();
    assert.equal(lead.apiMessages, undefined);
    r = await fetch(`${api}/leads/${lead.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "1" }) });
    assert.match((await r.json()).reply, /booked/);
    r = await fetch(`${api}/leads`, { method: "POST", body: "{bad" });
    assert.equal(r.status, 400);
    r = await fetch(`${api}/admin/stats`);
    assert.equal((await r.json()).booked, 1);
    r = await fetch(`${base}/api/admin/businesses`);
    assert.deepEqual((await r.json()).map((b) => b.id), ["summit-plumbing"]);
    r = await fetch(`${base}/api/b/nope/business`);
    assert.equal(r.status, 404);
  } finally {
    server.close();
  }
});
