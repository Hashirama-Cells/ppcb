// HTTP server: JSON API + static pages. No framework, only Node built-ins.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadBusiness } from "./config.js";
import { Store } from "./store.js";
import { createAgent, detectMode } from "./agent.js";
import { LeadService } from "./leads.js";
import { availableSlots } from "./scheduling.js";

const PUBLIC = path.join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

// Posts events (new lead, booking, needs human) to a webhook: Zapier, Make, n8n, Slack, etc.
export async function webhookNotify(event) {
  console.log(`[event] ${event.type}`, JSON.stringify(event.lead ?? {}));
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw Object.assign(new Error("body too large"), { status: 413 });
  }
  if (!body) return {};
  const type = req.headers["content-type"] || "";
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(body));
  try { return JSON.parse(body); } catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
}

function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(data));
}

function requireAdmin(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true; // demo mode: dashboard is open
  const given = req.headers.authorization?.replace(/^Bearer /, "") || new URL(req.url, "http://x").searchParams.get("token");
  return given === token;
}

const publicLead = (l) => ({ id: l.id, name: l.name, status: l.status, transcript: l.transcript });

export function createServer({ service, business }) {
  return http.createServer(async (req, res) => {
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
      if (req.method === "GET" && p === "/api/health") return send(res, 200, { ok: true, mode: detectMode() });
      if (req.method === "GET" && p === "/api/business") {
        const { name, agentName, phone, services, serviceArea } = business;
        return send(res, 200, { name, agentName, phone, services, serviceArea });
      }
      if (req.method === "POST" && p === "/api/leads") {
        const { lead, reply } = await service.intake(await readJson(req));
        return send(res, 201, { lead: publicLead(lead), reply });
      }
      const m = p.match(/^\/api\/leads\/([\w-]+)\/messages$/);
      if (req.method === "POST" && m) {
        const { text } = await readJson(req);
        const { lead, reply } = await service.message(m[1], text);
        return send(res, 200, { lead: publicLead(lead), reply });
      }
      if (p.startsWith("/api/admin/")) {
        if (!requireAdmin(req)) return send(res, 401, { error: "unauthorized" });
        if (p === "/api/admin/leads") return send(res, 200, service.store.listLeads().map(({ apiMessages, ...l }) => l));
        if (p === "/api/admin/bookings") return send(res, 200, service.store.listBookings());
        if (p === "/api/admin/stats") return send(res, 200, service.stats());
        if (p === "/api/admin/slots") return send(res, 200, availableSlots(business, service.store.bookedSlots(), new Date(), 20));
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
      send(res, status, { error: status === 500 ? "internal error" : err.message });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const business = loadBusiness();
  const store = new Store(process.env.DATA_FILE || path.join(ROOT, "data", "db.json"));
  const service = new LeadService({ store, business, agent: createAgent(), notify: webhookNotify });
  const port = Number(process.env.PORT || 3000);
  createServer({ service, business }).listen(port, () => {
    console.log(`LeadBot for ${business.name} on http://localhost:${port} (agent mode: ${detectMode()})`);
  });
}
