import test from "node:test";
import assert from "node:assert/strict";
import { availableSlots, formatSlot } from "../src/scheduling.js";

const biz = {
  timezone: "America/Denver",
  slotMinutes: 120,
  bookingDaysAhead: 3,
  hours: { mon: ["08:00", "17:00"], tue: ["08:00", "17:00"], wed: null, thu: null, fri: null, sat: null, sun: null },
};

test("slots respect hours, step and notice", () => {
  // Mon 2026-11-09 09:30 Denver = 16:30 UTC
  const slots = availableSlots(biz, new Set(), new Date("2026-11-09T16:30:00Z"), 20);
  assert.deepEqual(slots, [
    "2026-11-09 12:00", "2026-11-09 14:00",
    "2026-11-10 08:00", "2026-11-10 10:00", "2026-11-10 12:00", "2026-11-10 14:00",
  ]);
});

test("booked slots are excluded", () => {
  const slots = availableSlots(biz, new Set(["2026-11-10 08:00"]), new Date("2026-11-09T16:30:00Z"), 20);
  assert.ok(!slots.includes("2026-11-10 08:00"));
});

test("formatSlot is human readable", () => {
  assert.equal(formatSlot("2026-11-10 14:00"), "Tue, Nov 10, 2:00 PM");
});
