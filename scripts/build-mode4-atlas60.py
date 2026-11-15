"""60px Noto glyphs in 60px cells. Preserve all 170 CP932 characters."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib,json
root=Path(__file__).resolve().parents[1]
raw=(root/'public/mode4-palette.txt').read_bytes()
assert hashlib.sha256(raw).hexdigest()=='b764b8f920d047cfed428f6550ca6d03b7cdd78ba25d7505d7e5e2b5352458d1'
chars=raw.decode('cp932').replace('\r','').replace('\n','')
assert len(chars)==len(set(chars))==170
fontpath=root/'public/fonts/NotoSansMonoCJKjp-Regular.otf'
font=ImageFont.truetype(str(fontpath),60)
masks=bytearray(); atlas=Image.new('L',(600,1020)); records=[]
for i,c in enumerate(chars):
 # Rasterize beyond the em box before fitting, so no part of a glyph is clipped.
 full=Image.new('L',(180,180)); ImageDraw.Draw(full).text((60,90),c,font=font,fill=255,anchor='ls')
 box=full.getbbox(); assert box
 # Keep font advance centering and a shared baseline, shifting only overflow.
 x=round((60-font.getlength(c))/2); y=51
 left,top,right,bottom=[box[0]-60+x,box[1]-90+y,box[2]-60+x,box[3]-90+y]
 ink=full.crop(box); scale=min(1,60/ink.width,60/ink.height)
 if scale<1: ink=ink.resize((round(ink.width*scale),round(ink.height*scale)),Image.Resampling.LANCZOS)
 left=max(0,min(60-ink.width,left));top=max(0,min(60-ink.height,top))
 im=Image.new('L',(60,60));im.paste(ink,(left,top))
 masks.extend(im.tobytes());atlas.paste(im,((i%10)*60,(i//10)*60))
 records.append({'char':c,'codepoint':f'U+{ord(c):04X}','cp932':list(c.encode('cp932')),'bbox':im.getbbox(),'overflowFitScale':scale})
(root/'public/mode4-atlas60.bin').write_bytes(masks)
atlas.save(root/'public/mode4-atlas60.png')
meta={'cell':60,'fontSize':60,'baseline':51,'paletteCount':170,'sourceSHA256':hashlib.sha256(raw).hexdigest(),'fontSHA256':hashlib.sha256(fontpath.read_bytes()).hexdigest(),'maskSHA256':hashlib.sha256(masks).hexdigest(),'glyphs':records}
(root/'public/mode4-atlas60.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
(root/'public/mode4-palette60.js').write_text("export {GRID120_CHARS as MODE4_CHARS,GRID120_BYTES as MODE4_BYTES} from './mode4-palette.js';\nexport const MODE4_MASK_SHA256="+json.dumps(meta['maskSHA256'])+';\n')
print(json.dumps({k:v for k,v in meta.items() if k!='glyphs'}))
