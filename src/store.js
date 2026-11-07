// Tiny JSON-file store shared by every business on this server.
// Fine for a demo or a handful of clients; move to SQLite/Postgres before you have many.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class Store {
  constructor(file, { defaultBusinessId = null } = {}) {
    this.file = file;
    this.defaultBusinessId = defaultBusinessId; // owner of records saved before multi-business support
    this.data = { leads: [], bookings: [] };
    if (file && fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, "utf8"));
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  ownerOf(record) {
    return record.businessId ?? this.defaultBusinessId;
  }

  getLead(id) {
    return this.data.leads.find((l) => l.id === id) || null;
  }

  updateLead(id, patch) {
    const lead = this.getLead(id);
    if (!lead) return null;
    Object.assign(lead, patch);
    this.save();
    return lead;
  }

  // A view of the store limited to one business. The agent and LeadService only ever see this.
  forBusiness(businessId) {
    const store = this;
    const mine = (r) => store.ownerOf(r) === businessId;
    return {
      businessId,
      save: () => store.save(),
      updateLead: (id, patch) => (this.getLeadFor(businessId, id) ? store.updateLead(id, patch) : null),
      getLead: (id) => this.getLeadFor(businessId, id),

      createLead({ name, phone, email, address, service, message, source, smsConsent }) {
        const clip = (v, n) => String(v || "").trim().slice(0, n);
        const lead = {
          id: crypto.randomUUID(),
          businessId,
          name: clip(name, 100),
          phone: clip(phone, 40),
          email: clip(email, 200),
          service: clip(service, 100),
          address: clip(address, 200),
          message: clip(message, 2000),
          source: source || "web-form",
          smsConsent: smsConsent === true || smsConsent === "true" || smsConsent === "on",
          status: "new",
          createdAt: new Date().toISOString(),
          firstResponseMs: null,
          transcript: [], // [{role: "lead"|"agent", text, at}]
          apiMessages: [], // raw Claude conversation, kept append-only
        };
        store.data.leads.push(lead);
        store.save();
        return lead;
      },

      listLeads() {
        return store.data.leads.filter(mine).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },

      // Newest lead for this phone number (E.164), used for incoming texts.
      findLeadByPhone(e164) {
        return this.listLeads().find((l) => l.phoneE164 === e164) || null;
      },

      addBooking({ leadId, slot, service, notes }) {
        if (store.data.bookings.some((b) => mine(b) && b.slot === slot)) {
          throw new Error(`Slot ${slot} is already booked`);
        }
        const booking = { id: crypto.randomUUID(), businessId, leadId, slot, service, notes: notes || "", createdAt: new Date().toISOString() };
        store.data.bookings.push(booking);
        store.save();
        return booking;
      },

      updateBooking(id, patch) {
        const booking = store.data.bookings.find((b) => b.id === id && mine(b));
        if (!booking) return null;
        Object.assign(booking, patch);
        store.save();
        return booking;
      },

      listBookings() {
        return store.data.bookings.filter(mine).sort((a, b) => a.slot.localeCompare(b.slot));
      },

      bookedSlots() {
        return new Set(store.data.bookings.filter(mine).map((b) => b.slot));
      },
    };
  }

  getLeadFor(businessId, id) {
    const lead = this.getLead(id);
    return lead && this.ownerOf(lead) === businessId ? lead : null;
  }
}
