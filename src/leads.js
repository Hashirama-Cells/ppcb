// Ties one business's store view, the agent, SMS and notifications together.
import { formSubmissionText } from "./agent.js";
import { normalizePhone, sendSms, smsAllowed, twilioConfigured, ownerAlertText } from "./sms.js";

// Abuse limits. Each AI reply costs money and each text goes to a real phone, so cap what
// strangers on the internet can trigger. A business file can override them under "limits".
export const DEFAULT_LIMITS = {
  leadsPerDay: 100, // new leads per business per 24h
  leadsPerPhonePerDay: 3, // stops someone using the form to spam one person's phone
  messagesPerLead: 30, // after this many texts from one customer, hand off to a person
  textChars: 1000, // longer customer messages are cut off
};
const DAY_MS = 24 * 60 * 60 * 1000;

export class LeadService {
  // store: a business-scoped view from Store.forBusiness(business.id)
  // sms:   async ({to, from, body}) => {sent, reason}; defaults to Twilio
  // notify: async (event) => {}; e.g. the NOTIFY_WEBHOOK_URL poster
  constructor({ store, business, agent, notify = async () => {}, sms = sendSms, smsEnabled, now }) {
    Object.assign(this, { store, business, agent, notify, sms, now: now || (() => new Date()) });
    this.smsEnabled = smsEnabled ?? (twilioConfigured() && Boolean(normalizePhone(business.smsNumber)));
    this.limits = { ...DEFAULT_LIMITS, ...(business.limits || {}) };
  }

  #recentLeads() {
    const since = Date.now() - DAY_MS;
    return this.store.listLeads().filter((l) => Date.parse(l.createdAt) >= since);
  }

  #checkIntake(phoneE164) {
    const recent = this.#recentLeads();
    const busy = `We're getting a lot of requests right now. Please call ${this.business.phone}.`;
    if (recent.length >= this.limits.leadsPerDay) throw new TooManyRequestsError(busy);
    if (phoneE164 && recent.filter((l) => l.phoneE164 === phoneE164).length >= this.limits.leadsPerPhonePerDay) {
      throw new TooManyRequestsError(busy);
    }
  }

  #whyNoText(lead) {
    if (!lead.phoneE164) return "no valid mobile number";
    if (!smsAllowed(lead.phoneE164)) return "phone number is outside the allowed countries";
    if (!lead.smsConsent) return "no SMS consent on the form";
    return null;
  }

  ctx(lead, events) {
    return { store: this.store, business: this.business, lead, now: this.now, events };
  }

  canText(lead) {
    return this.smsEnabled && !this.#whyNoText(lead);
  }

  async #emit(event) {
    await this.notify(event).catch((err) => console.error("notify failed:", err.message));
    const text = ownerAlertText(event, this.business);
    if (text && this.smsEnabled && normalizePhone(this.business.ownerPhone)) {
      await this.sms({ to: this.business.ownerPhone, from: this.business.smsNumber, body: text })
        .catch((err) => console.error("owner alert failed:", err.message));
    }
  }

  async #deliver(lead, reply) {
    if (!reply || !this.canText(lead)) return;
    const result = await this.sms({ to: lead.phoneE164, from: this.business.smsNumber, body: reply })
      .catch((err) => ({ sent: false, reason: err.message }));
    if (!result.sent) console.error(`reply to lead ${lead.id} not texted: ${result.reason}`);
  }

  async #turn(lead, userText) {
    const events = [];
    const reply = await this.agent.respond(this.ctx(lead, events), userText);
    lead.transcript.push({ role: "agent", text: reply, at: new Date().toISOString() });
    this.store.save();
    await this.#deliver(lead, reply);
    for (const e of events) await this.#emit(e);
    return reply;
  }

  #newLead(fields) {
    const lead = this.store.createLead(fields);
    return this.store.updateLead(lead.id, { phoneE164: normalizePhone(lead.phone) });
  }

  // New lead from a web form, ad form or webhook. Replies immediately.
  async intake(fields) {
    if (!fields.phone && !fields.email) throw new ValidationError("phone or email is required");
    this.#checkIntake(normalizePhone(fields.phone));
    const started = Date.now();
    const lead = this.#newLead(fields);
    await this.#emit({ type: "lead.created", lead: { id: lead.id, name: lead.name, phone: lead.phone, service: lead.service } });
    const reply = await this.#turn(lead, formSubmissionText(lead));
    const patch = { firstResponseMs: Date.now() - started };
    if (lead.status === "new") patch.status = "contacted";
    this.store.updateLead(lead.id, patch);

    // SMS is live but we may not text this person: a human has to reach out instead.
    if (this.smsEnabled && !this.canText(lead) && !["booked", "needs_human", "opted_out"].includes(lead.status)) {
      const reason = this.#whyNoText(lead);
      this.store.updateLead(lead.id, { status: "needs_human", statusReason: reason });
      await this.#emit({ type: "lead.needs_human", lead: { id: lead.id, name: lead.name, phone: lead.phone }, reason });
    }
    return { lead: this.store.getLead(lead.id), reply };
  }

  // A reply from the lead (from the demo chat widget, or an SMS via inboundSms).
  async message(leadId, text) {
    const lead = this.store.getLead(leadId);
    if (!lead) throw new NotFoundError("lead not found");
    const clean = String(text || "").trim().slice(0, this.limits.textChars);
    if (!clean) throw new ValidationError("text is required");
    if (lead.status === "opted_out") return { lead, reply: null };
    if (lead.transcript.filter((t) => t.role === "lead").length >= this.limits.messagesPerLead) {
      lead.transcript.push({ role: "lead", text: clean, at: new Date().toISOString() });
      if (lead.status !== "needs_human") {
        this.store.updateLead(lead.id, { status: "needs_human", statusReason: "long conversation" });
        await this.#emit({ type: "lead.needs_human", lead: { id: lead.id, name: lead.name, phone: lead.phone }, reason: "long conversation; please take over" });
      }
      this.store.save();
      return { lead, reply: null };
    }
    lead.transcript.push({ role: "lead", text: clean, at: new Date().toISOString() });
    const reply = await this.#turn(lead, clean);
    return { lead: this.store.getLead(lead.id), reply };
  }

  // An incoming text to the business's Twilio number. Someone who texts us first has opted in.
  async inboundSms({ from, body }) {
    const phoneE164 = normalizePhone(from);
    if (!phoneE164) throw new ValidationError("invalid From number");
    let lead = this.store.findLeadByPhone(phoneE164);
    if (lead) {
      if (!lead.smsConsent) this.store.updateLead(lead.id, { smsConsent: true });
      return this.message(lead.id, body);
    }
    this.#checkIntake(phoneE164);
    const started = Date.now();
    lead = this.#newLead({ phone: from, message: body, source: "sms", smsConsent: true });
    await this.#emit({ type: "lead.created", lead: { id: lead.id, name: lead.name, phone: lead.phone, service: "" } });
    const result = await this.message(lead.id, body);
    const patch = { firstResponseMs: Date.now() - started };
    if (result.lead.status === "new") patch.status = "contacted";
    this.store.updateLead(lead.id, patch);
    return { lead: this.store.getLead(lead.id), reply: result.reply };
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
export class TooManyRequestsError extends Error { status = 429; }
