// Ties the store, the agent and notifications together.
import { formSubmissionText } from "./agent.js";

export class LeadService {
  constructor({ store, business, agent, notify = async () => {}, now = () => new Date() }) {
    Object.assign(this, { store, business, agent, notify, now });
  }

  ctx(lead, events) {
    return { store: this.store, business: this.business, lead, now: this.now, events };
  }

  async #turn(lead, userText) {
    const events = [];
    const reply = await this.agent.respond(this.ctx(lead, events), userText);
    lead.transcript.push({ role: "agent", text: reply, at: new Date().toISOString() });
    this.store.save();
    for (const e of events) await this.notify(e).catch((err) => console.error("notify failed:", err.message));
    return reply;
  }

  // New lead from a web form, ad form or webhook. Replies immediately.
  async intake(fields) {
    if (!fields.phone && !fields.email) throw new ValidationError("phone or email is required");
    const started = Date.now();
    const lead = this.store.createLead(fields);
    await this.notify({ type: "lead.created", lead: { id: lead.id, name: lead.name, phone: lead.phone, service: lead.service } })
      .catch((err) => console.error("notify failed:", err.message));
    const reply = await this.#turn(lead, formSubmissionText(lead));
    this.store.updateLead(lead.id, { firstResponseMs: Date.now() - started, status: lead.status === "new" ? "contacted" : lead.status });
    return { lead: this.store.getLead(lead.id), reply };
  }

  // A text back from the lead (from the chat widget or an SMS webhook).
  async message(leadId, text) {
    const lead = this.store.getLead(leadId);
    if (!lead) throw new NotFoundError("lead not found");
    if (!String(text || "").trim()) throw new ValidationError("text is required");
    if (lead.status === "opted_out") return { lead, reply: null };
    lead.transcript.push({ role: "lead", text: String(text).trim(), at: new Date().toISOString() });
    const reply = await this.#turn(lead, String(text).trim());
    return { lead: this.store.getLead(lead.id), reply };
  }

  stats() {
    const leads = this.store.listLeads();
    const times = leads.map((l) => l.firstResponseMs).filter((n) => typeof n === "number");
    const by = (s) => leads.filter((l) => l.status === s).length;
    return {
      leads: leads.length,
      booked: by("booked"),
      needsHuman: by("needs_human"),
      bookingRate: leads.length ? by("booked") / leads.length : 0,
      avgFirstResponseMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    };
  }
}

export class ValidationError extends Error { status = 400; }
export class NotFoundError extends Error { status = 404; }
