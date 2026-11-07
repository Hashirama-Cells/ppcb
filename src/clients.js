// Creates a business config from a niche template (used by `npm run new-client`).
import fs from "node:fs";
import path from "node:path";
import { businessesDir as defaultBusinessesDir, TEMPLATES_DIR, slugify } from "./config.js";

export function listNiches(templatesDir = TEMPLATES_DIR) {
  return fs.readdirSync(templatesDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
}

function fill(value, vars) {
  if (typeof value === "string") return value.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
}

export function createClientConfig(
  { name, niche, phone, city, timezone = "America/New_York", agentName, slug, force = false },
  { templatesDir = TEMPLATES_DIR, businessesDir = defaultBusinessesDir() } = {},
) {
  const niches = listNiches(templatesDir);
  if (!name) throw new Error("--name is required");
  if (!phone) throw new Error("--phone is required (the business's main number)");
  if (!city) throw new Error("--city is required (their main service area)");
  if (!niches.includes(niche)) throw new Error(`--niche must be one of: ${niches.join(", ")}`);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`--timezone "${timezone}" is not valid; use a name like America/Chicago`);
  }
  const id = slugify(slug || name);
  if (!id) throw new Error("could not make a URL name from --name; pass --slug");

  const template = JSON.parse(fs.readFileSync(path.join(templatesDir, `${niche}.json`), "utf8"));
  const config = fill(template, { name, phone, city, timezone });
  if (agentName) config.agentName = agentName;
  // Prospect demos are labeled as demos and never send real texts. Set to false once they're a paying client.
  config.demo = true;

  const file = path.join(businessesDir, `${id}.json`);
  if (fs.existsSync(file) && !force) throw new Error(`${path.relative(process.cwd(), file)} already exists (pass --force to replace it)`);
  fs.mkdirSync(businessesDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  return { id, file, config };
}
