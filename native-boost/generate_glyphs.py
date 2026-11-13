"""Generate a tiny edge-feature atlas for PC Boost. No font file is distributed."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

GLYPHS = "─│／＼┼┌┐└┘〇・口人八リ三┬┴├┤王凹一工乙◯トニ日木品〒＿￣∧∨⊥小川入八十"
FONT = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
if not FONT.exists():
    FONT = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc")
OUT = Path(__file__).with_name("glyphs.hpp")
font = ImageFont.truetype(str(FONT), 29)
rows = []
for char in dict.fromkeys(GLYPHS):
    raw = char.encode("cp932")
    assert len(raw) == 2, char
    image = Image.new("L", (36, 36))
    draw = ImageDraw.Draw(image)
    bb = draw.textbbox((0, 0), char, font=font)
    draw.text(((36 - (bb[2] - bb[0])) / 2 - bb[0],
               (36 - (bb[3] - bb[1])) / 2 - bb[1]), char, 255, font=font)
    # Edge features rather than glyph fill: match to contours in the source frame.
    sharp = image.filter(ImageFilter.FIND_EDGES)
    tiny = sharp.resize((4, 4), Image.Resampling.BOX)
    mask = list(tiny.getdata())
    scale = max(max(mask), 1)
    mask = [min(255, round(v / scale * 255)) for v in mask]
    rows.append((char, raw[0], raw[1], mask))
with OUT.open("w", encoding="utf-8") as f:
    f.write("// Generated 4x4 edge-feature atlas (derived from a libre CJK font).\n")
    f.write("#pragma once\n#include <cstdint>\n")
    f.write("struct Glyph { unsigned char lead, trail; uint8_t mask[16]; };\n")
    f.write("static constexpr Glyph GLYPHS[] = {\n")
    for char, a, b, mask in rows:
        f.write("  {0x%02x,0x%02x,{%s}}, // %s\n" %
                (a, b, ",".join(map(str, mask)), char))
    f.write("};\n")
print(f"Generated {len(rows)} glyphs to {OUT}")
