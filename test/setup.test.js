import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createSetupChecker } from "../src/setup.js";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "leadbot-")), "db.json");
const services = new Map([
  ["demo-co", { business: { name: "Demo Co", demo: true } }],
  ["live-co", { business: { name: "Live Co", demo: false, smsNumber: "+15550100001", ownerPhone: null } }],
]);
const byLabel = (r, label) => r.checks.find((c) => c.label === label);
const fakeError = (Cls) => Object.assign(Object.create(Cls.prototype), { message: "x" });

async function withMode(mode, fn) {
  const before = process.env.LEADBOT_MODE;
  process.env.LEADBOT_MODE = mode;
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.LEADBOT_MODE; else process.env.LEADBOT_MODE = before;
  }
}

test("fresh local setup: scripted AI, no Twilio, saving works", async () => {
  const r = await withMode("scripted", () => createSetupChecker({ env: {}, services, dataFile: tmp() })());
  assert.equal(byLabel(r, "AI replies").status, "off");
  assert.equal(byLabel(r, "Text messages (Twilio)").status, "off");
  assert.equal(byLabel(r, "Saving leads").status, "ok");
  assert.equal(byLabel(r, "Dashboard password").status, "warn");
  assert.equal(r.businesses[0].status, "off");
  assert.match(r.businesses[1].detail, /no ownerPhone/);
});

test("AI check: working key, bad key, missing model", async () => {
  const run = (retrieve) => withMode("claude", () =>
    createSetupChecker({ env: {}, services, dataFile: tmp(), makeAnthropic: () => ({ models: { retrieve } }) })());
  assert.equal(byLabel(await run(async (id) => ({ id })), "AI replies").status, "ok");
  const badKey = byLabel(await run(async () => { throw fakeError(Anthropic.AuthenticationError); }), "AI replies");
  assert.equal(badKey.status, "error");
  assert.match(badKey.detail, /rejected the API key/);
  assert.equal(byLabel(await run(async () => { throw fakeError(Anthropic.NotFoundError); }), "AI replies").status, "error");
});

test("Twilio check: active, trial and bad credentials", async () => {
  const env = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" };
  const run = (status, body) => withMode("scripted", () => createSetupChecker({
    env, services, dataFile: tmp(),
    fetch: async (url, init) => {
      assert.equal(url, "https://api.twilio.com/2010-04-01/Accounts/AC1.json");
      assert.match(init.headers.authorization, /^Basic /);
      return { status, ok: status === 200, json: async () => body };
    },
  })());
  assert.equal(byLabel(await run(200, { status: "active", type: "Full" }), "Text messages (Twilio)").status, "ok");
  assert.equal(byLabel(await run(200, { status: "active", type: "Trial" }), "Text messages (Twilio)").status, "warn");
  assert.equal(byLabel(await run(401, {}), "Text messages (Twilio)").status, "error");
});

test("storage check catches data that would be lost on Render", async () => {
  const onRender = await withMode("scripted", () => createSetupChecker({ env: { RENDER: "true" }, services, dataFile: tmp() })());
  assert.equal(byLabel(onRender, "Saving leads").status, "warn");
  const aFile = tmp();
  fs.writeFileSync(aFile, "{}"); // a file can't contain a folder, so saving under it must fail
  const unwritable = await withMode("scripted", () => createSetupChecker({ env: {}, services, dataFile: path.join(aFile, "sub", "db.json") })());
  assert.equal(byLabel(unwritable, "Saving leads").status, "error");
});

test("results are cached until a refresh is asked for", async () => {
  let calls = 0;
  const check = createSetupChecker({ env: {}, services, dataFile: tmp(), makeAnthropic: () => ({ models: { retrieve: async (id) => { calls++; return { id }; } } }) });
  await withMode("claude", async () => { await check(); await check(); await check({ refresh: true }); });
  assert.equal(calls, 2);
});
