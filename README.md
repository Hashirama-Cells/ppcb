# LeadBot

LeadBot texts back a local service business's new leads within seconds, answers their questions, and books them into an open appointment slot. Emergencies, upset customers and anything it can't handle go to the owner.

You sell it to businesses like plumbers, HVAC companies, roofers and cleaners for a setup fee plus a monthly fee. One LeadBot server can run many businesses. See [`docs/sales-playbook.md`](docs/sales-playbook.md) for how to find and sign customers.

**Contents:** [Try it](#1-try-it-on-your-computer) · [Add a business](#2-add-a-business-or-make-a-prospects-demo) · [Put it online](#3-put-it-online-render) · [Real text messages](#4-real-text-messages-twilio) · [Keeping it safe](#5-keeping-it-safe) · [Settings](#settings) · [Connecting lead sources](#connecting-lead-sources)

## 1. Try it on your computer

You need [Node.js](https://nodejs.org) version 20 or newer.

```bash
npm install
npm start
```

The terminal lists a demo link for each business. Open:

- `http://localhost:3000/demo.html?b=summit-plumbing`: pretend to be a customer. Fill in the form, then reply to the texts.
- `http://localhost:3000/dashboard.html`: what the owner sees (leads, bookings, booking rate, reply speed). Use the dropdown to switch businesses.
- `http://localhost:3000/`: a sales page you can show prospects.

Without an API key it runs in **scripted mode**: it sends fixed messages that offer three times and book the one picked. It's good enough to demo, but it can't answer questions.

To get real AI replies, get a key at https://console.anthropic.com and start it like this:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

## 2. Add a business (or make a prospect's demo)

```bash
npm run new-client -- --name "Peak Roofing" --niche roofing --phone "(555) 010-3300" --city Boulder --timezone America/Denver
```

- **Niches:** `plumbing`, `hvac`, `roofing`, `cleaning`.
- **Time zones:** `America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`.

This creates `config/businesses/peak-roofing.json` and prints the demo link (`/demo.html?b=peak-roofing`). Before you show it to anyone:

1. Open the file and check the services, prices, opening hours and service area against their website. The templates say "quoted on site" or "free estimate" rather than guessing prices.
2. Add true facts to `"faq"`, such as `"Family owned since 2009"` or `"We offer financing"`. **The assistant only states facts from this file.**
3. Restart LeadBot. Once it's online, commit and push the file, and Render redeploys automatically.

When they become a paying client, also fill in:
- `"smsNumber"`: the Twilio number that texts their leads (see section 4).
- `"ownerPhone"`: the owner's mobile. They get a text for every booking and every lead that needs them.

## 3. Put it online (Render)

You need this to send prospects a demo link, and for real clients.

1. Make an account at https://render.com and connect your GitHub account.
2. Click **New → Blueprint** and pick this repository. Render reads `render.yaml`.
   - Choose the branch with this code, or merge it into `main` first.
3. It asks for a few settings. You can leave the optional ones blank for now:
   - `ANTHROPIC_API_KEY`: for real AI replies.
   - `TWILIO_*`: for real texts.
4. Click **Apply**. A few minutes later you get a web address like `https://leadbot-xxxx.onrender.com`.
5. Open your service's **Environment** tab and copy the `ADMIN_TOKEN` that Render generated. Your dashboard is `https://leadbot-xxxx.onrender.com/dashboard.html?token=THAT_TOKEN`. Don't share that link.

**Cost:** the blueprint uses Render's Starter plan (about $7/month) because saving leads needs a disk. The free plan works for demos, but it forgets leads whenever it restarts and is slow to wake up.

There's also a `Dockerfile` if you'd rather host it elsewhere (Railway, Fly.io, a VPS). Mount a disk at `/data`.

## 4. Real text messages (Twilio)

1. Sign up at https://www.twilio.com and buy a local phone number (about $1–2/month).
   - **Trial accounts can only text numbers you've verified.** Upgrade before a client goes live.
2. **Register for A2P 10DLC** in the Twilio console (Messaging → Regulatory compliance). US carriers block business texts from unregistered numbers.
   - Approval can take days to a few weeks, and there are small registration fees. Start this as soon as a client says yes.
3. In Render, under **Environment**, set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`. Both are on the Twilio console home page.
4. In the client's business file, set `"smsNumber"` to the Twilio number and `"ownerPhone"` to the owner's mobile. Push the change.
5. In Twilio, open the number's settings. Under **Messaging → A message comes in**, choose **Webhook**, enter `https://YOUR-APP.onrender.com/api/sms/inbound`, method **HTTP POST**. Save.
6. Test it by texting the number from your own phone. You should get a reply within a few seconds.

How LeadBot behaves once SMS is on:

- **Form leads are only texted if they ticked the consent box.** The demo form has the standard wording; copy it onto the client's real form. Leads without consent are marked "needs human" and the owner is alerted to call them.
- **Anyone who texts the number first counts as opted in.** They get a reply and become a lead.
- **"STOP" opts the person out.** Twilio also blocks texts to them at the carrier level.
- Incoming texts are checked against Twilio's signature, so nobody can fake them. If you use a custom domain, set `PUBLIC_URL` to it; on Render the address is detected automatically.

## 5. Keeping it safe

**Built in:**

| Risk | Protection |
|---|---|
| Someone floods the form to run up your AI bill | 5 new leads per visitor per 10 minutes; 100 new leads per business per day; 30 messages per customer, then the owner takes over |
| Someone enters a stranger's number to harass them | At most 3 leads per phone number per day, and only people who ticked the consent box are texted |
| "SMS pumping" fraud with expensive foreign numbers | Only US/Canada (+1) numbers are texted unless you set `SMS_ALLOWED_COUNTRY_CODES` |
| Fake incoming texts | Every incoming text must carry Twilio's signature; none are accepted until `TWILIO_AUTH_TOKEN` is set |
| Strangers reading your leads | The dashboard needs `ADMIN_TOKEN`, and online it refuses to open without one |
| A customer tells the AI to "ignore your rules" | The AI can only offer and book real slots (one per customer) or flag the lead; it's told to ignore instructions in customer messages |
| Reading files off the server | Only files in `public/` are served |

You can change a business's limits in its file, e.g. `"limits": { "leadsPerDay": 300 }`.

**Your part:**

1. **Turn on two-step login** for GitHub, Render, Anthropic and Twilio. Someone who gets into one of these accounts can do far more damage than any attack on the app.
2. **Set spending limits:**
   - Anthropic: console → Billing → set a monthly limit (start at $20).
   - Twilio: set usage alerts, and under Messaging → Geo permissions, allow only the US and Canada.
3. **Never paste keys or tokens into code, chats, emails or GitHub.** They belong only in Render's Environment tab. If one leaks, make a new one at the provider and delete the old one.
4. **Keep the dashboard link private.** It contains your password, and one link opens every business. Send clients their numbers rather than the link.
5. **Customer data is personal information.** Don't copy it anywhere else, and delete a client's leads if they leave.

## Settings

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on AI replies. Without it, scripted mode. |
| `LEADBOT_MODE` | Force `claude` or `scripted`. |
| `LEADBOT_MODEL` | Claude model ID (default `claude-opus-5-5`). |
| `ADMIN_TOKEN` | Password for the dashboard. **Always set this when online.** |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Turn on real texting. |
| `PUBLIC_URL` | Your public address, e.g. `https://leads.example.com`. Optional on Render. |
| `SMS_ALLOWED_COUNTRY_CODES` | Country codes LeadBot may text, comma-separated (default `1`, US/Canada). |
| `TRUST_PROXY` | Set to `true` behind a hosting proxy so rate limits see real visitor addresses (already set in `render.yaml`). |
| `NOTIFY_WEBHOOK_URL` | Every event (new lead, booking, needs a person, opted out) is POSTed here as JSON. Use it for Zapier, Make, n8n or Slack. |
| `DEFAULT_BUSINESS` | Which business `/demo.html` shows with no `?b=`. Defaults to the first alphabetically. |
| `PORT` | Web port (default 3000). |
| `DATA_FILE` | Where leads and bookings are saved (default `data/db.json`). |
| `BUSINESSES_DIR` / `BUSINESS_CONFIG` | Load businesses from another folder, or just one file. |

## Connecting lead sources

Each business has its own endpoints under `/api/b/<business>/`:

```
POST /api/b/<business>/leads                {name, phone, email, service, message, smsConsent}  -> {lead, reply}
POST /api/b/<business>/leads/:id/messages   {text}                                              -> {lead, reply}
POST /api/sms/inbound                       Twilio webhook (all businesses; matched by the "To" number)
```

- **Website form:** POST the form to `/api/b/<business>/leads`. Form-encoded and JSON bodies both work. Include a consent checkbox named `smsConsent` with value `true`.
- **Facebook/Google lead ads:** use a Zapier or Make "new lead" trigger, then a webhook step to the same address.

Admin endpoints need `ADMIN_TOKEN` when it's set:
- `GET /api/admin/businesses`
- `GET /api/b/<business>/admin/leads`, `…/bookings`, `…/stats` and `…/slots`

## Tests

```bash
npm test
```

The Claude and Twilio parts are tested against fakes, so the tests need no keys or accounts.

## Not built yet

- **Booking into the client's own calendar or CRM** (Google Calendar, Jobber, Housecall Pro). Today LeadBot keeps its own slot list, and the owner sees bookings on the dashboard and in alert texts.
- **Missed-call text-back:** text people back when the owner misses their call. This is a good upsell.
- **A real database.** The JSON file is fine for a handful of clients.
