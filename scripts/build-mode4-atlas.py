"""Build the canonical Mode 4 raster from the exact supplied CP932 bytes.
No normalization, substitutions, palette filtering or per-glyph scaling.
The same 120px coverage masks are used by matching and every renderer.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib,json,shutil
root=Path(__file__).resolve().parents[1]
source=root/'public/mode4-palette.txt'
raw=source.read_bytes()
text=raw.decode('cp932')
chars=text.replace('\r','').replace('\n','')
assert len(chars)==170 and len(set(chars))==170
assert ''.join(chars).encode('cp932').decode('cp932')==chars
fontpath=root/'public/fonts/NotoSansMonoCJKjp-Regular.otf'
fontsha=hashlib.sha256(fontpath.read_bytes()).hexdigest()
assert fontsha=='4d01725be822d144cf9a56ade981e6fb920cd7a610b8fc24cc601a920beea5b9'
font=ImageFont.truetype(str(fontpath),104)
bounds=[font.getbbox(c,anchor='ls') for c in chars]
top=min(b[1] for b in bounds);bottom=max(b[3] for b in bounds)
baseline=(120-(bottom-top))//2-top
masks=bytearray();atlas=Image.new('L',(1200,2040))
records=[]
for i,c in enumerate(chars):
 im=Image.new('L',(120,120));draw=ImageDraw.Draw(im)
 x=(120-font.getlength(c))/2
 draw.text((x,baseline),c,font=font,fill=255,anchor='ls')
 box=im.getbbox()
 assert box and box[0]>0 and box[1]>0 and box[2]<120 and box[3]<120,(c,box)
 masks.extend(im.tobytes());atlas.paste(im,((i%10)*120,(i//10)*120))
 records.append({'char':c,'codepoint':f'U+{ord(c):04X}','cp932':list(c.encode('cp932')),'bbox':box})
(root/'public/mode4-atlas.bin').write_bytes(masks)
atlas.save(root/'public/mode4-atlas.png')
meta={'cell':120,'fontSize':104,'baseline':baseline,'paletteCount':len(chars),'duplicates':[],
 'sourceEncoding':'CP932','sourceSHA256':hashlib.sha256(raw).hexdigest(),'fontSHA256':fontsha,
 'maskSHA256':hashlib.sha256(masks).hexdigest(),'glyphs':records}
(root/'public/mode4-atlas.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(root/'public/mode4-palette.js').write_text(
 '// Generated directly from the supplied CP932 file. Do not normalize.\n'
 +'export const GRID120_CHARS='+json.dumps(chars,ensure_ascii=False)+';\n'
 +'export const GRID120_BYTES='+json.dumps([r['cp932'] for r in records])+';\n'
 +'export const GRID120_MASK_SHA256='+json.dumps(meta['maskSHA256'])+';\n',encoding='utf-8')
print(json.dumps({k:v for k,v in meta.items() if k!='glyphs'}))
