#!/usr/bin/env node
// Make a demo (or a real setup) for a new business in one command:
//   npm run new-client -- --name "Peak Roofing" --niche roofing --phone "(555) 010-3300" --city Boulder --timezone America/Denver
import { parseArgs } from "node:util";
import path from "node:path";
import { createClientConfig, listNiches } from "../src/clients.js";
import { publicUrl } from "../src/config.js";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    niche: { type: "string" },
    phone: { type: "string" },
    city: { type: "string" },
    timezone: { type: "string" },
    "agent-name": { type: "string" },
    slug: { type: "string" },
    force: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || !values.name) {
  console.log(`Create a business for LeadBot.

  npm run new-client -- --name "Peak Roofing" --niche roofing --phone "(555) 010-3300" --city Boulder --timezone America/Denver

  --name        Business name (required)
  --niche       ${listNiches().join(" | ")} (required)
  --phone       Their main phone number (required)
  --city        Main city they serve (required; add more in the file)
  --timezone    e.g. America/New_York, America/Chicago, America/Denver, America/Los_Angeles
  --agent-name  Name the assistant uses (default Riley)
  --slug        Short name for the URL (default: made from --name)
  --force       Replace an existing file`);
  process.exit(values.help ? 0 : 1);
}

try {
  const { id, file } = createClientConfig({
    name: values.name, niche: values.niche, phone: values.phone, city: values.city,
    timezone: values.timezone, agentName: values["agent-name"], slug: values.slug, force: values.force,
  });
  const base = publicUrl() || `http://localhost:${process.env.PORT || 3000}`;
  console.log(`Created ${path.relative(process.cwd(), file)}

Next:
  1. Open that file and check the services, prices, hours and service area against their website.
     Add true facts to "faq" (e.g. "Family owned since 2009"). The assistant only says what's in this file.
  2. Restart LeadBot (or redeploy) so it loads the new business.
  3. Demo link:      ${base}/demo.html?b=${id}
     Dashboard link: ${base}/dashboard.html?b=${id}`);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
