// HTTP server: JSON API + static pages. No framework, only Node built-ins.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadBusinesses, defaultBusinessId, publicUrl } from "./config.js";
import { Store } from "./store.js";
import { createAgent, detectMode } from "./agent.js";
import { LeadService } from "./leads.js";
import { availableSlots } from "./scheduling.js";
import { normalizePhone, twilioConfigured, validateTwilioSignature } from "./sms.js";

const PUBLIC = path.join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// Posts events (new lead, booking, needs human) to a webhook: Zapier, Make, n8n, Slack, etc.
export async function webhookNotify(event) {
  console.log(`[event] ${event.type}`, JSON.stringify(event.lead ?? {}));
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw Object.assign(new Error("body too large"), { status: 413 });
  }
  return body;
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body) return {};
  if ((req.headers["content-type"] || "").includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  try { return JSON.parse(body); } catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
}

function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(data));
}

function isAdmin(req, url) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true; // demo mode: dashboard is open
  const given = req.headers.authorization?.replace(/^Bearer /, "") || url.searchParams.get("token");
  return given === token;
}

const publicLead = (l) => ({ id: l.id, name: l.name, status: l.status, transcript: l.transcript });
const publicBusiness = ({ id, name, agentName, phone, services, serviceArea }) => ({ id, name, agentName, phone, services, serviceArea });

// services: Map of business id -> LeadService
export function createServer({ services, defaultId, env = process.env }) {
  const pending = new Set(); // background work (incoming texts), so tests and shutdown can wait for it

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST",
          "access-control-allow-headers": "content-type,authorization",
        });
        return res.end();
      }

      if (req.method === "GET" && p === "/api/health") {
        return send(res, 200, { ok: true, mode: detectMode(), businesses: services.size, defaultBusiness: defaultId, sms: twilioConfigured(env) });
      }

      if (req.method === "POST" && p === "/api/sms/inbound") return await handleInboundSms(req, res, url);

      if (req.method === "GET" && p === "/api/admin/businesses") {
        if (!isAdmin(req, url)) return send(res, 401, { error: "unauthorized" });
        return send(res, 200, [...services.values()].map((s) => ({ id: s.business.id, name: s.business.name, smsNumber: s.business.smsNumber || null })));
      }

      const b = p.match(/^\/api\/b\/([a-z0-9-]+)(\/.*)$/);
      if (b) {
        const service = services.get(b[1]);
        if (!service) return send(res, 404, { error: "unknown business" });
        const rest = b[2];
        if (req.method === "GET" && rest === "/business") return send(res, 200, publicBusiness(service.business));
        if (req.method === "POST" && rest === "/leads") {
          const { lead, reply } = await service.intake(await readJson(req));
          return send(res, 201, { lead: publicLead(lead), reply });
        }
        const m = rest.match(/^\/leads\/([\w-]+)\/messages$/);
        if (req.method === "POST" && m) {
          const { text } = await readJson(req);
          const { lead, reply } = await service.message(m[1], text);
          return send(res, 200, { lead: publicLead(lead), reply });
        }
        if (req.method === "GET" && rest.startsWith("/admin/")) {
          if (!isAdmin(req, url)) return send(res, 401, { error: "unauthorized" });
          if (rest === "/admin/leads") return send(res, 200, service.store.listLeads().map(({ apiMessages, ...l }) => l));
          if (rest === "/admin/bookings") return send(res, 200, service.store.listBookings());
          if (rest === "/admin/stats") return send(res, 200, service.stats());
          if (rest === "/admin/slots") return send(res, 200, availableSlots(service.business, service.store.bookedSlots(), new Date(), 20));
        }
        return send(res, 404, { error: "not found" });
      }

      if (req.method === "GET" && !p.startsWith("/api/")) {
        const file = path.normalize(path.join(PUBLIC, p === "/" ? "index.html" : p));
        if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
          return fs.createReadStream(file).pipe(res);
        }
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      const status = err.status && err.status < 500 ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: status === 500 ? "internal error" : err.message });
    }
  });

  // Twilio "A message comes in" webhook. Answers right away (Twilio waits at most 15s),
  // then lets the agent think and texts the reply through the REST API.
  async function handleInboundSms(req, res, url) {
    const params = Object.fromEntries(new URLSearchParams(await readBody(req)));
    if (env.TWILIO_AUTH_TOKEN) {
      // Twilio signs the exact public URL it called; behind a proxy we can't see it, so prefer PUBLIC_URL.
      const base = publicUrl(env) || `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
      const ok = validateTwilioSignature(env.TWILIO_AUTH_TOKEN, base + req.url, params, req.headers["x-twilio-signature"]);
      if (!ok) return send(res, 403, { error: "bad signature" });
    }
    const to = normalizePhone(params.To);
    const service = [...services.values()].find((s) => to && normalizePhone(s.business.smsNumber) === to);
    if (!service) return send(res, 404, { error: "no business uses this number" });
    if (!params.From || !String(params.Body || "").trim()) return send(res, 400, { error: "From and Body are required" });

    res.writeHead(200, { "content-type": "text/xml" });
    res.end(EMPTY_TWIML);

    const job = service.inboundSms({ from: params.From, body: params.Body })
      .catch((err) => console.error("inbound sms failed:", err))
      .finally(() => pending.delete(job));
    pending.add(job);
  }

  server.drain = () => Promise.all([...pending]);
  return server;
}

export function buildServices({ businesses, store, agent, notify = webhookNotify, sms, smsEnabled, now }) {
  const services = new Map();
  for (const business of businesses.values()) {
    services.set(business.id, new LeadService({ store: store.forBusiness(business.id), business, agent, notify, sms, smsEnabled, now }));
  }
  return services;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const businesses = loadBusinesses();
  const defaultId = defaultBusinessId(businesses);
  const store = new Store(process.env.DATA_FILE || path.join(ROOT, "data", "db.json"), { defaultBusinessId: defaultId });
  const services = buildServices({ businesses, store, agent: createAgent() });
  const port = Number(process.env.PORT || 3000);
  createServer({ services, defaultId }).listen(port, () => {
    console.log(`LeadBot on http://localhost:${port}  (agent: ${detectMode()}, SMS: ${twilioConfigured() ? "on" : "off"})`);
    for (const b of businesses.values()) console.log(`  ${b.name}: /demo.html?b=${b.id}`);
  });
}
