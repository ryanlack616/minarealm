# minarealm.shop — Launch-Readiness Audit

**Audited:** 2026-05-29 by Claude-Howell (CH-260529-2), autonomously while Ryan was away.
**Scope:** Non-destructive state audit — live health, local-vs-deployed drift, blocker list. No live infra was touched. One **local** commit was made (reversible, not pushed/deployed).

---

## ✅ What is live and healthy

| Component | URL | Status |
|---|---|---|
| Storefront | https://minarealm.shop/shop/ | HTTP 200 |
| Site root | https://minarealm.shop/ | HTTP 200 |
| Catalog API | `/api/products` (GET, public) | 26 products, 6 categories, updated 2026-05-19 |
| Admin worker | minarealm-admin.minarealm.workers.dev | Up; admin routes Bearer-gated (401 as expected) |

The storefront and admin are functionally complete and serving. **The gap to launch is credentials/business config, not code.**

---

## 🚧 Launch blockers

### 1. Square is in SANDBOX (Cynthia-gated — business decision)
`worker/wrangler.toml` has `SQUARE_ENV = "sandbox"`. Real payments will not process.
**To fix:** obtain Square **production** credentials, then:
```
cd worker
wrangler secret put SQUARE_ACCESS_TOKEN
wrangler secret put SQUARE_LOCATION_ID
wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
# then set SQUARE_ENV = "production" in wrangler.toml and: wrangler deploy
```

### 2. Email delivery is broken on the deployed worker (code fix ready, needs a key)
The **live** worker still sends via MailChannels, whose free Cloudflare Workers tier **ended in 2024** — order confirmations / contact / booking emails are very likely **not being delivered**.

A fix was already in progress locally (prior session) and I have **committed it locally** (commit `99c4f28`, NOT deployed): a new `deliverEmail()` helper that prefers **Resend** and falls back to MailChannels, logging failures instead of swallowing them.

**To finish (Ryan/Cynthia):**
1. Create a Resend account; verify the sending domain `minarealm.shop` (adds DNS records).
2. `cd worker && wrangler secret put RESEND_API_KEY`
3. Add `EMAIL_FROM = "orders@minarealm.shop"` under `[vars]` in `wrangler.toml`.
4. `wrangler deploy`.

---

## 📦 Local repo state (handled)

There were ~38 "modified" files in the working tree. Investigation: **almost all are CRLF→LF line-ending rewrites** (e.g. `data/products.json` is 569 insertions / 569 deletions — identical content). The only files with **real semantic changes** were committed locally as `99c4f28`:

- `worker/src/index.js` — `deliverEmail()` Resend refactor (5 call sites; `node --check` passes)
- `worker/wrangler.toml` — documents `RESEND_API_KEY` + `EMAIL_FROM`
- `shop/index.html`, `admin/index.html` — favicon path fix `/logo.svg` → `/assets/logo.svg`

The remaining whitespace-only diffs were left unstaged.

**I did not push or deploy** — deploying to live infra is your call (and blocked on the Resend/Square credentials above anyway).

---

## Recommended next steps (in order)
1. **Cynthia decision:** confirm go-live → get Square production credentials.
2. Set up Resend + `RESEND_API_KEY` (unblocks order-confirmation emails).
3. Review/keep local commit `99c4f28`; `wrangler deploy` the worker.
4. Flip `SQUARE_ENV = "production"`; redeploy; place one real test order.
5. Static deploy (if shop/admin HTML changed): `python _deploy.py` (Porkbun FTPS) or Porkbun web file manager if FTP times out.

> Steps 1–2 are credential/business gated. Once they're in hand, 3–5 are ~15 minutes of mechanical deploy work.
