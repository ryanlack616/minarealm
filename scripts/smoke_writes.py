"""Mark-paid + idempotency + in-store dry-run smoke test.

Picks the OLDEST pending_invoice order and marks it paid. Then re-issues the
same mark-paid to verify 409. Captures the order's `timeline.paidAt` and any
audit entry. Does NOT create real in-store sales.

Usage:
  MR_SMOKE_USER=<user> MR_SMOKE_PASS=<pass> python3 scripts/smoke_writes.py
"""
import json
import os
import sys
import urllib.request
import urllib.error

API = "https://minarealm-admin.minarealm.workers.dev"
HEADERS_BASE = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (minarealm-smoke) AppleWebKit/537.36",
}


def req(path, method="GET", body=None, cookie=None):
    url = API + path
    headers = dict(HEADERS_BASE)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=30)
        return resp.status, resp.read(), resp.headers.get("Set-Cookie", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), ""


def main():
    user = os.environ.get("MR_SMOKE_USER") or (sys.argv[1] if len(sys.argv) > 1 else None)
    pw = os.environ.get("MR_SMOKE_PASS") or (sys.argv[2] if len(sys.argv) > 2 else None)
    if not user or not pw:
        print("Usage: MR_SMOKE_USER=<user> MR_SMOKE_PASS=<pass> python3 scripts/smoke_writes.py")
        sys.exit(1)
    # login
    s, raw, sc = req("/api/login", "POST", {"username": user, "password": pw})
    assert s == 200, raw
    cookie = sc.split(";", 1)[0]
    print(f"[login] ok  cookie={cookie[:40]}…")

    # find pending invoices
    s, raw, _ = req("/api/orders", cookie=cookie)
    orders = json.loads(raw)
    if isinstance(orders, dict):
        orders = orders.get("orders", [])
    pendings = [o for o in orders if o.get("paymentStatus") == "pending_invoice"]
    pendings.sort(key=lambda o: o.get("created", ""))
    print(f"[orders] total={len(orders)}  pending_invoice={len(pendings)}")
    if not pendings:
        print("No pending invoices to test against.")
        return
    target = pendings[0]
    oid = target["id"]
    print(f"\n[target] id={oid}  total={target.get('total')}  created={target.get('created')}")
    print(f"          existing timeline keys: {list((target.get('timeline') or {}).keys())}")

    # mark-paid
    print(f"\n[mark-paid #1] POST /api/orders/{oid}/mark-paid")
    s, raw, _ = req(f"/api/orders/{oid}/mark-paid", "POST", {}, cookie=cookie)
    print(f"   status={s}")
    print(f"   body  ={raw[:300].decode('utf-8', 'replace')}")

    # re-fetch and inspect
    s2, raw2, _ = req("/api/orders", cookie=cookie)
    after = json.loads(raw2)
    if isinstance(after, dict):
        after = after.get("orders", [])
    new_target = next((o for o in after if o.get("id") == oid), None)
    if new_target:
        print(f"\n[verify] paymentStatus = {new_target.get('paymentStatus')}")
        tl = new_target.get("timeline") or {}
        print(f"         timeline.paidAt = {tl.get('paidAt')}")
        print(f"         timeline keys    = {list(tl.keys())}")

    # idempotency: re-issue
    print(f"\n[mark-paid #2 (idempotency check)] POST /api/orders/{oid}/mark-paid")
    s, raw, _ = req(f"/api/orders/{oid}/mark-paid", "POST", {}, cookie=cookie)
    print(f"   status={s}  (expect 409 already-paid)")
    print(f"   body  ={raw[:300].decode('utf-8', 'replace')}")

    # in-store sale validation: send a structurally-valid payload but with qty=0 to trigger validation
    print(f"\n[in-store sale dry-run] qty=0 should be rejected")
    body = {
        "lines": [{"productId": "definitely-not-a-real-slug-xyz", "qty": 0, "price": 0}],
        "paymentMethod": "paid_in_store",
        "customerName": "smoke-test",
        "customerEmail": "",
        "note": "[Hartland] smoke-test validation only — should fail",
    }
    s, raw, _ = req("/api/orders/in-store", "POST", body, cookie=cookie)
    print(f"   status={s}  body={raw[:200].decode('utf-8', 'replace')}")


if __name__ == "__main__":
    main()
