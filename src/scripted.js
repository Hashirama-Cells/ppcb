// The assistant used when there's no AI key, and as the backup if the AI fails.
// It recognises the common things customers text, answers only from the business's
// own file, and books from real open slots using the same rules as the AI (tools.js).
import { availableSlots, formatSlot, localParts, addDays } from "./scheduling.js";
import { runTool } from "./tools.js";

const RX = {
  stop: /\b(stop|unsubscribe|stop texting( me)?|remove me)\b/,
  wrongNumber: /\b(wrong (number|person)|who is this|didn'?t (ask|request|fill))\b/,
  notInterested: /\b(not interested|no thanks|no thank you|already (hired|found|got|booked) (someone|somebody|a |another)|went with (someone|another|a different))\b/,
  emergency: /\b(flood(s|ed|ing)?|burst|gas (smell|leak)|smells? (like )?gas|emergency|pouring (in|through|down)|cav(ed|ing) in|collaps\w*|tree (fell|fall|fallen|came down|on (my|the))|fire|sparking|no heat)\b/,
  human: /\b((talk|speak|chat) (to|with) (a |an |the |some)?(one|person|human|someone|somebody|real|owner|manager|boss)|call me|give me a call|phone me|real person|a human)\b/,
  cancel: /\b(cancel\w*|reschedul\w*|change (my|the) (time|appointment|booking|day)|move (my|the) (appointment|visit|time)|can'?t make it|need a different (time|day))\b/,
  more: /\b(none|neither|other (times?|days?|options?)|another (time|day)|different (time|day)|later (in the week|time|date)|next week|(don'?t|doesn'?t|won'?t) work|can'?t do (any|those|that|them)|anything else|any other)\b/,
  yes: /^(yes|yeah|yep|yup|sure|ok(ay)?|y|sounds good|please|that works|book it|book me)[.! ]*$/,
  thanks: /^(ok(ay)?|k|thanks?( (you|so much))?|thank you( so much)?|thx|ty|great|perfect|awesome|sounds good|cool|got it|appreciate it|see (you|ya)( then| soon| there)?)[.! ]*$/,
  street: /\b(st|street|rd|road|ave|avenue|ln|lane|dr|drive|ct|court|blvd|boulevard|way|hwy|highway|pl|place|cir|circle|trl|trail|pkwy|parkway|loop|route)\b/,
  price: /\b(price|prices|pricing|cost|costs|how much|charge|charges|fee|fees|rates?|quote|estimate|free (estimate|inspection|quote)s?)\b/,
  area: /\b(service area|areas? (do )?you (serve|cover)|do you (serve|cover|come|go|travel|work in|service)|come out to|how far)\b/,
  hours: /\b(hours|are you open|open (on|today|tomorrow|saturdays?|sundays?|weekends?)|what time do you (open|close)|closed on|work (on )?weekends?)\b/,
  services: /\b(do you (do|fix|repair|install|replace|offer|handle|work on|clean|inspect)|what (services|kind of work|do you do)|services do you)\b/,
  contact: /\b(phone number|your number|number to call|how (do|can) i (call|reach))\b/,
  question: /\?\s*$|^(what|how|do|does|did|can|could|are|is|will|would|when|why|where|which|who)\b/,
};

const ORDINALS = [[/\b(first|1st)\b/, 0], [/\b(second|2nd)\b/, 1], [/\b(third|3rd|last)\b/, 2]];
const NUMBER_WORDS = [[/\bone\b/, 0], [/\btwo\b/, 1], [/\bthree\b/, 2]];
const DAYS = [
  [/\b(sun|sunday)\b/, 0], [/\b(mon|monday)\b/, 1], [/\b(tue|tues|tuesday)\b/, 2], [/\b(wed|weds|wednesday)\b/, 3],
  [/\b(thu|thur|thurs|thursday)\b/, 4], [/\b(fri|friday)\b/, 5], [/\b(sat|saturday)\b/, 6],
];
const PARTS = [
  [/\bmorning\b/, [0, 12 * 60]],
  [/\b(lunch|midday)\b/, [11 * 60, 14 * 60]],
  [/\bafternoon\b/, [12 * 60, 17 * 60]],
  [/\b(evening|after work)\b/, [16 * 60, 24 * 60]],
];
const IGNORE_WORDS = new Set(["about", "would", "could", "should", "there", "their", "which", "where", "what's", "these", "those", "think",
  "please", "thanks", "hello", "still", "today", "tomorrow", "really", "something", "anything", "someone", "house", "home", "looking",
  "wondering", "question", "price", "prices", "service", "services", "offer", "doing", "need", "needs"]);

const dayOfWeek = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const minutesOf = (slot) => { const [h, m] = slot.slice(11).split(":").map(Number); return h * 60 + m; };
const fmtTime = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`; };
const listWords = (items) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

// "it's 77 Elm Rd" -> "77 Elm Rd"
export function cleanAddress(text) {
  return text.trim().replace(/^(it'?s|its|i'?m at|we'?re at|i live at|my address is|the address is|address( is)?:?)\s+/i, "").replace(/[.!]+$/, "").slice(0, 200);
}

export function looksLikeAddress(text) {
  return text.trim().length >= 6 && /\b\d{1,6}\s+\S*[a-z]/i.test(text) && !/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(text);
}

// When the customer names a day, time or part of day. Returns null if they didn't.
export function parseWhen(text, business, now) {
  const today = localParts(now, business.timezone || "UTC").date;
  let dates = null;
  if (/\b(today|tonight)\b/.test(text)) dates = [today];
  else if (/\b(tomorrow|tmrw|tmr)\b/.test(text)) dates = [addDays(today, 1)];
  else {
    for (const [rx, dow] of DAYS) {
      if (!rx.test(text)) continue;
      for (let i = 0; i < 14; i++) {
        const d = addDays(today, i);
        if (dayOfWeek(d) === dow) { (dates ||= []).push(d); break; }
      }
    }
  }
  let minutes = null;
  if (/\bnoon\b/.test(text)) minutes = 12 * 60;
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/)
    || text.match(/\b(?:at|@|around|about|by)\s*(\d{1,2})(?::(\d{2}))?\b/)
    || text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    const ap = (m[3] || "").replace(/\./g, "");
    if (h <= 23 && min < 60) {
      if (ap === "pm" && h < 12) h += 12;
      else if (ap === "am" && h === 12) h = 0;
      else if (!ap && h >= 1 && h <= 7) h += 12; // "at 2" means 2 PM for a home visit
      minutes = h * 60 + min;
    }
  }
  const part = PARTS.find(([rx]) => rx.test(text))?.[1] || null;
  return dates || minutes != null || part ? { dates, minutes, part } : null;
}

// Works out which slot the customer picked, or which slots to offer next.
// Returns {book: slot}, {offer: [...], note}, or null if they didn't talk about timing.
export function chooseSlot(text, lead, business, open, now) {
  const when = parseWhen(text, business, now);
  if (when) {
    let cands = open;
    if (when.dates) cands = cands.filter((s) => when.dates.includes(s.slice(0, 10)));
    if (when.part) cands = cands.filter((s) => minutesOf(s) >= when.part[0] && minutesOf(s) < when.part[1]);
    if (when.minutes != null) {
      const exact = cands.find((s) => minutesOf(s) === when.minutes);
      if (exact) return { book: exact };
      const pool = cands.length ? cands : open;
      const near = [...pool].sort((a, b) => Math.abs(minutesOf(a) - when.minutes) - Math.abs(minutesOf(b) - when.minutes)).slice(0, 3).sort();
      return { offer: near, note: "That exact time isn't open, but here's what's closest." };
    }
    if (cands.length) return { offer: cands.slice(0, 3), note: "Here's what we have then." };
    return { offer: open.slice(0, 3), note: "Nothing's open then, but here are the next openings." };
  }
  const offered = lead.offeredSlots || [];
  let idx = null;
  for (const [rx, i] of ORDINALS) if (idx == null && rx.test(text)) idx = i;
  if (idx == null) {
    const d = text.match(/(?<![\d$:#])\b([1-3])\b(?![\d:%])/);
    if (d) idx = Number(d[1]) - 1;
  }
  if (idx == null) for (const [rx, i] of NUMBER_WORDS) if (idx == null && rx.test(text)) idx = i;
  if (idx == null || !offered[idx]) return null;
  if (open.includes(offered[idx])) return { book: offered[idx] };
  return { offer: open.slice(0, 3), note: "Sorry, that time just got taken." };
}

function hoursLine(b) {
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const label = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  const groups = [];
  for (const d of order) {
    const h = b.hours?.[d];
    const key = h ? h.join("-") : null;
    const last = groups.at(-1);
    if (last && last.key === key) last.days.push(d);
    else groups.push({ key, h, days: [d] });
  }
  const parts = groups.filter((g) => g.key).map((g) => {
    const days = g.days.length > 1 ? `${label[g.days[0]]}–${label[g.days.at(-1)]}` : label[g.days[0]];
    return `${days} ${fmtTime(g.h[0])}–${fmtTime(g.h[1])}`;
  });
  return parts.length ? `Our hours are ${parts.join(", ")}.` : `Call ${b.phone} for our hours.`;
}

// Answers to common questions, using only what's in the business's file.
export function answers(text, b) {
  const out = [];
  const serviceWords = new Set(b.services.flatMap((s) => s.name.toLowerCase().match(/[a-z]{4,}/g) || []));
  const mentioned = b.services.filter((s) => (s.name.toLowerCase().match(/[a-z]{5,}/g) || [])
    .some((w) => !["roof", "repair", "replacement"].includes(w) && text.includes(w.slice(0, 6))));
  if (RX.price.test(text)) {
    const list = (mentioned.length ? mentioned : b.services.slice(0, 4)).map((s) => `${s.name}: ${s.price}`);
    out.push(`Pricing: ${list.join("; ")}.`);
  }
  const words = (text.match(/[a-z]{5,}/g) || []).filter((w) => !IGNORE_WORDS.has(w) && !serviceWords.has(w));
  const faqHits = (b.faq || []).filter((f) => words.some((w) => f.toLowerCase().includes(w.length > 5 ? w.slice(0, 5) : w)));
  // "Do you offer financing?" is about the FAQ fact, not a request for the services list.
  if (RX.services.test(text) && !faqHits.length) out.push(`We do ${listWords(b.services.map((s) => s.name.toLowerCase()))}.`);
  if (RX.area.test(text)) out.push(`We serve ${listWords(b.serviceArea)}.`);
  if (RX.hours.test(text)) out.push(hoursLine(b));
  if (RX.contact.test(text)) out.push(`You can reach us at ${b.phone}.`);
  out.push(...faqHits.slice(0, 2));
  return [...new Set(out)];
}

function offerText(slots) {
  const options = slots.map((s, i) => `${i + 1}) ${formatSlot(s)}`).join("  ");
  const reply = slots.length === 1 ? "Reply 1" : slots.length === 2 ? "Reply 1 or 2" : "Reply 1, 2 or 3";
  return `We have openings: ${options}. ${reply} to book.`;
}

export class ScriptedAgent {
  async respond(ctx, userText) {
    const { lead, business, store, now, events } = ctx;
    const isForm = userText.startsWith("[Form submission]");
    const raw = isForm ? `${lead.service} ${lead.message}` : userText;
    const t = raw.toLowerCase().replace(/[‘’]/g, "'").trim();
    const first = (lead.name || "").split(" ")[0];
    const firstContact = isForm || !lead.transcript.some((x) => x.role === "agent");
    const opener = firstContact
      ? `Hi ${first || "there"}, this is ${business.agentName} with ${business.name}. Thanks for reaching out${lead.service ? ` about ${lead.service.toLowerCase()}` : ""}! `
      : "";
    const say = (s) => `${opener}${s}`.trim();
    const status = (s, reason) => runTool("update_lead_status", { status: s, reason }, ctx);
    const booking = store.listBookings().find((b) => b.leadId === lead.id);

    if (!isForm) {
      if (RX.stop.test(t)) { status("opted_out", "asked to stop"); return "You're unsubscribed and won't get more texts from us."; }
      if (RX.wrongNumber.test(t)) { status("opted_out", "says wrong number"); return "Sorry about that! You won't get any more texts from us."; }
      if (!booking && RX.notInterested.test(t)) { status("not_a_fit", `said: "${raw.slice(0, 100)}"`); return "No problem, thanks for letting us know! If anything changes, just text us here."; }
    }
    if (RX.emergency.test(t)) {
      status("needs_human", `possible emergency: "${raw.slice(0, 100)}"`);
      return say(`That sounds urgent${first ? `, ${first}` : ""}. ${business.emergencyNote}`);
    }
    if (!isForm && RX.human.test(t)) {
      status("needs_human", "asked to talk to a person");
      return say(`Sure! I've asked someone from ${business.name} to call you${lead.phone ? ` at ${lead.phone}` : ""}. You can also reach them at ${business.phone}.`);
    }
    if (booking) return this.#afterBooking(ctx, booking, raw, t);

    const info = answers(t, business);
    const open = availableSlots(business, store.bookedSlots(), now(), 200);
    const choice = chooseSlot(t, lead, business, open, now());

    if (!isForm) {
      if (choice?.book) return this.#book(ctx, choice.book, opener + (info.length ? `${info.join(" ")} ` : ""));
      if (choice?.offer) return this.#offer(ctx, choice.offer, say([...info, choice.note].join(" ")));
      if (RX.more.test(t)) {
        const last = (lead.offeredSlots || []).at(-1);
        const next = open.filter((s) => !last || s > last).slice(0, 3);
        if (next.length) return this.#offer(ctx, next, say([...info, "No problem! Here are some other times."].join(" ")));
        status("needs_human", "none of the open times work");
        return say(`No problem. I'll have someone from ${business.name} call you to find a time that works.`);
      }
      if (RX.street.test(t) && looksLikeAddress(raw)) {
        // They sent their address before picking a time: keep it for the booking.
        store.updateLead(lead.id, { address: cleanAddress(raw) });
        return this.#offer(ctx, null, say([...info, "Thanks, got your address!"].join(" ")));
      }
      if (!info.length && RX.yes.test(t) && lead.offeredSlots?.length) {
        const n = lead.offeredSlots.length;
        return `Great! Which time works best? Reply ${n === 1 ? "1" : n === 2 ? "1 or 2" : "1, 2 or 3"}.`;
      }
      if (!info.length && RX.question.test(t)) {
        status("needs_human", `customer asked: "${raw.slice(0, 140)}"`);
        info.push(`Good question. I'll have someone from ${business.name} get back to you on that.`);
      }
      if (!info.length && !opener) info.push("Happy to help!");
    } else if (choice?.offer) {
      // The form mentioned when they're free: offer times that match.
      return this.#offer(ctx, choice.offer, say(info.join(" ")));
    }
    return this.#offer(ctx, null, say(info.join(" ")));
  }

  #offer(ctx, slots, prefix) {
    const { lead, business, store, now } = ctx;
    // Re-show the times they were already looking at, if those are still open.
    const open = availableSlots(business, store.bookedSlots(), now(), 200);
    const stillOpen = (lead.offeredSlots || []).filter((s) => open.includes(s));
    const list = slots?.length ? slots : stillOpen.length ? stillOpen : open.slice(0, 3);
    if (!list.length) {
      runTool("update_lead_status", { status: "needs_human", reason: "no open slots" }, ctx);
      return `${prefix} We're fully booked right now; someone from ${business.name} will call you to find a time.`.trim();
    }
    store.updateLead(lead.id, { offeredSlots: list });
    return `${prefix} ${offerText(list)}`.trim();
  }

  #book(ctx, slot, prefix) {
    const { lead, business, store } = ctx;
    const notes = [lead.message, lead.address && `Address: ${lead.address}`].filter(Boolean).join(" | ");
    const out = runTool("book_appointment", { slot, service: lead.service || "Service visit", notes }, ctx);
    if (typeof out !== "string") return this.#offer(ctx, null, `${prefix}Sorry, that time isn't available anymore.`.trim());
    const booking = store.listBookings().find((b) => b.leadId === lead.id);
    if (lead.address) {
      store.updateBooking(booking.id, { address: lead.address });
      return `${prefix}You're booked for ${formatSlot(slot)}! We'll come to ${lead.address}. Reply here if anything changes.`;
    }
    store.updateLead(lead.id, { awaitingAddress: true });
    return `${prefix}You're booked for ${formatSlot(slot)}! What's the street address for the visit?`;
  }

  #afterBooking(ctx, booking, raw, t) {
    const { lead, business, store, events } = ctx;
    const when = formatSlot(booking.slot);
    if (RX.cancel.test(t)) {
      runTool("update_lead_status", { status: "needs_human", reason: `wants to cancel or reschedule ${booking.slot}` }, ctx);
      return `No problem. I've let the team at ${business.name} know, and someone will call you to sort it out. You can also call ${business.phone}.`;
    }
    if (lead.awaitingAddress && looksLikeAddress(raw)) {
      const address = cleanAddress(raw);
      store.updateLead(lead.id, { address, awaitingAddress: false });
      const updated = store.updateBooking(booking.id, { address, notes: [booking.notes, `Address: ${address}`].filter(Boolean).join(" | ") });
      events.push({ type: "booking.updated", booking: updated, lead: { id: lead.id, name: lead.name, phone: lead.phone } });
      return `Got it, thanks! See you ${when}.`;
    }
    const info = answers(t, business);
    if (info.length) return `${info.join(" ")} You're booked for ${when}.`;
    if (RX.thanks.test(t)) {
      return lead.awaitingAddress ? "Thanks! What's the street address for the visit?" : `Great, see you ${when}!`;
    }
    if (lead.awaitingAddress) {
      if (!lead.addressAsked) {
        store.updateLead(lead.id, { addressAsked: true });
        return "Could you send the street address for the visit? For example: 123 Main St.";
      }
      store.updateLead(lead.id, { awaitingAddress: false });
    }
    return `You're booked for ${when}. To change or cancel, call us at ${business.phone}.`;
  }
}
