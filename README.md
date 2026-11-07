# LeadBot

LeadBot texts back a local service business's new leads within seconds, answers their questions, and books them into an open appointment slot. Emergencies, upset customers and anything it can't handle go to a person.

You sell it to businesses like plumbers, HVAC companies and roofers for a setup fee plus a monthly fee. See [`docs/sales-playbook.md`](docs/sales-playbook.md) for how to find and sign customers.

## Try it on your computer

You need [Node.js](https://nodejs.org) version 20 or newer.

```bash
npm install
npm start
```

Then open:

- http://localhost:3000/demo.html: pretend to be a customer. Fill in the form, then reply to the texts.
- http://localhost:3000/dashboard.html: what the business owner sees (leads, bookings, booking rate, reply speed).
- http://localhost:3000/: a sales page you can show prospects.

Without an API key it runs in **scripted mode**: it sends fixed messages that offer three times and book the one picked. It's good enough to demo, but it can't answer questions.

To get real AI replies, get an API key from https://console.anthropic.com and start it like this:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Then it uses Claude. It answers questions from the business's details, handles "can you come Tuesday afternoon instead?", and decides when to hand off to a person.

## Setting it up for a new client

Copy `config/business.json` and fill in their details:

- name and phone
- services and prices
- service area
- opening hours and time zone
- how long a visit slot is (`slotMinutes`)
- FAQ answers

The AI only states facts from this file. Then run it with `BUSINESS_CONFIG=path/to/their.json`.

## Settings (environment variables)

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on AI replies. Without it, scripted mode. |
| `LEADBOT_MODE` | Force `claude` or `scripted`. |
| `LEADBOT_MODEL` | Claude model ID (default `claude-opus-5-5`). |
| `PORT` | Web port (default 3000). |
| `DATA_FILE` | Where leads and bookings are saved (default `data/db.json`). |
| `BUSINESS_CONFIG` | Which business file to load. |
| `ADMIN_TOKEN` | Password for the dashboard. **Set this before going live.** Open the dashboard with `?token=...`. |
| `NOTIFY_WEBHOOK_URL` | Every event (new lead, booking, needs a person, opted out) is POSTed here as JSON. Point it at Zapier, Make, n8n or Slack to text or email the owner. |

## Connecting real lead sources

Anything that can send a webhook can create a lead:

```
POST /api/leads            {name, phone, email, service, message}  -> {lead, reply}
POST /api/leads/:id/messages {text}                                -> {lead, reply}
```

- **Website form:** set the form to POST to `/api/leads`. Form-encoded and JSON bodies both work.
- **Facebook/Google lead ads:** use a Zapier or Make "new lead" trigger, then a webhook step to `/api/leads`.
- **SMS (next step, not built yet):** a Twilio number whose incoming-message webhook calls `/api/leads/:id/messages`, plus sending `reply` back through Twilio.

Admin endpoints (need `ADMIN_TOKEN` when it's set): `GET /api/admin/leads`, `/api/admin/bookings`, `/api/admin/stats`, `/api/admin/slots`.

## Tests

```bash
npm test
```

The Claude path is tested against a fake API client, so the tests need no key.

## Before a real paying client

- [ ] **Real SMS through Twilio.** US business texting needs A2P 10DLC registration, and the form must have consent wording ("By submitting you agree to receive texts…"). "STOP" opt-outs are already handled.
- [ ] **Booking into their real calendar or CRM** (Google Calendar, Jobber, Housecall Pro) instead of LeadBot's own slot list.
- [ ] Set `ADMIN_TOKEN`, host it somewhere always on (Render, Railway, Fly.io or a $5 VPS), and back up `data/db.json`. Use a real database once you have several clients.
