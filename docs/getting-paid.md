# Getting paid

The simplest setup: **Stripe Payment Links.** You make two links once, then text or email them to each client. They pay by card, and Stripe charges the monthly fee automatically and sends the money to your bank. You don't need any code or a website shop.

## 1. Open a Stripe account (about 20 minutes)

1. Go to **stripe.com** and sign up with your email.
2. When it asks for your business type, choose **Individual / Sole proprietor**. You don't need a company to start.
3. It will ask for:
   - your legal name, address and date of birth
   - an SSN or EIN (see the tip below)
   - the bank account where you want your money, by routing and account number
4. For "business website", use your Render address (`https://YOUR-APP.onrender.com`).
5. Turn on **two-step login** (Settings → Personal details → Two-step authentication).

**Tip: get a free EIN first.** It takes about 10 minutes at irs.gov; search "apply for EIN online", and only use the irs.gov site because others charge fees. An EIN is a tax number for your business. You can give it to clients and to Stripe instead of your Social Security number. Some clients will ask you to fill in a W-9 form, and the EIN goes there.

## 2. Make your two payment links (about 10 minutes)

In Stripe, go to **Payment Links → New**.

**Link 1: setup fee**
- Product name: `LeadBot setup`
- Price: `$750`, **one time**
- Save, then copy the link.

**Link 2: monthly service**
- Product name: `LeadBot monthly service`
- Price: `$297`, **recurring, monthly**
- Save, then copy the link.

Keep both links in your notes. You'll use the same two links for every client.

Change the prices to whatever you decide. For your first client or two, a lower setup fee in exchange for a testimonial is a good trade (see the sales playbook).

## 3. When someone says yes

1. **Send the agreement** (`docs/service-agreement.md`). Fill in the blanks, and have them sign and date it. A printed copy is fine, as is a free e-signature tool, or a reply email saying "I agree".
2. **Send the setup link** and ask them to pay it before you start. That's normal and protects you.
3. **Set them up**, and tell Claude, who'll help: change their demo to a live business, connect texting, and connect their website form.
4. **When it's live, send the monthly link.** Stripe charges them every month after that until they cancel.

## 4. Running it

- **See payments:** Stripe dashboard → Payments. Money normally reaches your bank in about 2 business days.
- **Fees:** Stripe keeps about 3% of each card payment, roughly $9 of a $297 payment. Check stripe.com/pricing for the current rate.
- **Cancellations:** customers can cancel a subscription from the receipt email, or you can cancel it in Stripe → Customers.
- **Refunds:** if you promised the 30-day guarantee and it didn't book a job, refund the first month in Stripe → Payments → the payment → Refund. Keeping that promise is what makes the guarantee work as a selling point.
- **Failed payments:** Stripe retries automatically and emails the customer. If a client stops paying, set their business back to `"demo": true` (or remove it) after a reminder.

## 5. What you keep (rough estimate per client)

| | Per month |
|---|---|
| Client pays | $297 |
| Stripe fee (~3%) | −$9 |
| AI replies (depends on lead volume) | −$5 to −$20 |
| Twilio number + texts + registration | −$5 to −$20 |
| Your share of hosting (Render ~$7 total) | −$1 to −$7 |
| **You keep, before tax** | **about $240–$275** |

These are estimates. Check your real costs in the Anthropic, Twilio and Render dashboards after the first month.

## 6. Taxes and paperwork (the basics)

This isn't tax or legal advice. A local accountant or the free help at your nearest Small Business Center (NC community colleges run them, e.g. Robeson Community College or Fayetteville Technical Community College) can check your situation.

- **Set aside about 25–30% of what you earn** for taxes. Self-employed people pay self-employment tax (about 15%) plus income tax.
- **Keep records.** Stripe shows your income. Save receipts for Render, Anthropic, Twilio and your phone and internet. These are usually deductible business costs.
- **Quarterly payments:** if you'll owe more than about $1,000 in tax for the year, the IRS expects payments every quarter (search "IRS estimated taxes").
- **Business name:** you can work under your own name with no registration. If you want a business name, like "Cape Fear Lead Response", North Carolina requires an assumed business name certificate; ask the Register of Deeds or the Small Business Center.
- **Sales tax:** ask an accountant whether North Carolina sales tax applies to a monthly software service like this.
