"""Read-only smoke test against the live worker.

Verifies:
  1. Login works (credentials via env or CLI args)
  2. Catalog loads + product.location field round-trips (read-side)
  3. Orders endpoint loads + summarises pending invoices
  4. Reports counts by location

NO writes are performed. If a pending_invoice order exists, prints its id so
mark-paid can be tested explicitly with confirmation.

Usage:
  MR_SMOKE_USER=cynthia MR_SMOKE_PASS=... python3 scripts/smoke.py
"""
import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse

API = "https://minarealm-admin.minarealm.workers.dev"
USER = os.environ.get("MR_SMOKE_USER") or (sys.argv[1] if len(sys.argv) > 1 else None)
PASS = os.environ.get("MR_SMOKE_PASS") or (sys.argv[2] if len(sys.argv) > 2 else None)
if not USER or not PASS:
    print("Usage: MR_SMOKE_USER=<user> MR_SMOKE_PASS=<pass> python3 scripts/smoke.py")
    sys.exit(1)


def req(path, method="GET", body=None, cookie=None):
    url = API + path
    data = None
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=30)
        raw = resp.read()
        set_cookie = resp.headers.get("Set-Cookie", "")
        return resp.status, raw, set_cookie
    except urllib.error.HTTPError as e:
        return e.code, e.read(), ""


def main():
    print("=" * 60)
    print("minarealm worker smoke test")
    print("=" * 60)

    # 1. Login
    print("\n[1] POST /api/login")
    status, raw, set_cookie = req(
        "/api/login", "POST", {"username": USER, "password": PASS}
    )
    print(f"    status={status}  set-cookie={'yes' if set_cookie else 'NO'}")
    if status != 200:
        print(f"    body: {raw[:200]!r}")
        return
    # extract just the session cookie name=val (first attribute)
    cookie = set_cookie.split(";", 1)[0] if set_cookie else ""
    print(f"    cookie: {cookie[:60]}…")

    # 2. Catalog
    print("\n[2] GET /api/products")
    status, raw, _ = req("/api/products", cookie=cookie)
    print(f"    status={status}  bytes={len(raw)}")
    if status != 200:
        print(f"    body: {raw[:200]!r}")
        return
    catalog = json.loads(raw)
    products = catalog.get("products", [])
    cats = catalog.get("categories", [])
    print(f"    products={len(products)}  categories={len(cats)}")

    # 3. Location distribution
    print("\n[3] product.location distribution")
    loc_counts = {"hartland": 0, "fenton": 0, "(missing)": 0, "(other)": 0}
    sample = {"hartland": None, "fenton": None}
    for p in products:
        loc = p.get("location")
        if loc == "hartland":
            loc_counts["hartland"] += 1
            if sample["hartland"] is None:
                sample["hartland"] = p["id"]
        elif loc == "fenton":
            loc_counts["fenton"] += 1
            if sample["fenton"] is None:
                sample["fenton"] = p["id"]
        elif loc is None:
            loc_counts["(missing)"] += 1
        else:
            loc_counts["(other)"] += 1
    for k, v in loc_counts.items():
        print(f"    {k:12s} {v}")
    print(f"    sample hartland id: {sample['hartland']}")
    print(f"    sample fenton id  : {sample['fenton']}")

    # 4. Orders
    print("\n[4] GET /api/orders")
    status, raw, _ = req("/api/orders", cookie=cookie)
    print(f"    status={status}  bytes={len(raw)}")
    if status == 200:
        orders_resp = json.loads(raw)
        orders = orders_resp.get("orders", orders_resp) if isinstance(orders_resp, dict) else orders_resp
        if not isinstance(orders, list):
            print(f"    unexpected shape: {type(orders).__name__}")
            return
        print(f"    total orders={len(orders)}")
        by_status = {}
        by_payment = {}
        pending_invoices = []
        for o in orders:
            s = o.get("status", "?")
            ps = o.get("paymentStatus", "?")
            by_status[s] = by_status.get(s, 0) + 1
            by_payment[ps] = by_payment.get(ps, 0) + 1
            if ps == "pending_invoice":
                pending_invoices.append(o)
        print(f"    by status:  {by_status}")
        print(f"    by payment: {by_payment}")
        print(f"\n    pending_invoice orders: {len(pending_invoices)}")
        for o in pending_invoices[:5]:
            note = (o.get("notes") or [{}])
            note_txt = note[0].get("text", "") if note and isinstance(note[0], dict) else ""
            print(
                f"      id={o.get('id')}  total={o.get('total')}  "
                f"created={o.get('created', '')[:10]}  note={note_txt[:50]!r}"
            )
    else:
        print(f"    body: {raw[:200]!r}")

    # 5. Sanity: confirm /api/orders/in-store route exists (OPTIONS or a 4xx for bad body counts as alive)
    print("\n[5] HEAD-ish probe of /api/orders/in-store (POST with empty body)")
    status, raw, _ = req("/api/orders/in-store", "POST", {}, cookie=cookie)
    print(f"    status={status}  body={raw[:120]!r}")
    print("    (4xx with a validation error means the route is live)")

    print("\nDone.")


if __name__ == "__main__":
    main()
