# Minarealm — Project Plan

Last updated: 2026-05-18
Owner: Cynthia · Support: Ryan
Budget cap: $1,000 / 90 days

This document is the single source of truth for what's built, what's
queued, and what's blocked on Cynthia.

---

## 1. What the system does today (May 18, 2026)

A complete end-to-end ordering + fulfillment system, self-hosted on
Cloudflare Worker + Porkbun static sites. No third-party order tools.

### Customer-facing (minarealm.shop)

- Browse products in 6 categories
- Add to cart, see live shipping preview (weight-based)
- Choose pickup (Fenton / Hartland) or USPS ship
- Pay online via Square payment link (sandbox today; production-ready)
- Receive automated order confirmation email
- Receive tracking number email when Cynthia marks shipped
- Order-status lookup endpoint (semi-public by order ID)
- E-gift cards via Square (live)
- GA4 analytics (G-6M44R4WB73)

### Admin (minarealm.shop/admin/)

- Multi-user login with bootstrap (cynthia = owner)
- Role-based access: owner vs admin vs trusted-admin
- Inventory: edit stock/price/wholesale/supplier, +1/−1 buttons,
  margin display, low-margin/missing-cost row highlighting
- Orders tab: filter by status, search by name/email/ID, badge
  for new orders, status transitions, packing-slip print, tracking
  entry, email-tracking-and-fulfill button, copy-address, USPS
  address verification link, internal notes, payment-status dropdown
- Forms tab: newsletter, contact, booking, subscription submissions
- Dashboard: 7/30-day revenue, AOV, open/fulfilled/cancelled counts,
  fulfillment rate, sales index, reorder queue
- Users tab (owner only): create staff, set trusted, reset passwords
- Activity tab (owner only): full audit log
- Pending catalog approval workflow (untrusted staff → owner sign-off)
- **CSV export of orders by date range** (new today)
- Image upload → R2 bucket → automatic CDN URLs

### Worker (minarealm-admin.minarealm.workers.dev)

- Endpoints: products, checkout/create-payment-link, webhooks/square,
  orders (CRUD + tracking + CSV), forms (newsletter/contact/booking/
  subscription), login/whoami/logout/password, catalog approve/reject/
  rollback, upload, users, audit
- Server-side re-pricing (never trust client)
- Server-side MI 6% sales tax
- Server-side shipping calculation (weight-tiered, free over $100)
- Stock reservation (24h TTL) on payment-link creation
- Stock decrement on Square payment.updated webhook
- Low-stock email alert when item drops to 2 or fewer
- Rate limiting on login, orders, forms, checkout
- Audit log on every state change
- MailChannels for outbound email

---

## 2. What's blocked on Cynthia

These are the only things stopping a full production launch.

| Blocker | What's needed | How long |
|---|---|---|
| Square production credentials | Square account access token, location ID, webhook signature key | 10 min (live in meeting) |
| MailChannels DNS | Add `_mailchannels` TXT record on minarealm.shop and minarealm.org via Porkbun DNS panel | 10 min |
| Email domain auth (SPF/DKIM) | Confirm SPF includes MailChannels relay; optional DKIM record | 15 min |
| Owner password set | Cynthia logs in once with ADMIN_PASSWORD bootstrap; system forces password change | 2 min |
| Square Items catalog reconciliation | Decide: keep online inventory and Square POS separate, or sync? | discussion |

Once these are done, flipping `SQUARE_ENV` from sandbox to production
takes one `wrangler deploy`.

---

## 3. Roadmap — prioritized by daily-friction value

### Tier 1 — ship before launch
- ☑ Internal order tracking (built)
- ☑ Square payment links (built, sandbox)
- ☑ Customer confirmation email (built)
- ☑ Tracking-number email (built)
- ☑ Low-stock alert (built)
- ☑ Admin Orders tab with filter/search/status/tracking (built)
- ☑ Packing slip print (built)
- ☑ CSV export (built today)
- ☐ MailChannels DNS configured *(blocks all email)*
- ☐ Square production env flipped *(blocks live online checkout)*

### Tier 2 — first month of operation
- ☐ Pirate Ship or Shippo integration for postage-buying (currently
  Cynthia buys label outside the system and pastes the tracking number)
- ☐ "Sold in store" workflow refinement: today the −1 button on
  inventory works; if she wants a separate POS-like log, add one
- ☐ Daily/weekly summary email to Cynthia (revenue, orders shipped,
  low-stock items)
- ☐ Newsletter list export from admin (data is in KV; needs a UI)
- ☐ Refund + partial-refund flow (today: cancel + manual Square refund)
- ☐ Address-validation hard check before payment (USPS API)

### Tier 3 — quality of life
- ☐ Customer order-status page (`/orders/<id>` is partly there; needs
  pretty UI)
- ☐ Coupon / discount codes
- ☐ Multi-location stock (Fenton vs Hartland)
- ☐ Square Items ↔ Worker catalog sync (if she wants unified inventory
  across in-store POS and online)
- ☐ Customer accounts (today every checkout is guest)
- ☐ Reviews / testimonials capture flow
- ☐ Social-auto-post on new arrival

### Tier 4 — growth (from 90-day plan)
- ☐ FAQ + testimonials live on minarealm.org
- ☐ Local SEO pass (Fenton / South Lyon intent)
- ☐ Google Business Profile alignment
- ☐ Review QR cards in store
- ☐ 3 offer bundles
- ☐ Welcome flow + weekly newsletter

### Tier 5 — operational hygiene
- ☐ Nightly KV backup → email to Cynthia (or to R2 cold bucket)
- ☐ Worker uptime monitoring (heartbeat ping)
- ☐ Quarterly dependency audit (Square API version, MailChannels)
- ☐ Rotate FTP passwords on Porkbun (security PIN required)

---

## 4. Architecture

```
Customer (minarealm.shop)
   │
   ├── HTML/JS/Cart (static, Porkbun FTP)
   │
   └── POST /api/checkout/create-payment-link
       │
       ▼
   Cloudflare Worker (minarealm-admin)
       │
       ├── KV: STORE  (products, orders, users, sessions, forms, audit)
       ├── R2: minarealm-images (product photos)
       └── HTTP out:
           ├── Square API → payment link
           └── MailChannels → email Cynthia + customer
       ▲
       │ Square payment.updated webhook
       │
   Square (sandbox today, production after meeting)


Cynthia (minarealm.shop/admin/)
   │
   ├── Login → session cookie (30d TTL)
   ├── Inventory: edit + publish
   ├── Orders: list, search, mark fulfilled, send tracking, print slip, export CSV
   ├── Forms: newsletter / contact / booking / subscription leads
   └── Users + Activity (owner only)
```

---

## 5. Operating model

- Cynthia is the decision-maker. Ryan is support.
- Weekly review: Fridays, 30 min (per 90-day plan)
- Any spend > $100 → Cynthia approves with expected KPI
- Any production change to worker → `wrangler deploy` from
  `C:\rje\dev\minarealm\worker\`
- Any static-site change → Porkbun web file manager (FTP blocked
  from current machine; ports 21+990 timeout)
- Worker secrets set via Cloudflare dashboard or `wrangler secret put`,
  never committed
