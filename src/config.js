import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const BUSINESSES_DIR = path.join(ROOT, "config", "businesses");
export const TEMPLATES_DIR = path.join(ROOT, "config", "templates");
export const businessesDir = () => process.env.BUSINESSES_DIR || BUSINESSES_DIR;
export const publicUrl = (env = process.env) => (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['\u2019]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function loadBusiness(file) {
  const business = JSON.parse(fs.readFileSync(file, "utf8"));
  business.id = path.basename(file, ".json");
  return business;
}

// Every business on this server: config/businesses/<slug>.json, or one file via BUSINESS_CONFIG.
export function loadBusinesses({ dir = businessesDir(), file = process.env.BUSINESS_CONFIG } = {}) {
  const files = file
    ? [file]
    : fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(dir, f));
  const businesses = new Map();
  for (const f of files) {
    const b = loadBusiness(f);
    businesses.set(b.id, b);
  }
  if (businesses.size === 0) throw new Error(`No business configs found in ${dir}`);
  return businesses;
}

export function defaultBusinessId(businesses, preferred = process.env.DEFAULT_BUSINESS) {
  if (preferred && businesses.has(preferred)) return preferred;
  return businesses.keys().next().value;
}
