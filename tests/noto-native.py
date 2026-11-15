"""Packaged private-font registration, CPU/GPU raster and MP4 smoke tests."""
from pathlib import Path
import subprocess,sys,os,json,re,hashlib,shutil
from PIL import Image
root=Path(__file__).resolve().parents[1]
app=Path(sys.argv[1]).resolve()
out=root/'noto-validation';out.mkdir(exist_ok=True)
font=app/'app/fonts/NotoSansMonoCJKjp-Regular.otf'
assert hashlib.sha256(font.read_bytes()).hexdigest()=='4d01725be822d144cf9a56ade981e6fb920cd7a610b8fc24cc601a920beea5b9'
chars=re.search(r'CHARS = "(.*?)"',(root/'public/mode4-allowed.js').read_text(encoding='utf-8')).group(1)
assert len(chars)==272
rows=[chars[i:i+16] for i in range(0,len(chars),16)]
report={'platform':sys.platform,'fontBytes':font.stat().st_size,'glyphs':len(chars),'runs':[],'warp':os.environ.get('TASL_TEST_WARP')=='1'}
for native in [False,True]:
 width,height=32*(8 if native else 12),len(rows)*(16 if native else 24)
 tsl=out/('noto-'+str(native)+'.TSL')
 header=f'1.08\r\n1\r\n32\r\n{len(rows)}\r\n'+('# PC98_FONT_16X16\r\n' if native else '')
 tsl.write_bytes(header.encode()+b'\f\r\n1 12\r\n0 0\r\n\f\r\n'+'\r\n'.join(rows).encode('cp932')+b'\r\n\f\r\n\x1a')
 images=[]
 for engine in ['tsl_render','tsl_render_gpu']:
  p=subprocess.run([str(app/(engine+'.exe')),'--input',str(tsl),'--fps','5'],capture_output=True,timeout=120)
  assert p.returncode==0,p.stderr.decode(errors='replace')
  assert b'FONT_FACE Noto Sans Mono CJK JP' in p.stderr
  assert len(p.stdout)==width*height*4,(engine,len(p.stdout),width,height)
  im=Image.frombytes('RGBA',(width,height),p.stdout,'raw','BGRA');im.putalpha(255)
  im.save(out/(engine+'-'+str(native)+'.png'))
  images.append(p.stdout)
  report['runs'].append({'engine':engine,'native16':native,'width':width,'height':height,'stderr':p.stderr.decode(errors='replace'),'bytes':len(p.stdout)})
 assert images[0]==images[1],'CPU/GPU glyph atlas mismatch'
 raw=out/('noto-'+str(native)+'.bgra');raw.write_bytes(images[1])
 mp4=out/('noto-'+str(native)+'.mp4')
 subprocess.run([str(app/'ffmpeg.exe'),'-y','-v','error','-f','rawvideo','-pix_fmt','bgra','-s',f'{width}x{height}','-r','5','-i',str(raw),'-c:v','libx264','-pix_fmt','yuv420p',str(mp4)],check=True,timeout=90)
 probe=json.loads(subprocess.check_output([str(app/'ffprobe.exe'),'-v','error','-show_streams','-of','json',str(mp4)]))
 stream=probe['streams'][0]
 assert (stream['width'],stream['height'],stream['r_frame_rate'])==(width,height,'5/1')
 report['runs'][-1]['mp4Bytes']=mp4.stat().st_size
# Separate process with no bundled font must fail, even if an OS face exists.
empty=out/'missing-font';empty.mkdir(exist_ok=True)
shutil.copy2(app/'tsl_render.exe',empty/'tsl_render.exe')
p=subprocess.run([str(empty/'tsl_render.exe'),'--input',str(tsl),'--fps','5'],capture_output=True)
assert p.returncode!=0 and not p.stdout and b'font is missing' in p.stderr
report['missingFontRejected']=True
report['cpuGpuExact']=True
report['note']='Conversion and render smoke only. Cell clipping is separately evaluated; this is not a release approval.'
(out/'native-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
