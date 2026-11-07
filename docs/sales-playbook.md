# Sales playbook: getting your first paying client

The software is the easy part. Money comes from talking to business owners. Realistic expectations: most people need **dozens of messages to land one client**, and the first one usually takes a few weeks. Nothing here is guaranteed.

## Your first week

- [ ] Put LeadBot online (README section 3) so you have a link to send. Demos work without an API key, but add one so the demo can answer questions; it costs cents per conversation.
- [ ] Pick one niche and one area, e.g. roofers in your city.
- [ ] List 30 businesses in a spreadsheet (section 2).
- [ ] Test the response time of 10 of them by filling in their website form.
- [ ] Make a personal demo for the 5 slowest (section 3) and send your first messages.
- [ ] Follow up 3 days later.

## 1. Who to sell to

Pick **one** type of business so your pitch and demo fit it exactly. Good fits share three traits: leads come in through forms or ads, one job is worth a lot, and the owner is usually busy on a job site and can't answer fast.

| Niche | Typical job value | Why they care |
|---|---|---|
| Plumbers / HVAC | $200–$10,000 | Emergencies; the first company to answer wins |
| Roofers | $8,000–$25,000 | One extra job pays for years of LeadBot |
| Remodelers / contractors | $5,000+ | Slow to reply, lots of leads go cold |
| House cleaners | $150 recurring | High lead volume |
| Med spas / dentists | $300–$3,000 | Front desk misses after-hours leads |

**Start with whoever you can reach easily**: businesses in your town, ones you or your family have used, or friends of friends.

## 2. Finding them

- Google Maps: search "plumber near [your city]". Each listing shows a website and phone number.
- Look for signs they're losing leads: a contact form that only says "we'll get back to you", ads running, slow review replies.
- **Test them yourself:** fill in their website form as a customer and time how long they take to reply. If it's hours, or they never reply, that's your opening.

Track everything in a simple spreadsheet: business, owner name, contact, date contacted, reply time you measured, status.

## 3. Make their personal demo first

Before you contact a business, spend 10 minutes making a demo with **their** name and services:

```bash
npm run new-client -- --name "Peak Roofing" --niche roofing --phone "(555) 010-3300" --city Boulder --timezone America/Denver
```

Check the file against their website (README section 2) and push it. Your demo link is `https://YOUR-APP.onrender.com/demo.html?b=peak-roofing`. Owners respond far better to "here's your business, try it" than to a generic demo.

If they don't sign up, delete their file after a few weeks.

## 4. What to say

**Email or contact form (after you've tested their response time):**

> Subject: Your website form took 6 hours to reply
>
> Hi [Name], I filled out the request form on [business] Tuesday at 2pm, as a test, and heard back around 8pm. Most people who fill out a form call the next company on Google if they don't hear back within a few minutes.
>
> I set up a system that texts every lead back within seconds, answers their questions and books the appointment, 24/7. I made a version for [business] you can try as a customer, it takes a minute: [their personal demo link]
>
> Worth a 10-minute call this week?
> [Your name], [phone]

**Short version for Facebook/Instagram DMs or text:**

> Hey [Name], quick one. I tested your website form and it took [X hours] to hear back. I build a tool that replies to every lead in seconds and books the job. I made one set up for [business], want the link?

**Follow up** 3 days later and again a week later. Most replies come from follow-ups.

## 5. The demo call (10 minutes)

1. Ask: "What happens right now when a lead comes in at 8pm, or while you're on a job?" Then let them talk.
2. Ask: "Roughly what's one job worth to you?"
3. Have them open their personal demo **on their own phone** and play the customer.
4. Do the maths together: "If this saves you one extra job a month, that's $[job value] for $297."
5. Offer the guarantee and ask: "Want me to set it up this week?"

## 6. Pricing

- **Setup:** $750, one time. For the first 1–2 clients, consider $0–$300 setup in exchange for a testimonial.
- **Monthly:** $297. This is where the steady income is: 10 clients is about $3,000 a month.
- **Guarantee:** "If it doesn't book at least one job you wouldn't have gotten in the first 30 days, the first month is free."
- Take payment with Stripe payment links or invoices.

These prices are common in the automation-agency guides, not proven numbers. Adjust them after your first few calls.

## 7. Your costs (estimates, check them yourself)

- AI replies: a lead conversation is a handful of short messages. Expect a few cents to tens of cents per lead, depending on the model and conversation length. Check your real usage on the Anthropic console after the first week.
- Hosting: about $5–$20 a month for a small server that can run many clients.
- SMS through Twilio: about 1¢ per text, plus a number (~$1–2/month) and 10DLC registration fees. You can pass these on or build them into the monthly price.

So most of the $297 is margin. Your real cost is your time on setup and support.

## 8. Delivering for a client (checklist)

- [ ] Start Twilio A2P 10DLC registration the day they say yes; approval can take weeks.
- [ ] Finish their business file: services, prices, area, hours, FAQ and emergency instructions. Then add `smsNumber` (their Twilio number) and `ownerPhone` (their mobile, for booking alerts).
- [ ] Connect their website form or lead ads (README "Connecting lead sources") and add the consent checkbox wording from the demo form.
- [ ] Set the Twilio number's incoming-message webhook (README section 4).
- [ ] Give them their dashboard link: `/dashboard.html?b=their-name&token=...`. Note the token currently opens every business's dashboard. That's fine while you're the only one using it, but don't hand it to clients until per-client logins exist; send them weekly numbers instead.
- [ ] Submit 5 test leads together, including a fake emergency and "STOP".
- [ ] Check in after week 1 with their numbers from the dashboard: leads, booked, reply speed.

## 9. Upsells for later

- **Missed-call text-back:** when the owner misses a call, text the caller "Sorry we missed you, how can we help?" Not built yet; ask Claude to add it when a client wants it.
- **Review requests:** text customers a review link after the job.
- **Reviving old leads:** text past leads who never booked.

## 10. What not to do

- Don't promise a number of jobs. Promise speed and follow-up, which you control.
- Don't text people who didn't ask to be contacted. That's a legal risk under the TCPA, the US texting law, and it can get your number banned.
- Don't spend weeks improving the code before you've talked to 20 businesses.
