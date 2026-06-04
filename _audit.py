#!/usr/bin/env python3
"""Site audit: missing images, broken local refs, placeholder text."""
import re, os, json

base = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(base, "index.html"), encoding="utf-8") as f:
    html = f.read()

# --- Image refs (src=)
img_refs = re.findall(r'src=["\']([^"\']+)["\']', html)
img_refs = [x for x in img_refs if re.search(r'\.(jpg|jpeg|png|svg|avif|webp)', x, re.I)]

print("=== ALL IMAGE REFS ===")
missing = []
for ref in sorted(set(img_refs)):
    if ref.startswith("http"):
        status = "REMOTE"
    else:
        local_path = os.path.join(base, ref.lstrip("/"))
        exists = os.path.exists(local_path)
        status = "OK" if exists else "MISSING"
        if not exists:
            missing.append(ref)
    print(f"  [{status}] {ref}")

print(f"\n=== MISSING LOCAL IMAGES ({len(missing)}) ===")
for m in missing:
    print(f"  {m}")

# --- href links (local only)
hrefs = re.findall(r'href=["\']([^"\'#]+)["\']', html)
local_hrefs = [h for h in hrefs if not h.startswith("http") and not h.startswith("mailto") and not h.startswith("tel")]
print(f"\n=== LOCAL HREF TARGETS ===")
broken_links = []
for href in sorted(set(local_hrefs)):
    target = href.split("?")[0].split("#")[0]
    if not target:
        continue
    local_path = os.path.join(base, target.lstrip("/"))
    # check if file or dir exists
    exists = os.path.exists(local_path) or os.path.exists(local_path + "index.html")
    status = "OK" if exists else "MISSING"
    if not exists:
        broken_links.append(href)
    print(f"  [{status}] {href}")

print(f"\n=== BROKEN LOCAL LINKS ({len(broken_links)}) ===")
for b in broken_links:
    print(f"  {b}")

# --- placeholder text patterns
print("\n=== PLACEHOLDER / TODO TEXT ===")
patterns = [
    (r'coming soon', "Coming soon"),
    (r'placeholder', "Placeholder"),
    (r'lorem ipsum', "Lorem ipsum"),
    (r'between practitioners', "Between practitioners"),
    (r'TODO|FIXME|PLACEHOLDER', "Dev note"),
    (r'your name|your email', "Form placeholder"),
]
for pattern, label in patterns:
    matches = re.findall(r'.{0,60}' + pattern + r'.{0,60}', html, re.IGNORECASE)
    for m in matches[:3]:
        print(f"  [{label}] ...{m.strip()}...")

# --- background-image urls
print("\n=== BACKGROUND IMAGE URLS (CSS) ===")
bg_urls = re.findall(r'url\(["\']?([^"\')\s]+)["\']?\)', html)
bg_imgs = [u for u in bg_urls if re.search(r'\.(jpg|jpeg|png|svg|avif|webp)', u, re.I)]
for u in sorted(set(bg_imgs)):
    if u.startswith("http"):
        print(f"  [REMOTE] {u}")
    else:
        local_path = os.path.join(base, u.lstrip("/"))
        exists = os.path.exists(local_path)
        print(f"  [{'OK' if exists else 'MISSING'}] {u}")

# --- sections with no images
print("\n=== SECTIONS (check for image slots) ===")
sections = re.findall(r'<section[^>]*id=["\']([^"\']+)["\']', html)
for s in sections:
    print(f"  section#{s}")
