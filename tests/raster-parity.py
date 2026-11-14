import subprocess,os,json
from pathlib import Path
os.environ['TASL_TEST_WARP']='1'
root=Path(__file__).resolve().parents[1];out=root/'gpu-validation';out.mkdir(exist_ok=True)
# Exhaustive encodable Japanese symbols, including the complete 272-character source palette.
chars=[]
for a in range(0x20,0x7f):chars.append(bytes([a]))
for a in range(0xa1,0xe0):chars.append(bytes([a]))
for a in [0x81,0x82,0x83,0x84,0x87]:
 for b in range(0x40,0xfd):
  try:
   x=bytes([a,b]);x.decode('cp932');chars.append(x)
  except UnicodeDecodeError:pass
lines=[];line=b''
for c in chars:
 if len(line)+len(c)>80:lines.append(line.ljust(80));line=b''
 line+=c
if line:lines.append(line.ljust(80))
report=[]
for native in [True,False]:
 path=out/('raster-'+str(native)+'.TSL')
 header=f'1.08\r\n1\r\n80\r\n{len(lines)}\r\n'+('# PC98_FONT_16X16\r\n' if native else '')
 path.write_bytes(header.encode()+b'\f\r\n1 12\r\n0 0\r\n\f\r\n'+b'\r\n'.join(lines)+b'\r\n\f\r\n\x1a')
 images=[]
 for exe in ['tsl_render','tsl_render_gpu']:
  p=subprocess.run([str(root/'native-boost'/(exe+'.exe')),'--input',str(path),'--fps','5'],capture_output=True,timeout=90)
  if p.returncode:raise RuntimeError(p.stderr.decode(errors='replace'))
  images.append(p.stdout)
 assert len(images[0])==len(images[1])
 diff=sum(a!=b for a,b in zip(*images))
 report.append({'native16':native,'bytes':len(images[0]),'differentBytes':diff,'glyphs':len(chars),'backend':'WARP software test'})
 assert diff==0,report[-1]
(out/'raster-report.json').write_text(json.dumps(report,indent=2))
print(report)
