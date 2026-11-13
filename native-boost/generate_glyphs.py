"""Create pixel-feature atlases from the exact, user-approved 272 CP932 glyphs.
No font files are included in the compiled program or distributed ZIP.
"""
from pathlib import Path
import re
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "public" / "mode4-allowed.js"
txt = SOURCE.read_text("utf-8")
match = re.search(r'MODE4_ALLOWED_CHARS\s*=\s*"([^"]+)"', txt)
if not match:
    raise RuntimeError("Mode 4 allowlist is missing")
GLYPHS = match.group(1)
assert len(GLYPHS) == len(set(GLYPHS)) == 272
FONT = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
if not FONT.exists():
    FONT = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc")
if not FONT.exists():
    raise RuntimeError("Install fonts-noto-cjk to generate the native glyph atlas")
OUT = ROOT / "glyphs.hpp"
font = ImageFont.truetype(str(FONT), 29)


def feature(img, scale):
    # The source characters are monochrome strokes; match their *boundaries*
    # to actual image contours instead of chasing global brightness alone.
    edges = img.filter(ImageFilter.FIND_EDGES)
    down = edges.resize((scale, scale), Image.Resampling.BOX)
    values = list(down.getdata())
    peak = max(max(values), 1)
    return [min(255, round(v * 255 / peak)) for v in values]


rows = []
for char in GLYPHS:
    raw = char.encode("cp932")
    if len(raw) != 2:
        raise RuntimeError(f"Non-double-width glyph in approved Mode 4: {char}")
    canvas = Image.new("L", (36, 36))
    draw = ImageDraw.Draw(canvas)
    bbox = draw.textbbox((0, 0), char, font=font)
    draw.text(((36 - (bbox[2] - bbox[0])) / 2 - bbox[0],
               (36 - (bbox[3] - bbox[1])) / 2 - bbox[1]), char, 255, font=font)
    rows.append((char, raw, feature(canvas, 4), feature(canvas, 8)))
with OUT.open("w", encoding="utf-8") as f:
    f.write("// All 272 allowed CP932 glyphs, Noto CJK-derived pixel features.\n")
    f.write("#pragma once\n#include <cstdint>\n")
    f.write("struct Glyph { unsigned char lead, trail; uint8_t coarse[16], fine[64]; };\n")
    f.write("static constexpr Glyph GLYPHS[] = {\n")
    for char, raw, coarse, fine in rows:
        f.write("  {0x%02x,0x%02x,{%s},{%s}}, // %s\n" %
                (raw[0], raw[1], ",".join(map(str, coarse)),
                 ",".join(map(str, fine)), char))
    f.write("};\n")
print(f"Generated {len(rows)} user-approved glyphs to {OUT}")
