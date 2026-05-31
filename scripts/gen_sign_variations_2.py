#!/usr/bin/env python3
"""
Generate 50 MORE ROCK SHOP storefront sign variations via Replicate recraft-v4-svg.
Batch 2: signs numbered 11–60, diverse styles/palettes/themes.

Usage:
    export REPLICATE_API_TOKEN=r8_...
    python3 scripts/gen_sign_variations_2.py

Cost: ~$0.08 per image × 50 = ~$4.00 USD
Output: assets/sign-variations/sign-{n:02d}-{slug}.svg  (continues from batch 1)
"""

import os
import sys
import time
from pathlib import Path

try:
    import replicate
except ImportError:
    sys.exit("replicate not installed — run: pip install replicate")

if not os.getenv("REPLICATE_API_TOKEN"):
    sys.exit("REPLICATE_API_TOKEN not set — export it first")

MODEL = "recraft-ai/recraft-v4-svg"
ASPECT_RATIO = "2:1"

OUT_DIR = Path(__file__).parent.parent / "assets" / "sign-variations"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Shared sign requirements appended to every prompt
BASE_SUFFIX = (
    "Horizontal storefront sign, exactly 10 feet wide by 2 feet tall (10:2 ratio, 5:1 aspect). "
    "Very wide and short banner composition — maximum width, minimal height. "
    "Bold text 'ROCK SHOP' reading left-to-right, centered, very large — readable from 200 feet away. "
    "Below the main text: smaller subtitle 'Crystals · Minerals · Fossils · Geodes'. "
    "Crystal or mineral artwork confined to the far left 20% and far right 20% of the banner width. "
    "Center 60% reserved for text only. "
    "Flat vector SVG, no gradients, no photorealistic textures, no tiny details, "
    "thick outlines, high contrast, print-ready commercial sign, large-format vinyl."
)

VARIATIONS = [
    # ── COLOUR PALETTE SHIFTS ─────────────────────────────────────────────────
    (
        "deep-navy",
        "Deep navy blue background #0a1628. White bold text. Gold subtitle. "
        "Left: large lapis lazuli chunk silhouette in midnight blue and gold. "
        "Right: cluster of azurite crystal points in cobalt and sapphire. "
        "Accent colours: lapis navy, cobalt blue, antique gold, icy white. "
        + BASE_SUFFIX
    ),
    (
        "forest-green",
        "Deep forest green background #0d2318. Bright white bold text. Gold subtitle. "
        "Left: malachite slab cross-section showing concentric green rings. "
        "Right: emerald crystal cluster points in vivid green. "
        "Accent colours: malachite green, jade mid-green, gold, white. "
        + BASE_SUFFIX
    ),
    (
        "deep-burgundy",
        "Deep burgundy background #2a0a12. Bright white bold text. Gold subtitle. "
        "Left: raw garnet cluster, deep red faceted crystals. "
        "Right: rhodolite garnet geode interior, raspberry and wine tones. "
        "Accent colours: garnet red, wine, rose gold, pale pink. "
        + BASE_SUFFIX
    ),
    (
        "midnight-black",
        "True black background #080808. Brilliant white bold text with thin gold outline. "
        "Left: obsidian volcanic glass shard silhouette, jet black with glassy edges. "
        "Right: large smoky quartz tower, dark grey to translucent. "
        "Accent colours: obsidian black, gunmetal, platinum, bright gold. "
        + BASE_SUFFIX
    ),
    (
        "deep-teal",
        "Deep teal background #062a2a. Bright white bold text. Seafoam subtitle. "
        "Left: chrysocolla mineral specimen, turquoise-teal swirling patterns. "
        "Right: amazonite crystal cluster, mint and teal tones. "
        "Accent colours: chrysocolla teal, amazonite mint, copper, white. "
        + BASE_SUFFIX
    ),
    (
        "warm-slate",
        "Warm dark slate background #1e1e2a. Cream-white bold text. Pale gold subtitle. "
        "Left: large labradorite slab showing iridescent flash spectrum in flat colour. "
        "Right: moonstone cabochon stack with adularescence glow shown as radiating lines. "
        "Accent colours: labradorite blue-green, moonstone grey, gold, cream. "
        + BASE_SUFFIX
    ),
    (
        "deep-indigo",
        "Deep indigo background #100a2e. Brilliant white text. Pale lavender subtitle. "
        "Left: sugilite mineral cluster in violet-purple. "
        "Right: charoite swirling purple-white crystal pattern. "
        "Accent colours: sugilite violet, charoite purple, silver, white. "
        + BASE_SUFFIX
    ),
    (
        "earth-brown",
        "Rich earth brown background #1e1208. Warm white bold text. Amber subtitle. "
        "Left: petrified wood cross-section, wood grain ring pattern in vector. "
        "Right: raw jasper chunk, burnt orange and ochre tones. "
        "Accent colours: jasper orange, petrified wood tan, amber, cream. "
        + BASE_SUFFIX
    ),
    (
        "deep-copper",
        "Dark copper-tinted background #1a0e08. White bold text. Bright copper subtitle. "
        "Left: malachite-azurite combined specimen, green with blue veining. "
        "Right: native copper nugget silhouette, metallic copper-orange. "
        "Accent colours: copper orange, malachite green, azurite blue, white. "
        + BASE_SUFFIX
    ),
    (
        "graphite-silver",
        "Dark graphite background #141416. White bold text. Silver subtitle. "
        "Left: large pyrite cube cluster, metallic gold-grey facets shown as geometric shapes. "
        "Right: galena crystal cube stack, lead-silver tones. "
        "Accent colours: pyrite gold, galena silver, graphite, bright white. "
        + BASE_SUFFIX
    ),
    # ── VISUAL STYLE THEMES ───────────────────────────────────────────────────
    (
        "art-deco",
        "Art deco 1920s glamour aesthetic. Deep black background. "
        "Left: stylised geometric crystal fan motif with sunburst rays. "
        "Right: mirrored geometric crystal fan. "
        "Text in elegant tall condensed art deco letterforms. Thin gold rule borders, chevron accents. "
        "Accent colours: black, gold, ivory, deep teal. "
        + BASE_SUFFIX
    ),
    (
        "steampunk",
        "Steampunk Victorian industrial aesthetic. Dark iron background. "
        "Left: brass gear and crystal specimen combination. "
        "Right: copper pipe fittings framing a mineral chunk. "
        "Riveted border frame, aged brass bolts at corners. "
        "Text in bold Victorian slab serif. "
        "Accent colours: brass, copper, rust, aged ivory. "
        + BASE_SUFFIX
    ),
    (
        "gothic-cathedral",
        "Gothic cathedral aesthetic. Deep charcoal with pointed arch border frame. "
        "Left: gothic pointed arch window shape filled with amethyst crystals. "
        "Right: matching gothic arch with quartz crystals. "
        "Text in bold blackletter-inspired lettering. Rose window accent at top centre. "
        "Accent colours: deep purple, iron black, gold, ivory. "
        + BASE_SUFFIX
    ),
    (
        "japanese-zen",
        "Japanese minimalist Zen aesthetic. Near-black background. "
        "Left: single large white quartz point — clean, spare, meditative. "
        "Right: small arrangement of rounded river stones with one crystal. "
        "Brushstroke horizontal rule accents. Text in clean bold sans-serif. "
        "Accent colours: white, red vermillion accent stroke, black, warm grey. "
        + BASE_SUFFIX
    ),
    (
        "celtic-knotwork",
        "Celtic knotwork mystical aesthetic. Dark forest green background. "
        "Left: Celtic trinity knot interlaced with crystal imagery. "
        "Right: Celtic spiral knot with gemstone accents. "
        "Knotwork border running along top and bottom edge of sign. "
        "Text bold, slightly rounded. Accent colours: Celtic green, gold, stone grey, cream. "
        + BASE_SUFFIX
    ),
    (
        "southwestern-desert",
        "American Southwest desert aesthetic. Terracotta and dark sand background. "
        "Left: turquoise nugget cluster with Navajo-inspired geometric border. "
        "Right: red rock mesa silhouette with crystal foreground. "
        "Geometric chevron and diamond border pattern. Bold western text. "
        "Accent colours: turquoise, terracotta, rust red, sandy cream. "
        + BASE_SUFFIX
    ),
    (
        "pacific-northwest",
        "Pacific Northwest wilderness aesthetic. Dark evergreen background. "
        "Left: mountain peak silhouette with crystal cluster at base. "
        "Right: Pacific Ocean wave silhouette with sea glass stones. "
        "Fir tree silhouettes as small accents. Bold condensed text. "
        "Accent colours: pine green, slate blue, silver birch, warm gold. "
        + BASE_SUFFIX
    ),
    (
        "egyptian-revival",
        "Egyptian revival aesthetic. Deep sand-black background. "
        "Left: Egyptian scarab hieroglyph combined with lapis lazuli crystal. "
        "Right: lotus flower motif with turquoise and carnelian gems. "
        "Hieroglyphic border strip along bottom edge. Bold geometric text. "
        "Accent colours: Egyptian gold, lapis blue, turquoise, sand. "
        + BASE_SUFFIX
    ),
    (
        "victorian-naturalist",
        "Victorian natural history museum aesthetic. Dark mahogany background. "
        "Left: detailed naturalist-style mineral specimen drawing — pyrite, quartz, mica. "
        "Right: ammonite fossil and crystal arrangement, scientific illustration style. "
        "Fine engraving-style line borders. Serif text in confident Victorian weight. "
        "Accent colours: mahogany, brass, parchment, ink black. "
        + BASE_SUFFIX
    ),
    (
        "mid-century-modern",
        "Mid-century modern 1960s atomic age aesthetic. Dark charcoal background. "
        "Left: atomic starburst with crystal at centre. "
        "Right: amoeba organic shape filled with mineral pattern. "
        "Thin line geometric accents. Bold geometric sans-serif text. "
        "Accent colours: turquoise, sunflower yellow, atomic orange, white. "
        + BASE_SUFFIX
    ),
    (
        "bauhaus",
        "Bauhaus design aesthetic. Pure black background. "
        "Left: strict geometric composition — circle, triangle, square arranged with crystal shapes. "
        "Right: mirrored geometric composition. "
        "Primary colours only: red, yellow, blue as accents. White bold sans-serif text. "
        "Clean ruled borders with precise geometry. "
        "Accent colours: red, yellow, blue, black, white. "
        + BASE_SUFFIX
    ),
    (
        "nordic-viking",
        "Nordic Viking aesthetic. Dark stormy grey background. "
        "Left: Viking rune stone texture with crystal embedded. "
        "Right: Norse Yggdrasil tree branch silhouette with crystal at roots. "
        "Runic border pattern along edges. Bold condensed text. "
        "Accent colours: ice blue, stone grey, Norse gold, bone white. "
        + BASE_SUFFIX
    ),
    (
        "moroccan-geometric",
        "Moroccan geometric tile aesthetic. Deep blue background. "
        "Left: Moroccan zellige tile star pattern with crystal at centre. "
        "Right: matching geometric pattern with gemstone colour accents. "
        "Intricate geometric border in gold along all four edges. Bold ornamental text. "
        "Accent colours: Moroccan blue, gold, deep red, emerald green. "
        + BASE_SUFFIX
    ),
    (
        "wild-west",
        "Wild West frontier saloon aesthetic. Dark walnut background. "
        "Left: sheriff star badge with crystal inlay. "
        "Right: horseshoe silhouette with turquoise stones and nuggets. "
        "Wooden plank texture border, rope-loop corner accents. Bold western font style. "
        "Accent colours: walnut brown, gold nugget, turquoise, bone. "
        + BASE_SUFFIX
    ),
    (
        "luxury-boutique",
        "Ultra-premium luxury boutique aesthetic. Near-black with hairline gold border. "
        "Left: single large perfect amethyst crystal tower, minimal, elegant. "
        "Right: single large flawless clear quartz tower. "
        "Extremely generous whitespace. Thin gold rule lines only. "
        "Text condensed and refined. Accent colours: midnight black, 24-karat gold, platinum white. "
        + BASE_SUFFIX
    ),
    # ── MINERAL TYPE FEATURES ─────────────────────────────────────────────────
    (
        "selenite-glow",
        "Selenite mineral aesthetic. Dark grey background. "
        "Left: tall selenite slab tower, pearlescent white with fine striations. "
        "Right: selenite rose desert flower cluster, white and cream. "
        "Radiating soft light lines suggesting selenite's natural glow. "
        "Accent colours: selenite white, pearl, soft grey, warm cream. "
        + BASE_SUFFIX
    ),
    (
        "tourmaline-rainbow",
        "Rainbow tourmaline aesthetic. Deep black background. "
        "Left: watermelon tourmaline cross-section — pink centre, green rim, flat vector rings. "
        "Right: multi-colour tourmaline crystal wand, showing pink, green, blue, yellow zones. "
        "Accent colours: pink, green, blue, yellow — all vivid on black. "
        + BASE_SUFFIX
    ),
    (
        "rhodonite-pink",
        "Rhodonite mineral aesthetic. Dark background. "
        "Left: rhodonite slab showing pink and black matrix veining in flat vector. "
        "Right: raw rhodonite chunk with rose-pink faces. "
        "Accent colours: rose pink, black matrix, dusty rose, white. "
        + BASE_SUFFIX
    ),
    (
        "pyrite-gold",
        "Pyrite 'fool's gold' aesthetic. Dark iron-grey background. "
        "Left: large pyrite cubic crystal cluster, geometric metallic faces. "
        "Right: pyrite dollar sign-shaped nodule silhouette, gold and grey. "
        "Emphasis on metallic geometry, cube shapes, hexagonal accents. "
        "Accent colours: pyrite gold, iron grey, brass, bright white text. "
        + BASE_SUFFIX
    ),
    (
        "labradorite-flash",
        "Labradorite mineral aesthetic. Deep slate background. "
        "Left: labradorite slab showing spectral iridescence rendered as radiating flat colour bands — blue, green, gold, orange. "
        "Right: labradorite palm stone silhouette with flash colours. "
        "Accent colours: electric blue, green flash, golden orange, slate grey. "
        + BASE_SUFFIX
    ),
    (
        "malachite-emerald",
        "Malachite mineral aesthetic. Dark background. "
        "Left: malachite slab with bulls-eye circular band pattern in flat vector, concentric green rings. "
        "Right: raw malachite cluster, vivid green botryoidal bumps. "
        "Accent colours: malachite green, dark green, gold, white. "
        + BASE_SUFFIX
    ),
    (
        "citrine-sunshine",
        "Citrine crystal aesthetic. Dark charcoal background. "
        "Left: large citrine crystal cluster, golden-yellow points. "
        "Right: natural citrine geode half cut open, amber interior. "
        "Radiating sunburst lines suggesting warmth. "
        "Accent colours: citrine yellow, amber, bright gold, warm white. "
        + BASE_SUFFIX
    ),
    (
        "obsidian-sharp",
        "Obsidian volcanic glass aesthetic. True black background. "
        "Left: obsidian arrowhead silhouette cluster — razor sharp flaked edges. "
        "Right: obsidian sphere on stand silhouette, jet black with reflected highlight. "
        "Stark high-contrast. Text in brilliant white. "
        "Accent colours: jet black, glass white highlight, gunmetal, stark red accent. "
        + BASE_SUFFIX
    ),
    (
        "tigers-eye-stripe",
        "Tiger's eye mineral aesthetic. Dark warm background. "
        "Left: tiger's eye slab showing chatoyant stripe bands — gold, brown, honey. "
        "Right: polished tiger's eye sphere silhouette. "
        "Horizontal stripe pattern as border element. "
        "Accent colours: tiger gold, warm brown, honey amber, black. "
        + BASE_SUFFIX
    ),
    (
        "fluorite-spectrum",
        "Fluorite mineral aesthetic. Dark purple background. "
        "Left: large fluorite octahedron crystal, banded purple-green. "
        "Right: fluorite cube cluster, colour-zoned purple, green, blue, yellow in flat sections. "
        "Accent colours: fluorite purple, vivid green, sky blue, golden yellow. "
        + BASE_SUFFIX
    ),
    (
        "lapis-lazuli",
        "Lapis lazuli aesthetic. Deep midnight blue background. "
        "Left: lapis lazuli slab with gold pyrite fleck accents. "
        "Right: carved lapis sphere. "
        "Egyptian-influenced border with gold star accents. "
        "Accent colours: lapis blue, gold pyrite, ultramarine, white. "
        + BASE_SUFFIX
    ),
    (
        "celestite-sky",
        "Celestite mineral aesthetic. Deep twilight blue background. "
        "Left: celestite crystal geode, pale blue-grey delicate points. "
        "Right: celestite cluster with pointed prismatic crystals in sky blue. "
        "Soft starfield dot pattern in background of crystal panels. "
        "Accent colours: celestite blue, pale grey, silver, white. "
        + BASE_SUFFIX
    ),
    (
        "aventurine-forest",
        "Green aventurine aesthetic. Dark bottle-green background. "
        "Left: rough green aventurine chunk with sparkling mica glints shown as small dots. "
        "Right: polished aventurine sphere silhouette, vivid green. "
        "Accent colours: aventurine green, gold mica, deep green, white. "
        + BASE_SUFFIX
    ),
    (
        "kyanite-blade",
        "Kyanite mineral aesthetic. Dark background. "
        "Left: long blue kyanite blade crystals fanned out. "
        "Right: kyanite wand cross-section, blue-to-white colour zoning. "
        "Accent colours: kyanite blue, indigo, white, silver. "
        + BASE_SUFFIX
    ),
    (
        "rutilated-quartz",
        "Rutilated quartz aesthetic. Charcoal background. "
        "Left: clear quartz crystal with gold needle inclusions rendered as fine lines. "
        "Right: smoky quartz sphere with rutile hair needles — spiderweb pattern inside. "
        "Accent colours: gold rutile, clear quartz, smoky grey, white. "
        + BASE_SUFFIX
    ),
    (
        "sunstone-fire",
        "Sunstone mineral aesthetic. Dark warm charcoal background. "
        "Left: sunstone with copper schiller — orange-red sparkle shown as radial lines from centre. "
        "Right: polished sunstone oval cabochon silhouette, fiery orange. "
        "Accent colours: sunstone orange, copper fire, deep red, gold. "
        + BASE_SUFFIX
    ),
    (
        "tanzanite-dusk",
        "Tanzanite mineral aesthetic. Deep violet-blue background. "
        "Left: tanzanite crystal cluster, trichroic colours: violet, blue, burgundy — shown as flat colour zones. "
        "Right: faceted tanzanite gem cut silhouette, deep violet. "
        "Accent colours: tanzanite violet, sapphire blue, burgundy, silver. "
        + BASE_SUFFIX
    ),
    # ── COMBINED / MIXED THEMES ───────────────────────────────────────────────
    (
        "cosmic-galaxy",
        "Cosmic outer-space aesthetic. Deep space black background with scattered star dots. "
        "Left: meteor-rock silhouette with embedded crystals. "
        "Right: large geode cross-section looking like a planet surface. "
        "Galaxy colour swirl accents, nebula tones. "
        "Accent colours: deep space black, nebula purple, star yellow, meteor silver. "
        + BASE_SUFFIX
    ),
    (
        "alchemy-occult",
        "Alchemical mystical aesthetic. Dark parchment-over-black background. "
        "Left: alchemical symbol circle (⊕) with crystal at centre. "
        "Right: pentagram-in-circle with gemstones at points. "
        "Astrological glyphs as small accents. Ornate gothic frame border. "
        "Accent colours: aged gold, blood red, deep purple, bone parchment. "
        + BASE_SUFFIX
    ),
    (
        "geologist-field",
        "Field geologist technical aesthetic. Charcoal background. "
        "Left: geological survey-style mineral cross-section diagram with labels. "
        "Right: topographic contour map pattern with crystal outcrop marker. "
        "Graph-paper grid dot pattern in background. Technical stencil font accents. "
        "Accent colours: survey blue, topographic brown, white, amber. "
        + BASE_SUFFIX
    ),
    (
        "coastal-sea-glass",
        "Coastal beach sea glass aesthetic. Dark ocean navy background. "
        "Left: sea glass pebbles in frosted green, blue, amber arranged in arc. "
        "Right: driftwood branch with beach crystals and sea glass. "
        "Wave-line border element. Relaxed beach house feel. "
        "Accent colours: sea glass green, ocean blue, driftwood tan, frosted white. "
        + BASE_SUFFIX
    ),
    (
        "urban-street-art",
        "Urban street art graffiti-style bold aesthetic. Black background. "
        "Left: spray-paint style crystal silhouette, drip accent lines. "
        "Right: geometric crystal with spray-burst background circle. "
        "High-contrast bold outlines, thick stroke. "
        "Accent colours: neon green, electric blue, hot pink, black, white. "
        + BASE_SUFFIX
    ),
    (
        "witchy-apothecary",
        "Witchy herb-and-crystal apothecary aesthetic. Deep purple-black background. "
        "Left: mortar-and-pestle silhouette with crystal wands and herb sprigs. "
        "Right: crescent moon shape with crystals hanging as pendants. "
        "Star and moon accent dots scattered. Ornate script-adjacent text feel. "
        "Accent colours: purple, gold, forest green, bone white. "
        + BASE_SUFFIX
    ),
    (
        "mountain-prospector",
        "Gold rush mountain prospector aesthetic. Dark rocky grey background. "
        "Left: mountain silhouette with mineshaft opening and crystal vein. "
        "Right: gold pan with nuggets and crystal specimen. "
        "Pick and shovel crossed silhouette accent. Rough-hewn border. "
        "Accent colours: gold nugget, mountain grey, iron black, bone white. "
        + BASE_SUFFIX
    ),
    (
        "neon-glow",
        "Neon sign aesthetic on black background. "
        "Left: neon tube-style crystal cluster outline glowing in electric blue. "
        "Right: neon tube-style geode outline glowing in neon pink. "
        "Text rendered as neon tube letterforms with glow halation shown as outline rings. "
        "Subtitle in turquoise neon. Pure black background. "
        "Accent colours: neon blue, neon pink, turquoise, neon gold, black. "
        + BASE_SUFFIX
    ),
    (
        "watercolour-wash",
        "Soft watercolour wash aesthetic translated to flat vector. Dark background. "
        "Left: watercolour-style crystal wash in soft amethyst, rose, teal. "
        "Right: matching soft watercolour crystal wash in citrine, turquoise, coral. "
        "Loose ink-sketch border. Text in clean bold contrast. "
        "Accent colours: soft amethyst, rose, teal, citrine, white. "
        + BASE_SUFFIX
    ),
    (
        "retro-roadside",
        "1950s American roadside attraction sign aesthetic. Warm black background. "
        "Left: retro starburst or arrow sign element pointing to crystal. "
        "Right: checkered flag pattern with crystal nugget. "
        "Neon retro letterform style text. Diner-style horizontal stripes. "
        "Accent colours: cherry red, cream, turquoise, chrome, deep black. "
        + BASE_SUFFIX
    ),
    (
        "sacred-geometry",
        "Sacred geometry Platonic solid aesthetic. Dark charcoal background. "
        "Left: Flower of Life circle pattern with crystal at centre. "
        "Right: Metatron's Cube wireframe with gemstone nodes at vertices. "
        "Fine geometric line construction as sign frame. "
        "Accent colours: gold, violet, white, deep teal. "
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
        svg_bytes = output.read()
        out_path.write_bytes(svg_bytes)
        elapsed = time.time() - t0
        size_kb = len(svg_bytes) / 1024
        print(f"       saved {out_path.name}  ({size_kb:.1f} KB, {elapsed:.1f}s)")
    except Exception as e:
        print(f"       ERROR [{slug}]: {e}")


def main():
    print(f"Model : {MODEL}")
    print(f"Output: {OUT_DIR}")
    print(f"Count : {len(VARIATIONS)} variations  (~${len(VARIATIONS) * 0.08:.2f} at $0.08/image)")
    print()

    start_n = 11  # continues from batch 1 (01–10)
    for i, (slug, prompt) in enumerate(VARIATIONS):
        n = start_n + i
        run_variation(n, slug, prompt)

    print()
    print("Done. SVGs saved to:")
    start_n = 11
    for i, (slug, _) in enumerate(VARIATIONS):
        n = start_n + i
        p = OUT_DIR / f"sign-{n:02d}-{slug}.svg"
        if p.exists():
            print(f"  {p}")


if __name__ == "__main__":
    main()
