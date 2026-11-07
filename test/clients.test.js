import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { slugify, loadBusinesses, defaultBusinessId } from "../src/config.js";
import { createClientConfig, listNiches } from "../src/clients.js";
import { availableSlots } from "../src/scheduling.js";

test("slugify", () => {
  assert.equal(slugify("Summit Plumbing & Heating"), "summit-plumbing-and-heating");
  assert.equal(slugify("  José's Roofing, LLC "), "joses-roofing-llc");
  assert.equal(slugify("!!!"), "");
});

test("niche templates exist and every template produces bookable slots", () => {
  assert.deepEqual(listNiches(), ["cleaning", "hvac", "plumbing", "roofing"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leadbot-"));
  for (const niche of listNiches()) {
    const { config } = createClientConfig({ name: `Test ${niche}`, niche, phone: "(555) 010-3300", city: "Boulder", timezone: "America/Denver" }, { businessesDir: dir });
    assert.ok(config.services.length > 0);
    assert.ok(availableSlots(config, new Set(), new Date("2026-11-09T16:30:00Z")).length > 0, niche);
    assert.doesNotMatch(JSON.stringify(config), /\{\w+\}/, `unfilled placeholder in ${niche}`);
  }
});

test("createClientConfig fills the template and refuses to overwrite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leadbot-"));
  const opts = { name: "Peak Roofing", niche: "roofing", phone: "(555) 010-3300", city: "Boulder", timezone: "America/Denver" };
  const { id, file, config } = createClientConfig(opts, { businessesDir: dir });
  assert.equal(id, "peak-roofing");
  assert.equal(config.name, "Peak Roofing");
  assert.deepEqual(config.serviceArea, ["Boulder"]);
  assert.match(config.emergencyNote, /\(555\) 010-3300/);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).timezone, "America/Denver");
  assert.throws(() => createClientConfig(opts, { businessesDir: dir }), /already exists/);
  assert.doesNotThrow(() => createClientConfig({ ...opts, force: true }, { businessesDir: dir }));

  const loaded = loadBusinesses({ dir });
  assert.equal(loaded.get("peak-roofing").name, "Peak Roofing");
  assert.equal(defaultBusinessId(loaded, "nope"), "peak-roofing");
});

test("createClientConfig validates input", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leadbot-"));
  const ok = { name: "X Co", niche: "hvac", phone: "1", city: "Y" };
  assert.throws(() => createClientConfig({ ...ok, niche: "dentist" }, { businessesDir: dir }), /niche must be one of/);
  assert.throws(() => createClientConfig({ ...ok, timezone: "Mars/Base" }, { businessesDir: dir }), /not valid/);
  assert.throws(() => createClientConfig({ ...ok, name: "" }, { businessesDir: dir }), /--name/);
  assert.throws(() => createClientConfig({ ...ok, phone: "" }, { businessesDir: dir }), /--phone/);
});
