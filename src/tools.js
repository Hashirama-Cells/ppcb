// Actions the assistant can take on a lead. Shared by the Claude agent (as tools)
// and the scripted agent, so both follow exactly the same booking rules.
import { availableSlots, formatSlot } from "./scheduling.js";

// Runs one action against the store. Returns a string on success,
// or {error: true, text} when the action isn't allowed.
export function runTool(name, input, ctx) {
  const { store, business, lead, now, events } = ctx;
  if (name === "get_available_slots") {
    const slots = availableSlots(business, store.bookedSlots(), now(), 6);
    return slots.length ? slots.map((s) => `${s} (${formatSlot(s)})`).join("\n") : "No open slots in the next week.";
  }
  if (name === "book_appointment") {
    const existing = store.listBookings().find((b) => b.leadId === lead.id);
    if (existing) {
      return { error: true, text: `This customer is already booked for ${formatSlot(existing.slot)}. Do not book again; tell them to call ${business.phone} to change it.` };
    }
    const open = availableSlots(business, store.bookedSlots(), now(), 100);
    if (!open.includes(input.slot)) {
      return { error: true, text: `Slot "${input.slot}" is not open. Call get_available_slots and pick one from that list.` };
    }
    const booking = store.addBooking({ leadId: lead.id, slot: input.slot, service: input.service, notes: input.notes });
    store.updateLead(lead.id, { status: "booked" });
    events.push({ type: "booking.created", booking, lead: { id: lead.id, name: lead.name, phone: lead.phone } });
    return `Booked ${formatSlot(input.slot)} for ${input.service}. Booking id ${booking.id}.`;
  }
  if (name === "update_lead_status") {
    store.updateLead(lead.id, { status: input.status, statusReason: input.reason });
    events.push({ type: `lead.${input.status}`, lead: { id: lead.id, name: lead.name, phone: lead.phone }, reason: input.reason });
    return `Status set to ${input.status}.`;
  }
  return { error: true, text: `Unknown tool ${name}` };
}

