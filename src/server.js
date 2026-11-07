// HTTP server: JSON API + static pages. No framework, only Node built-ins.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, loadBusinesses, defaultBusinessId, publicUrl } from "./config.js";
import { Store } from "./store.js";
import { createAgent, detectMode } from "./agent.js";
import { LeadService } from "./leads.js";
import { availableSlots } from "./scheduling.js";
import { normalizePhone, twilioConfigured, validateTwilioSignature } from "./sms.js";
import { createSetupChecker } from "./setup.js";

const PUBLIC = path.join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer", // keeps ?token= out of Referer headers
  "x-frame-options": "DENY",
};

// Fixed-window limiter kept in memory: allow `limit` hits per key per window.
export function rateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    let entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      entry = { start: t, count: 0 };
      hits.set(key, entry);
    }
    entry.count++;
    if (hits.size > 10_000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
    return entry.count <= limit;
  };
}

function clientIp(req, env) {
  // Behind a hosting proxy (Render, Railway, Fly) the visitor's address is in X-Forwarded-For.
  if (env.TRUST_PROXY) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || "unknown";
}

const isProduction = (env) => env.NODE_ENV === "production" || Boolean(env.RENDER);

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
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(data));
}

const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest();

// Returns null if allowed, otherwise [status, message].
function adminDenied(req, url, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) {
    // Open dashboard is only OK on your own computer.
    return isProduction(env) ? [503, "Set ADMIN_TOKEN to use the dashboard"] : null;
  }
  const given = req.headers.authorization?.replace(/^Bearer /, "") || url.searchParams.get("token") || "";
  return crypto.timingSafeEqual(sha256(given), sha256(token)) ? null : [401, "unauthorized"];
}

const publicLead = (l) => ({ id: l.id, name: l.name, status: l.status, transcript: l.transcript });
const publicBusiness = ({ id, name, agentName, phone, services, serviceArea, demo }) => ({ id, name, agentName, phone, services, serviceArea, demo: demo === true });

// services: Map of business id -> LeadService
export function createServer({ services, defaultId, env = process.env, limits = {}, setup = null }) {
  const pending = new Set(); // background work (incoming texts), so tests and shutdown can wait for it
  // Per visitor: new leads and chat messages. Stops one person from running up your AI bill.
  const leadLimit = rateLimiter({ limit: limits.leadsPerIp ?? 5, windowMs: 10 * 60 * 1000 });
  const messageLimit = rateLimiter({ limit: limits.messagesPerIp ?? 40, windowMs: 10 * 60 * 1000 });
  const tooMany = (res) => send(res, 429, { error: "Too many requests. Please wait a few minutes or call us." });

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
        const denied = adminDenied(req, url, env);
        if (denied) return send(res, denied[0], { error: denied[1] });
        return send(res, 200, [...services.values()].map((s) => ({ id: s.business.id, name: s.business.name, smsNumber: s.business.smsNumber || null })));
      }

      if (req.method === "GET" && p === "/api/admin/setup") {
        const denied = adminDenied(req, url, env);
        if (denied) return send(res, denied[0], { error: denied[1] });
        if (!setup) return send(res, 404, { error: "setup checks not enabled" });
        return send(res, 200, await setup({ refresh: url.searchParams.has("refresh") }));
      }

      const b = p.match(/^\/api\/b\/([a-z0-9-]+)(\/.*)$/);
      if (b) {
        const service = services.get(b[1]);
        if (!service) return send(res, 404, { error: "unknown business" });
        const rest = b[2];
        if (req.method === "GET" && rest === "/business") return send(res, 200, publicBusiness(service.business));
        if (req.method === "POST" && rest === "/leads") {
          if (!leadLimit(clientIp(req, env))) return tooMany(res);
          const { lead, reply } = await service.intake(await readJson(req));
          return send(res, 201, { lead: publicLead(lead), reply });
        }
        const m = rest.match(/^\/leads\/([\w-]+)\/messages$/);
        if (req.method === "POST" && m) {
          if (!messageLimit(clientIp(req, env))) return tooMany(res);
          const { text } = await readJson(req);
          const { lead, reply } = await service.message(m[1], text);
          return send(res, 200, { lead: publicLead(lead), reply });
        }
        if (req.method === "GET" && rest.startsWith("/admin/")) {
          const denied = adminDenied(req, url, env);
          if (denied) return send(res, denied[0], { error: denied[1] });
          if (rest === "/admin/leads") return send(res, 200, service.store.listLeads().map(({ apiMessages, ...l }) => l));
          if (rest === "/admin/bookings") return send(res, 200, service.store.listBookings());
          if (rest === "/admin/stats") return send(res, 200, service.stats());
          if (rest === "/admin/slots") return send(res, 200, availableSlots(service.business, service.store.bookedSlots(), new Date(), 20));
        }
        return send(res, 404, { error: "not found" });
      }

      if (req.method === "GET" && !p.startsWith("/api/")) {
        const file = path.normalize(path.join(PUBLIC, p === "/" ? "index.html" : p));
        if (file.startsWith(PUBLIC + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { ...SECURITY_HEADERS, "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
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
    // Without the auth token we can't tell real Twilio requests from fakes, so accept none.
    if (!env.TWILIO_AUTH_TOKEN) return send(res, 503, { error: "SMS is not configured" });
    const params = Object.fromEntries(new URLSearchParams(await readBody(req)));
    // Twilio signs the exact public URL it called; behind a proxy we can't see it, so prefer PUBLIC_URL.
    const base = publicUrl(env) || `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
    const signed = validateTwilioSignature(env.TWILIO_AUTH_TOKEN, base + req.url, params, req.headers["x-twilio-signature"]);
    if (!signed) return send(res, 403, { error: "bad signature" });
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
  const dataFile = process.env.DATA_FILE || path.join(ROOT, "data", "db.json");
  const store = new Store(dataFile, { defaultBusinessId: defaultId });
  const services = buildServices({ businesses, store, agent: createAgent() });
  const setup = createSetupChecker({ services, dataFile });
  const port = Number(process.env.PORT || 3000);
  createServer({ services, defaultId, setup }).listen(port, () => {
    console.log(`LeadBot on http://localhost:${port}  (agent: ${detectMode()}, SMS: ${twilioConfigured() ? "on" : "off"})`);
    for (const b of businesses.values()) console.log(`  ${b.name}: /demo.html?b=${b.id}`);
  });
}
