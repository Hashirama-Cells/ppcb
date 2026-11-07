import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");

export function loadBusiness(file = process.env.BUSINESS_CONFIG || path.join(ROOT, "config", "business.json")) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
