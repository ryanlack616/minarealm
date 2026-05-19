# Cynthia Meeting Brief — May 18, 2026 (4:30 PM)

One-page brief for the in-person meeting today.
Owner: Cynthia · Support: Ryan
Budget cap: $1,000 / 90 days (unchanged)

---

## What's actually built and working today

The full internal order management system Cynthia asked for is **live**:

- Customers can browse, add to cart, choose pickup or ship, and pay
  online via Square (sandbox today — flips to production in 1 minute
  once Square creds are entered).
- Every order lands in the admin under Orders, with status, payment
  status, shipping address (with copy + USPS verify), packing-slip
  print, tracking-number entry, and an "Email & fulfill" button that
  emails the customer their tracking and marks the order shipped.
- Stock auto-decrements when Square confirms payment. Low-stock alert
  emails Cynthia when an item drops to 2 or fewer.
- Customer gets an automatic confirmation email on order, and a
  tracking email when Cynthia marks shipped.
- New today: **Orders CSV export** for monthly bookkeeping / taxes.
- Inventory tab has +1 / −1 buttons → that's the "I just sold one in
  the shop" workflow (no extra step needed).
- Multi-user staff accounts work, with a trust toggle so untrusted
  staff edits go to Cynthia for approval before going live.
- Audit log of every change.

---

## Decisions / inputs needed from Cynthia today

These are the only things still blocking a full production launch.

1. **Square production credentials.** Access token, location ID,
   webhook signature key. We'll set them via Cloudflare dashboard
   together. ~10 min.
2. **MailChannels DNS record.** Add one TXT record to minarealm.shop
   and one to minarealm.org via Porkbun DNS. Without this, NO
   automated emails go out (silent failure). ~10 min.
3. **Owner password.** Cynthia logs in once with the bootstrap
   password (Ryan has it); system forces a new one. ~2 min.
4. **Inventory question.** When you sell a crystal at the counter
   via Square POS, do you want online inventory to update
   automatically (requires Square Items sync work, days of effort),
   or is the current "tap −1 on the admin page" workflow fine?
5. **Refund flow.** Today: mark cancelled in admin + refund manually
   in Square. Acceptable, or want a one-button refund?

---

## Demo plan for the meeting (~15 min)

1. Place a real $1 sandbox test order from minarealm.shop
2. Show the email she receives (Cynthia notification)
3. Show the email the customer receives (confirmation)
4. Walk through the Orders tab → print packing slip
5. Enter a fake tracking number → click "Email & fulfill"
6. Show the tracking email the customer gets
7. Show CSV export
8. Show inventory −1 button for in-store sale workflow

If MailChannels DNS isn't set yet, the emails won't actually arrive
during the demo — we'll add the DNS record live and re-test.

---

## What's queued next (not for today, just visibility)

See `PROJECT_PLAN.md` for the full roadmap. Highlights:

- Pirate Ship / Shippo integration for buying postage inside the
  system (currently external)
- Daily summary email to Cynthia
- Newsletter list export UI
- Customer order-status page polish
- Coupon codes
- FAQ + testimonials on minarealm.org (90-day growth plan)
- Local SEO + Google Business Profile work

---

## 90-day growth plan (status from April brief)

The original April 12 plan is still the operating frame:

- Days 1-30: Trust + conversion foundation
- Days 31-60: Local discoverability
- Days 61-90: Offers + retention

The infrastructure investment ("Web + infrastructure: $210") has
delivered well over its budget value — an internal order system that
would have cost $30-50/month on Shopify ($1,000+ across 90 days).
The system runs on Cloudflare for under $5/month.

---

## Bottom line

The store can take live online orders **today** once Cynthia provides
Square production credentials and adds the MailChannels DNS record.
Everything else is incremental.
