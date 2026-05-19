# Minarealm Cloud Backend — Setup

This sets up Cloudflare Workers + R2 (image storage) + KV (catalog & orders).
**Cost: $0/mo** at this volume. **Time: ~10 minutes**, one-time.

---

## 1. Install Wrangler (Cloudflare CLI)

```powershell
npm install -g wrangler
wrangler login
```

A browser opens — sign up / log in to Cloudflare (free, no card).

## 2. Create the R2 bucket (image storage)

```powershell
wrangler r2 bucket create minarealm-images
wrangler r2 bucket dev-url enable minarealm-images
```

The second command prints a public URL like `https://pub-XXXXXX.r2.dev`.
**Copy it.** Open `wrangler.toml` and replace `pub-REPLACE.r2.dev` with that URL.

## 3. Create the KV namespace (catalog + orders + sessions)

```powershell
wrangler kv namespace create MINAREALM_KV
```

It prints something like:

```toml
[[kv_namespaces]]
binding = "MINAREALM_KV"
id = "abcd1234..."
```

**Copy that `id` value.** Open `wrangler.toml` and replace `REPLACE_WITH_KV_ID` with it.

## 4. Set the bootstrap password as a secret

```powershell
wrangler secret put ADMIN_PASSWORD
```

When prompted, use a long random password (at least 16 chars), for example:

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

This is the **bootstrap password** — used only the first time anyone signs in,
to create Cynthia's owner account. After that, each user has their own password
(managed from the Users tab inside /admin/).

## 5. Deploy the worker

```powershell
cd C:\rje\dev\minarealm\worker
wrangler deploy
```

It prints a URL like `https://minarealm-admin.YOURACCT.workers.dev`. **Copy it.**

## 6. Wire the URL into the site

Open both files and replace `https://minarealm-admin.REPLACE.workers.dev` with
the URL from step 5:

- `C:\rje\dev\minarealm\admin\index.html`  (line near top: `const API = ...`)
- `C:\rje\dev\minarealm\shop\index.html`   (line near top: `const API = ...`)

## 7. Seed the catalog (one-time)

Pushes the current `data/products.json` into KV so the live site stays identical.
This is also what creates Cynthia's owner account on first run.

```powershell
cd C:\rje\dev\minarealm\worker
node seed.js https://minarealm-admin.YOURACCT.workers.dev cynthia <ADMIN_PASSWORD>
```

(`cynthia` becomes the first owner account. `<ADMIN_PASSWORD>` is the ADMIN_PASSWORD secret.)

## 8. Deploy the static site

```powershell
cd C:\rje\dev\minarealm
C:\Python314\python.exe -X utf8 _deploy.py
```

## 9. Verify

- Visit <https://minarealm.shop/shop/> — products still show.
- Visit <https://minarealm.shop/admin/> — log in as `cynthia` with the bootstrap password.
- You will be required to change the owner password before continuing.
- Header shows "cynthia (owner)" — with **Users** and **Activity** tabs visible.
- Edit a price/stock — should auto-save.
- Drag a photo — uploads to R2, URL fills in.
- Place a test order from the shop — appears in admin Orders tab within 60s.
- Open Activity tab — you should see the login + catalog.save + order.create entries.

---

## Adding staff (Cynthia / owner only)

1. Sign in as `cynthia`.
2. Click **Users** tab → **+ Add User**.
3. Pick a username (e.g. `sarah`), display name, role (**admin** for staff), and a starting password.
4. Tell them their username + password. They can change their own password from the **Change Password** button after signing in.

Staff (`admin` role) can edit inventory, manage orders, upload images. They
**cannot** see the Users or Activity tabs — those are owner-only.

Every edit, login, order change, and image upload is recorded in the
**Activity** tab (kept for 365 days). Filter by user or action to see who
did what and when.

---

## Day-to-day for Cynthia

- **Update inventory:** open <https://minarealm.shop/admin/>, log in, click ± buttons or type new stock numbers. Saves itself.
- **Add a photo:** click a product's Edit, drag photo onto the dropzone. Done.
- **Add a product:** click "+ Add Product", fill in name/price/stock, drag photos.
- **See orders:** click the "Orders" tab. Mark Fulfilled when shipped/picked up.
- Email backup: every new order **also** emails `cynthia@minarealm.org` via Formspree.

## Costs at our volume

- Workers: 100k requests/day free. We won't exceed.
- R2: 10 GB free + zero egress fees. Our images are ~50 KB each → 200,000 photos free.
- KV: 100k reads/day, 1k writes/day free. Plenty.

## Re-deploying the Worker (after code changes)

```powershell
cd C:\rje\dev\minarealm\worker
wrangler deploy
```

## Changing your own password

Click **Change Password** in the admin header. Enter current + new. Done.

## Forgot a staff password

As owner, open Users tab → click **Reset PW** next to that user → type the new password → tell them.

## Changing the bootstrap password

```powershell
wrangler secret put ADMIN_PASSWORD
```

This only affects future bootstrap (and is irrelevant once any user exists).
Live accounts are unaffected.
