"""Render each new cell size directly from the bundled font (never resize the 60px atlas)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib,json
root=Path(__file__).resolve().parents[1]
raw=(root/'public/mode4-palette.txt').read_bytes()
chars=raw.decode('cp932').replace('\r','').replace('\n','')
assert len(chars)==len(set(chars))==170
fontpath=root/'public/fonts/NotoSansMonoCJKjp-Regular.otf'
profiles={}
for cell in (40,30):
 font=ImageFont.truetype(str(fontpath),cell); baseline=round(cell*.85)
 masks=bytearray();atlas=Image.new('L',(cell*10,cell*17));records=[]
 for i,c in enumerate(chars):
  full=Image.new('L',(cell*3,cell*3))
  ImageDraw.Draw(full).text((cell,cell*1.5),c,font=font,fill=255,anchor='ls')
  box=full.getbbox();assert box
  left=box[0]-cell+round((cell-font.getlength(c))/2)
  top=box[1]-cell*1.5+baseline
  ink=full.crop(box);scale=min(1,cell/ink.width,cell/ink.height)
  if scale<1:ink=ink.resize((round(ink.width*scale),round(ink.height*scale)),Image.Resampling.LANCZOS)
  left=max(0,min(cell-ink.width,round(left)));top=max(0,min(cell-ink.height,round(top)))
  im=Image.new('L',(cell,cell));im.paste(ink,(left,top))
  masks.extend(im.tobytes());atlas.paste(im,((i%10)*cell,(i//10)*cell))
  records.append({'char':c,'cp932':list(c.encode('cp932')),'bbox':im.getbbox(),'overflowFitScale':scale})
 digest=hashlib.sha256(masks).hexdigest()
 meta={'cell':cell,'fontSize':cell,'baseline':baseline,'engine':cell*100+1,'step':cell//10,'paletteCount':170,'fontSHA256':hashlib.sha256(fontpath.read_bytes()).hexdigest(),'maskSHA256':digest,'glyphs':records}
 (root/f'public/mode4-atlas{cell}.bin').write_bytes(masks);atlas.save(root/f'public/mode4-atlas{cell}.png')
 (root/f'public/mode4-atlas{cell}.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
 profiles[cell]={'cell':cell,'engine':meta['engine'],'step':meta['step'],'hash':digest,'bounds':[r['bbox'] for r in records],
  'sigma':4 if cell==40 else 3,'high':.0375 if cell==40 else .05,'low':.01875 if cell==40 else .025,'minEdge':6 if cell==40 else 4,'minComponent':8 if cell==40 else 6,'inkSigma':.65 if cell==40 else .5,'inkGain':1.9 if cell==40 else 1.6,'limit':.34}
(root/'public/mode4-small-profiles.js').write_text('export const SMALL_PROFILES='+json.dumps(profiles,separators=(',',':'))+';\n',encoding='utf-8')
print(json.dumps({c:{k:v for k,v in p.items() if k!='bounds'} for c,p in profiles.items()}))
