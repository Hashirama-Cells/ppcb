// Appointment slots in the business's local time, formatted "YYYY-MM-DD HH:MM".
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function localParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function availableSlots(business, booked = new Set(), now = new Date(), limit = 12) {
  const tz = business.timezone || "UTC";
  const today = localParts(now, tz);
  const step = business.slotMinutes || 120;
  const out = [];
  for (let i = 0; i <= (business.bookingDaysAhead || 7) && out.length < limit; i++) {
    const ymd = addDays(today.date, i);
    const dayKey = DAY_KEYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
    const hours = business.hours?.[dayKey];
    if (!hours) continue;
    const [open, close] = hours.map(toMin);
    for (let t = open; t + step <= close && out.length < limit; t += step) {
      if (i === 0 && t <= toMin(today.time) + 60) continue; // need an hour's notice
      const slot = `${ymd} ${toHHMM(t)}`;
      if (!booked.has(slot)) out.push(slot);
    }
  }
  return out;
}

export function formatSlot(slot) {
  const [ymd, hhmm] = slot.split(" ");
  const d = new Date(`${ymd}T12:00:00Z`);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const [h, m] = hhmm.split(":").map(Number);
  const time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return `${day}, ${time}`;
}
