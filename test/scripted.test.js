// Real customer conversations with the no-AI assistant.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Store } from "../src/store.js";
import { ScriptedAgent } from "../src/agent.js";
import { LeadService } from "../src/leads.js";
import { loadBusiness, ROOT } from "../src/config.js";
import { parseWhen, looksLikeAddress, cleanAddress } from "../src/scripted.js";

const load = (id) => loadBusiness(path.join(ROOT, "config", "businesses", `${id}.json`));
const roofer = load("blue-ribbon-roofing");
const plumber = load("summit-plumbing");
const now = () => new Date("2026-11-09T14:30:00Z"); // Monday 9:30 AM Eastern

async function chat(business, form = {}) {
  const events = [];
  const service = new LeadService({ store: new Store(null).forBusiness(business.id), business, agent: new ScriptedAgent(), now, smsEnabled: false, notify: async (e) => events.push(e) });
  const { lead, reply } = await service.intake({ name: "Pat Jones", phone: "9105550123", service: "Roof repair", ...form });
  const say = async (text) => (await service.message(lead.id, text)).reply;
  return { service, lead, first: reply, say, events };
}

test("answers price, area, hours and FAQ questions from the business file", async () => {
  const c = await chat(roofer);
  assert.match(await c.say("How much does a roof inspection cost?"), /^Pricing: Drone roof inspection: ask for details\. We have openings/);
  assert.match(await c.say("Do you come out to St. Pauls?"), /^We serve Fayetteville, Hope Mills, Gray's Creek, Raeford and Cumberland County\./);
  assert.match(await c.say("Do you offer financing?"), /^Financing is available for qualifying residential projects\. We have/);
  const p = await chat(plumber);
  assert.match(await p.say("what are your hours?"), /Our hours are Mon–Fri 8 AM–5 PM, Sat 9 AM–1 PM\./);
});

test("an unknown question goes to the owner instead of being ignored", async () => {
  const c = await chat(roofer);
  assert.match(await c.say("are you licensed and insured?"), /Good question\. I'll have someone from Blue Ribbon/);
  assert.equal(c.lead.status, "needs_human");
  assert.match(c.lead.statusReason, /licensed and insured/);
});

test("picks times said in plain words", async () => {
  for (const [text, slot] of [
    ["the first one works", "2026-11-09 12:00"],
    ["second", "2026-11-09 14:00"],
    ["3", "2026-11-10 08:00"],
    ["Can you do Tuesday at 10?", "2026-11-10 10:00"],
    ["what about 2pm tuesday", "2026-11-10 14:00"],
    ["tomorrow at 12:00", "2026-11-10 12:00"],
  ]) {
    const c = await chat(roofer);
    assert.match(await c.say(text), /You're booked/, text);
    assert.equal(c.service.store.listBookings()[0].slot, slot, text);
  }
});

test("offers matching times for a day or part of day, and the nearest when a time is taken", async () => {
  const c = await chat(roofer);
  assert.match(await c.say("tomorrow morning?"), /1\) Tue, Nov 10, 8:00 AM {2}2\) Tue, Nov 10, 10:00 AM\. Reply 1 or 2/);
  assert.match(await c.say("yes"), /Which time works best\? Reply 1 or 2/);
  assert.match(await c.say("2"), /You're booked for Tue, Nov 10, 10:00 AM/);
  const d = await chat(roofer);
  assert.match(await d.say("9am friday works"), /That exact time isn't open.*Fri, Nov 13, 8:00 AM.*Fri, Nov 13, 10:00 AM/);
  const e = await chat(roofer);
  assert.match(await e.say("none of those work"), /other times.*1\) Tue, Nov 10, 10:00 AM/);
});

test("a time in the form narrows the first offer", async () => {
  const c = await chat(roofer, { message: "I'm free Thursday afternoon" });
  assert.match(c.first, /1\) Thu, Nov 12, 12:00 PM {2}2\) Thu, Nov 12, 2:00 PM\. Reply 1 or 2/);
});

test("collects the address after booking and tells the owner", async () => {
  const c = await chat(roofer);
  assert.match(await c.say("2"), /What's the street address for the visit\?/);
  assert.match(await c.say("thanks!"), /What's the street address/);
  assert.equal(await c.say("123 Main St, St. Pauls"), "Got it, thanks! See you Mon, Nov 9, 2:00 PM.");
  const booking = c.service.store.listBookings()[0];
  assert.equal(booking.address, "123 Main St, St. Pauls");
  assert.ok(c.events.some((e) => e.type === "booking.updated"));
  assert.equal(await c.say("see you then"), "Great, see you Mon, Nov 9, 2:00 PM!");
});

test("uses the address from the form, or from a text before booking", async () => {
  const a = await chat(roofer, { address: "55 Oak Ln, Hope Mills" });
  assert.match(await a.say("1"), /We'll come to 55 Oak Ln, Hope Mills/);
  assert.equal(a.service.store.listBookings()[0].address, "55 Oak Ln, Hope Mills");
  const b = await chat(roofer);
  await b.say("9am friday works");
  assert.match(await b.say("it's 77 Elm Rd Raeford"), /^Thanks, got your address! We have openings: 1\) Fri, Nov 13/);
  assert.match(await b.say("1"), /We'll come to 77 Elm Rd Raeford\./);
});

test("handles a person request, cancelling, not interested and wrong number", async () => {
  const a = await chat(roofer);
  assert.match(await a.say("Can I just talk to someone?"), /I've asked someone from Blue Ribbon .* to call you at 9105550123/);
  assert.equal(a.lead.status, "needs_human");
  const b = await chat(roofer);
  await b.say("1");
  assert.match(await b.say("actually I need to cancel"), /someone will call you to sort it out/);
  assert.match(b.lead.statusReason, /cancel or reschedule/);
  const c = await chat(roofer);
  assert.match(await c.say("not interested anymore, thanks"), /thanks for letting us know/);
  assert.equal(c.lead.status, "not_a_fit");
  const d = await chat(roofer);
  assert.match(await d.say("wrong number"), /won't get any more texts/);
  assert.equal(d.lead.status, "opted_out");
});

test("emergencies in the form go straight to the owner", async () => {
  const c = await chat(roofer, { message: "A tree fell on my roof last night" });
  assert.match(c.first, /That sounds urgent, Pat\. For an active leak during a storm, call \(910\) 483-7663/);
  assert.equal(c.lead.status, "needs_human");
});

test("helpers", () => {
  const b = roofer;
  const n = now();
  assert.deepEqual(parseWhen("tuesday at 10", b, n), { dates: ["2026-11-10"], minutes: 600, part: null });
  assert.equal(parseWhen("2 pm", b, n).minutes, 14 * 60);
  assert.equal(parseWhen("at 3", b, n).minutes, 15 * 60);
  assert.equal(parseWhen("12am", b, n).minutes, 0);
  assert.equal(parseWhen("I need 2 estimates", b, n), null);
  assert.ok(looksLikeAddress("123 Main St"));
  assert.equal(cleanAddress("I'm at 410 Pine St."), "410 Pine St");
  assert.equal(cleanAddress("it's 77 Elm Rd Raeford"), "77 Elm Rd Raeford");
  assert.ok(!looksLikeAddress("2pm"));
  assert.ok(!looksLikeAddress("2"));
});
