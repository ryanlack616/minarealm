# Minarealm — Project Plan

**Last updated:** June 4, 2026
**Owner:** Cynthia (final say on brand, spend, content, go-live)
**Operator:** Ryan (web support)
**Archive of old session notes:** `PLANS.archive.md`

---

## Current Status

The store is **built and deployed**. Real revenue requires two credential steps that only Cynthia can authorize.

| What | Status |
| --- | --- |
| minarealm.shop (site) | ✅ Live — GitHub Pages |
| Cloudflare Worker (backend API) | ✅ Live — minarealm-admin.minarealm.workers.dev |
| 26 products in catalog | ✅ Live — 6 categories, prices, photos |
| Admin panel (minarealm.shop/admin/) | ✅ Live — first login bootstraps owner account |
| Shop checkout flow | ✅ Built — Square payment link creation working |
| Order confirmation emails | ⚠️ Failing silently — RESEND_API_KEY not set |
| Square payments | ⚠️ Sandbox only — production credentials needed |
| Cynthia owner account | ⚠️ Not created — first login bootstraps it |
| Product weights (for shipping) | ⚠️ 14 of 26 products lack weight — fallback 200g used |
| Shippo label generation | ⬜ Phase 2, not built |

---

## Launch Blockers — In Order

These three things stand between current state and taking real money. Nothing else matters first.

### Blocker 1 — Cynthia creates her owner account

**Who:** Cynthia
**Time:** 2 minutes

Go to `https://minarealm.shop/admin/`. Log in with username `owner` and the bootstrap ADMIN_PASSWORD
(Ryan provides this). The site immediately requires setting a new password. After that she has full
owner access: inventory, orders, users, activity log.

This is the first-login bootstrap — it creates the `cynthia` account. All future staff accounts are
created from the Users tab. Her second login uses the new password she sets.

### Blocker 2 — Email delivery (Resend)

**Who:** Cynthia signs up; Ryan handles technical setup
**Time:** Cynthia: 5 min. Ryan: 15 min after.
**Cost:** Free (3,000 emails/month free)

MailChannels (the old email tool) stopped free service in 2024. Order confirmations, booking
confirmations, and newsletter welcome emails are not being delivered. The fix is already coded and
deployed — it just needs the key and domain verification.

**Cynthia's steps:**
1. Create a free account at resend.com.
2. Send Ryan the API key from the Resend dashboard.

**Ryan's steps after receiving the key:**
```
cd /home/ryan/rje/dev/minarealm/worker
npx wrangler secret put RESEND_API_KEY          # paste key when prompted
```
Then add `EMAIL_FROM = "orders@minarealm.shop"` to `wrangler.toml` [vars], verify the domain in
Resend dashboard, and `npx wrangler deploy`.

### Blocker 3 — Square production credentials

**Who:** Cynthia retrieves keys; Ryan sets secrets and deploys
**Time:** Cynthia: 10 min. Ryan: 15 min after.
**Cost:** 2.9% + $0.30 per online transaction (no monthly fee)

Payments are in sandbox mode (fake cards, no real money moves). Three values are needed from
Cynthia's Square Developer Console.

**Cynthia's steps:**
1. Go to developer.squareup.com/apps
2. Open your application → **Production** tab
3. Copy: **Access Token**, **Location ID** (from Square Dashboard → Settings → Business Locations),
   and **Webhook Signature Key** (from the Webhooks section)
4. Confirm in Square Dashboard → Items → Taxes: Michigan 6% is configured

**Ryan's steps after receiving the keys:**
```
cd /home/ryan/rje/dev/minarealm/worker
npx wrangler secret put SQUARE_ACCESS_TOKEN
npx wrangler secret put SQUARE_LOCATION_ID
npx wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
```
Then change `SQUARE_ENV = "sandbox"` to `SQUARE_ENV = "production"` in wrangler.toml and
`npx wrangler deploy`.

**Then:** place one real test order together to confirm money moves and emails arrive end-to-end.

---

## After Launch — Immediate Code Work

Ready to build with no input from Cynthia.

### 1. Commit uncommitted working tree changes

~81 lines of welcome/subscription email additions are deployed but not committed to git.

```bash
cd /home/ryan/rje/dev/minarealm
git add worker/src/index.js admin/index.html shop/order-success.html
git commit -m "worker: welcome + subscription emails; admin and success page polish"
git push origin master
```

### 2. Add product weights to catalog for 14 missing items

The Worker falls back to 200g for products without weight. A bracelet (really ~25g) lands in the
wrong shipping tier at 200g. Add estimates to `data/products.json`:

| Product | Add |
| --- | --- |
| Crystal Bracelet | `"weight_grams": 25` |
| Agate Slice | `"weight_grams": 80` |
| Crystal Sphere (entry) | `"weight_grams": 150` |
| Labradorite Heart | `"weight_grams": 100` |
| Polished Crystal Sphere (Premium) | `"weight_grams": 400` |
| Mystery Bag | `"weight_grams": 350` |
| Tumbled Stone Set | `"weight_grams": 80` |
| Sterling Silver Crystal Ring | `"weight_grams": 15` |

Cynthia can refine via admin Product Edit form (Weight field) after weighing with a kitchen scale.

### 3. Porkbun FTP password rotation

The FTP password was previously in plaintext in `.env`. Rotate it in Porkbun panel (Hosting → FTP)
and update `.env` locally. Confirm whether `_deploy.py` (FTP to Porkbun) is still needed at all —
the site now runs on GitHub Pages.

---

## How the Admin Works

**URL:** `https://minarealm.shop/admin/`

### Roles

| Role | What they can do |
| --- | --- |
| Owner (Cynthia) | Everything: inventory, orders, users, activity log, approve/reject catalog changes |
| Staff (admin role) | Edit inventory and manage orders — edits go to approval queue, not live immediately |

### Daily operations

- **Check orders:** Orders tab. Online orders appear after Square payment is confirmed. Mark as
  Fulfilled when shipped or picked up.
- **Shipping order email:** Cynthia gets a notification email to cynthia@minarealm.org when a paid
  shipping order comes in (after Resend is set up). Square also emails the customer automatically.

### Inventory management

- **Edit stock/price:** click ± buttons or type directly. Saves automatically.
- **Add a product:** click **+ Add Product**. Drag a photo onto the dropzone to upload to R2.
- **Staff edits:** a **Pending** banner appears in owner's view. Cynthia approves or rejects (with
  optional reason).
- **Rollback:** if something publishes wrong, click **Restore Previous** to revert to the prior
  catalog snapshot.

### Adding/managing staff

- Users tab → **+ Add User**. Set username, display name, role = admin, starting password.
- Reset staff password: Users tab → **Reset PW** next to that user.
- Owner password reset: Ryan runs `npx wrangler secret put ADMIN_PASSWORD`, then Cynthia does
  first-login bootstrap again (sets a new permanent password).

---

## What's Built and Live

### Pages

| Page | URL | Purpose |
| --- | --- | --- |
| Homepage | minarealm.shop/ | Landing, services, locations, events |
| Shop | minarealm.shop/shop/ | Browse products, checkout |
| Order success | minarealm.shop/shop/order-success.html | Post-checkout confirmation |
| Admin | minarealm.shop/admin/ | Owner/staff panel |
| Subscription | minarealm.shop/subscription/ | Crystal box sign-up |
| Tea | minarealm.shop/tea/ | Loose-leaf tea (placeholder content) |

### Backend Worker routes

| Route | What it does |
| --- | --- |
| GET /api/products | Live product catalog |
| POST /api/checkout/create-payment-link | Creates Square payment link, reserves stock |
| POST /api/webhooks/square | Handles Square payment confirmation, decrements stock |
| GET /api/orders/:id/confirmation | Order data for success page |
| POST /api/orders | Pickup/manual-invoice orders |
| POST /api/upload | Image → R2 |
| PUT /api/products | Catalog update (approval flow for staff) |
| GET/POST /api/catalog/pending | Pending catalog queue |
| POST /api/catalog/approve | Owner publishes pending catalog |
| POST /api/catalog/rollback | Restore previous snapshot |
| POST /api/forms/newsletter | Newsletter signup |
| POST /api/forms/contact | Contact form |
| POST /api/forms/booking | Service booking |
| POST /api/forms/subscription | Subscription box signup |
| GET /api/users | Owner-only user management |
| GET /api/audit | Owner-only activity log (365-day retention) |

### Infrastructure costs

| Service | Purpose | Cost |
| --- | --- | --- |
| GitHub Pages | Static site hosting | $0 |
| Cloudflare Workers | API backend | $0 (100k req/day free) |
| Cloudflare KV | Catalog, orders, sessions | $0 (100k reads/day free) |
| Cloudflare R2 | Product images | $0 (10 GB + zero egress) |
| Porkbun | minarealm.shop domain | ~$12/yr |
| Square | Payment processing | 2.9% + $0.30/transaction, no monthly fee |
| Resend | Transactional email | $0 (3,000 emails/mo) |

**Total fixed monthly cost: $0.**

---

## Revenue Model

**Online shipping orders:** Customer pays via Square Payment Link (card, Apple Pay, Google Pay).
Square collects Michigan 6% tax. Cynthia gets email notification. She prints label, ships item.

**Pickup orders:** Customer selects Fenton or Hartland pickup. No online payment — Cynthia sends a
Square invoice manually after the order comes in.

**Subscription boxes:** Sign-up form only. Customer fills form → Cynthia contacts them to arrange
recurring charge in Square. No automated billing in v1.

**Shipping tiers (flat rate by cart weight, current defaults):**

| Cart weight | Rate |
| --- | --- |
| 0–250g | $6.99 |
| 251–450g | $9.99 |
| 451–1000g | $14.99 |
| 1001–2000g | $19.99 |
| 2001g+ | $29.99 |
| Subtotal ≥ $100 | Free |

To adjust: `FREE_SHIPPING_THRESHOLD` in wrangler.toml controls the free-shipping threshold.
Weight tiers are in `worker/src/index.js` (search `shippingRateTiers`).

---

## Backlog — Needs Cynthia Input

| Item | What's needed |
| --- | --- |
| Subscription pricing | Approve $44.44 / $55.55 / $111.11 or adjust |
| Tea inventory | Real blend names, ingredients, prices, brewing notes |
| Selenite Dragonfly Plate photo | Actual product photo (she mentioned sending it) |
| Testimonials | 3–6 quotes from Google/Facebook reviews |
| Email list platform | Mailchimp free account + embed code (popup currently captures emails but has no list connected) |
| Moon Circle next dates | Next 2–3 upcoming dates |
| Crystal subscription — is it active? | Confirm the box program is actually running before keeping the signup page |
| GA4 — verify tracking | Confirm G-6M44R4WB73 is firing in her GA4 dashboard |

---

## Backlog — Ready to Build (No Input Needed)

| Item | Priority |
| --- | --- |
| Product weight entry (14 items) | High — affects shipping tier accuracy |
| Commit uncommitted worker changes | High — git hygiene |
| Porkbun FTP password rotation | High — credential hygiene |
| Shippo label generation (POST /api/orders/:id/create-label) | Medium — Phase 2, $0.05/label via Shippo |
| Email delivery failure alert (wrangler tail or webhook) | Medium — prevents silent failures recurring |
| Order/booking e2e smoke test | Medium — catches breakage before it reaches Cynthia |
| GBP audit — align Google Business Profile with live site | Low |
| Service schema JSON-LD for tarot/reiki/sound bath | Low — rich results for service searches |

---

## Deploying Changes

### Redeploy the Worker (after code or secret changes)

```bash
cd /home/ryan/rje/dev/minarealm/worker
npx wrangler deploy
```

Auth via Cloudflare OAuth (already logged in). No token needed for interactive deploys.

### Deploy static site changes

```bash
cd /home/ryan/rje/dev/minarealm
git add <files>
git commit -m "..."
git push origin master
```

GitHub Pages deploys automatically on push. Live in ~60 seconds.

### Check currently set Cloudflare secrets

```bash
cd /home/ryan/rje/dev/minarealm/worker
npx wrangler secret list
```

Currently set: `ADMIN_PASSWORD` only. Still needed: `RESEND_API_KEY`, `SQUARE_ACCESS_TOKEN`,
`SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`.

---

## Shelved

**`dev/minarealm-shop/` (FastAPI + Fly.io):** Built April 2026 as an alternate backend. Shelved
June 4, 2026 — the Cloudflare Worker covers all the same functionality at $0 with no cold-start
lag. The Windows venv inside (`venv/Lib/Scripts/`) is dead on Linux. Safe to delete or keep as
reference.

---

## Build History

| Date | What happened |
| --- | --- |
| Apr 2026 | Initial site. SEO, schema markup, Formspree forms, homepage content. |
| Apr 20–21 | Schema, hero preload, accessibility (aria), sitemap, robots.txt. |
| Apr 22 | Cynthia email batch: story rewrite, Hartland location, tarot prices, Moon Circle dates, gift card, perks ribbon, GA4, subscription page, tea page, welcome popup. 15 items shipped. |
| Apr 24–25 | Admin operations dashboard: order financial fields, catalog approval workflow, SLA aging widgets, catalog diff, rollback system. |
| May 4 | Formspree cleanup (all forms now internal to Worker). Square Payment Link checkout built. Shipping calc. order-success.html. |
| May 19 | Catalog updated to 26 products across 6 categories. |
| May 29 | Launch readiness audit. Two blockers confirmed: Square production + email delivery. |
| Jun 1 | Porkbun FTP password exposure noted. Resend-first email refactor committed locally (commit 99c4f28). |
| Jun 4 | Cloudflare Worker deployed. minarealm-shop Fly.io backend shelved. PLANS.md rewritten. |
