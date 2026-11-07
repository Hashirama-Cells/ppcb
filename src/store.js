// Tiny JSON-file store. Fine for a demo or a single small client;
// swap for SQLite/Postgres before running many clients on one server.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class Store {
  constructor(file) {
    this.file = file;
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

  createLead({ name, phone, email, service, message, source }) {
    const lead = {
      id: crypto.randomUUID(),
      name: String(name || "").trim(),
      phone: String(phone || "").trim(),
      email: String(email || "").trim(),
      service: String(service || "").trim(),
      message: String(message || "").trim(),
      source: source || "web-form",
      status: "new",
      createdAt: new Date().toISOString(),
      firstResponseMs: null,
      transcript: [], // [{role: "lead"|"agent", text, at}]
      apiMessages: [], // raw Claude conversation, kept append-only
    };
    this.data.leads.push(lead);
    this.save();
    return lead;
  }

  getLead(id) {
    return this.data.leads.find((l) => l.id === id) || null;
  }

  listLeads() {
    return [...this.data.leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  updateLead(id, patch) {
    const lead = this.getLead(id);
    if (!lead) return null;
    Object.assign(lead, patch);
    this.save();
    return lead;
  }

  addBooking({ leadId, slot, service, notes }) {
    if (this.data.bookings.some((b) => b.slot === slot)) {
      throw new Error(`Slot ${slot} is already booked`);
    }
    const booking = {
      id: crypto.randomUUID(),
      leadId,
      slot,
      service,
      notes: notes || "",
      createdAt: new Date().toISOString(),
    };
    this.data.bookings.push(booking);
    this.save();
    return booking;
  }

  listBookings() {
    return [...this.data.bookings].sort((a, b) => a.slot.localeCompare(b.slot));
  }

  bookedSlots() {
    return new Set(this.data.bookings.map((b) => b.slot));
  }
}
