#!/usr/bin/env python3
"""
Generate 10 ROCK SHOP storefront sign variations via Replicate recraft-v4-svg.

Usage:
    # Put REPLICATE_API_TOKEN in ~/rje/dev/.env (untracked), then:
    python3 scripts/gen_sign_variations.py

Cost: ~$0.08 per image × 10 = ~$0.80 USD
Output: assets/sign-variations/sign-{n:02d}-{slug}.svg
"""

import os
import sys
import time
from pathlib import Path

try:
    import replicate
except ImportError:
    sys.exit("replicate not installed — run: pip install replicate")


def _load_env():
    """Load KEY=VALUE pairs from untracked .env files (no dependency).

    Reads ~/rje/dev/.env then the repo-local .env; never overrides a value
    already set in the environment. Keeps secrets out of inline commands.
    """
    candidates = [
        Path.home() / "rje" / "dev" / ".env",
        Path(__file__).resolve().parent.parent / ".env",
    ]
    for envf in candidates:
        if not envf.is_file():
            continue
        for line in envf.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip().strip('"').strip("'")
            os.environ.setdefault(key, val)


_load_env()

if not os.getenv("REPLICATE_API_TOKEN"):
    sys.exit("REPLICATE_API_TOKEN not set — add it to ~/rje/dev/.env")

MODEL = "recraft-ai/recraft-v4-svg"
ASPECT_RATIO = "2:1"   # closest available to 10:2 (5:1) sign

OUT_DIR = Path(__file__).parent.parent / "assets" / "sign-variations"
OUT_DIR.mkdir(parents=True, exist_ok=True)

BASE_SUFFIX = (
    "Horizontal storefront sign, exactly 10 feet wide by 2 feet tall (10:2 ratio, 5:1 aspect). "
    "Very wide and short banner composition — maximum width, minimal height. "
    "Deep charcoal background #1a1820. Bright white bold text 'ROCK SHOP' "
    "reading left-to-right, centered, very large — readable from 200 feet away. "
    "Below the main text: smaller subtitle 'Crystals · Minerals · Fossils · Geodes' in gold. "
    "Crystal artwork confined to the far left 20% and far right 20% of the banner width. "
    "Center 60% reserved for text only. "
    "Flat vector SVG, no gradients, no photorealistic textures, no tiny details, "
    "thick outlines, high contrast, print-ready commercial sign, large-format vinyl."
)

VARIATIONS = [
    (
        "quartz-crystal",
        "Large white quartz crystal clusters framing left and right sides of the sign. "
        "Crystal points in clear quartz white and pale grey. "
        "Accent colours: icy blue, pale lavender, mineral grey. "
        + BASE_SUFFIX
    ),
    (
        "amethyst-geode",
        "Giant amethyst geode halves cut open showing purple crystal druzy interior "
        "on left and right sides of the sign. "
        "Deep violet and purple crystal clusters, lilac highlights. "
        "Accent colours: amethyst purple #6a2594, lavender, deep violet. "
        + BASE_SUFFIX
    ),
    (
        "agate-slice",
        "Large circular agate slice cross-sections on left and right — concentric ring "
        "patterns in flat vector. "
        "Agate slice banding colours: orange, red, cream, terracotta, rust. "
        "Accent colours: agate orange, warm red, stone cream. "
        + BASE_SUFFIX
    ),
    (
        "fossil-crystal",
        "Left side: large ammonite fossil spiral. Right side: quartz crystal cluster. "
        "Additional small fossil silhouettes (trilobite, leaf fossil) as accents. "
        "Accent colours: fossil bone cream, amber, mineral blue. "
        + BASE_SUFFIX
    ),
    (
        "vintage-mining",
        "Vintage 1890s mining aesthetic. Pickaxe and gold nuggets silhouette on left. "
        "Crystal cluster on right. Aged serif lettering style, distressed border frame. "
        "Worn banner ribbon beneath subtitle. "
        "Accent colours: antique gold, rust, dark copper, aged cream. "
        + BASE_SUFFIX
    ),
    (
        "modern-museum",
        "Clean modern mineral museum aesthetic. Geometric crystal diagrams and mineral "
        "cross-section circles arranged symmetrically left and right. "
        "Scientific illustration style, thin precise lines. "
        "Accent colours: slate blue, mineral teal, warm white, brushed gold. "
        + BASE_SUFFIX
    ),
    (
        "rustic-northern",
        "Rustic northern wilderness rock shop. Pine tree silhouettes and mountain ridge "
        "behind crystal clusters on left and right. Handcrafted woodcut style vector. "
        "Bold slab-serif lettering. "
        "Accent colours: forest green, birch white, copper ore, spruce brown. "
        + BASE_SUFFIX
    ),
    (
        "gemstone-collector",
        "Gemstone collector aesthetic. Faceted gemstone cuts (emerald cut, oval, teardrop) "
        "arranged decoratively on left and right — turquoise, garnet, citrine, sapphire. "
        "Diamond wireframe outlines. Jewellery display style. "
        "Accent colours: turquoise, deep red garnet, citrine yellow, sapphire blue. "
        + BASE_SUFFIX
    ),
    (
        "lapidary-workshop",
        "Lapidary workshop aesthetic. Polished cabochon stones on left, raw rough mineral "
        "specimen on right. Grinding wheel silhouette accent. Industrial precision feel. "
        "Accent colours: copper, iron grey, polished turquoise, raw crystal white. "
        + BASE_SUFFIX
    ),
    (
        "crystal-gallery",
        "Premium crystal gallery aesthetic. Elegant large amethyst tower on left, "
        "large clear quartz tower on right. Luxury boutique signage feel. "
        "Thin gold rule borders, generous spacing, refined typography. "
        "Accent colours: pale gold, soft violet, ice white, champagne. "
        + BASE_SUFFIX
    ),
]

def run_variation(n, slug, prompt):
    out_path = OUT_DIR / f"sign-{n:02d}-{slug}.svg"
    if out_path.exists():
        print(f"  [{n:02d}] SKIP (exists): {out_path.name}")
        return

    print(f"  [{n:02d}] Generating: {slug} ...", flush=True)
    t0 = time.time()
    try:
        output = replicate.run(
            MODEL,
            input={
                "prompt": prompt,
                "aspect_ratio": ASPECT_RATIO,
            }
        )
        # output is a FileOutput object — read bytes and write
        svg_bytes = output.read()
        out_path.write_bytes(svg_bytes)
        elapsed = time.time() - t0
        size_kb = len(svg_bytes) / 1024
        print(f"       saved {out_path.name}  ({size_kb:.1f} KB, {elapsed:.1f}s)")
    except Exception as e:
        print(f"       ERROR: {e}")

def main():
    print(f"Model : {MODEL}")
    print(f"Output: {OUT_DIR}")
    print(f"Count : {len(VARIATIONS)} variations  (~$0.80 at $0.08/image)")
    print()

    for n, (slug, prompt) in enumerate(VARIATIONS, 1):
        run_variation(n, slug, prompt)
        # brief pause between requests
        if n < len(VARIATIONS):
            time.sleep(1)

    print()
    print("Done. SVGs saved to:")
    for f in sorted(OUT_DIR.glob("sign-*.svg")):
        print(f"  {f}")

if __name__ == "__main__":
    main()
