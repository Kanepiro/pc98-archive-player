from pathlib import Path
import json,hashlib,struct,subprocess,ast,base64,math
work=Path(__file__).resolve().parent
old=work/'baseline/TASL-PC-Boost'
rows=[]
def digest(b):return hashlib.sha256(b).hexdigest()
for name in ['native_modes','portable_engine','tsl_render','tsl_render_gpu']:
 a=bytearray((old/(name+'.exe')).read_bytes());b=bytearray((work/'native-build'/(name+'.exe')).read_bytes())
 before=[digest(a),digest(b)]
 for buf in [a,b]:
  pe=struct.unpack_from('<I',buf,0x3c)[0];assert buf[pe:pe+4]==b'PE\0\0'
  buf[pe+8:pe+12]=bytes(4)
  optional=pe+24;assert struct.unpack_from('<H',buf,optional)[0]==0x20b
  rva,size=struct.unpack_from('<II',buf,optional+112+6*8)
  sections=optional+struct.unpack_from('<H',buf,pe+20)[0]
  for i in range(struct.unpack_from('<H',buf,pe+6)[0]):
   section=sections+i*40;virtual_size,virtual_address,raw_size,raw_pointer=struct.unpack_from('<IIII',buf,section+8)
   if virtual_address<=rva<virtual_address+max(virtual_size,raw_size):
    offset=raw_pointer+rva-virtual_address
    for j in range(0,size,28):buf[offset+j+4:offset+j+8]=bytes(4)
    break
 assert a==b,name+' native binary changed beyond PE timestamps'
 rows.append({'name':name,'baselineSHA256':before[0],'candidateSHA256':before[1],'identicalExceptPETimestamp':True})
for rel in ['ffmpeg.exe','ffprobe.exe','mode4_directcompute.exe','mode4_directcompute.hlsl','native_modes.hlsl','portable_match.hlsl','tsl_render_gpu.hlsl','app/mode4-atlas60.bin','app/mode4-palette60.js','app/mode4-position60.js','app/fonts/NotoSansMonoCJKjp-Regular.otf']:
 if not (old/rel).exists():continue
 a=(old/rel).read_bytes();b=(work/'package/TASL-PC-Boost'/rel).read_bytes()
 if rel.endswith('.js'):a=a.replace(b'\r\n',b'\n');b=b.replace(b'\r\n',b'\n')
 assert a==b,rel
 rows.append({'name':rel,'sha256':digest(a),'identical':True,'canonicalText':rel.endswith('.js')})
for platform,tag in [('windows','windows-v0.3.45'),('web','web-v0.3.45')]:
 root=work/platform
 # These conversion/matching engines and their worker protocols must be byte-identical in Git.
 files=['public/tsl-mode4-grid60.js','public/mode4-palette60.js','public/mode4-position60.js','public/tsl-quality.js','public/tsl-converter-worker.js','public/tsl-checkpoint.js','public/tsl-auto-settings.js','public/video-frame-reader.js','public/video-frame-timing.js']
 for rel in files:
  original=subprocess.check_output(['git','-c','safe.directory='+root.as_posix(),'-C',str(root),'show',tag+':'+rel])
  actual=(root/rel).read_bytes().replace(b'\r\n',b'\n')
  assert original.replace(b'\r\n',b'\n')==actual,(platform,rel)
  rows.append({'platform':platform,'source':rel,'identical':True,'sha256':digest(actual)})
 # The encoder configuration body must remain exactly the public v0.3.45 one.
 if platform=='windows':
  rel='native-boost/mp4_native.py'
  original=subprocess.check_output(['git','-c','safe.directory='+root.as_posix(),'-C',str(root),'show',tag+':'+rel]).decode()
  actual=(root/rel).read_text(encoding='utf-8')
  a=original[original.index('def _encode('):original.index('def run_mp4(')]
  b=actual[actual.index('def _encode('):actual.index('def run_mp4(')]
  assert a.replace('\r\n','\n')==b
  rows.append({'source':rel,'publicEncodingFunctionIdentical':True})
# Execute only the input-validator AST; importing the host would start background state.
tree=ast.parse((work/'windows/native-boost/bridge.py').read_text(encoding='utf-8'))
func=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='parse_mp4_plan')
env={'json':json,'math':math,'urlsafe_b64decode':base64.urlsafe_b64decode}
exec(compile(ast.Module(body=[func],type_ignores=[]),'validator','exec'),env)
parse=lambda d:env['parse_mp4_plan'](base64.urlsafe_b64encode(json.dumps(d).encode()).decode())
legacy=dict(width=128,height=36,count=30,ticks=73,sourceWidth=1440,sourceHeight=1080,fps=24,native16=False)
assert parse(legacy)==legacy
for w,h,cols,lines in [(1080,1440,75,50),(1440,1080,104,39),(1080,1440,36,24),(1440,1080,48,18)]:
 p=dict(legacy,width=cols,height=lines,outputWidth=w,outputHeight=h);assert parse(p)==p
for w,h in [(720,960),(1440,1440),(1080,None),(1080.0,1440),('1080',1440)]:
 try:parse(dict(legacy,outputWidth=w,outputHeight=h))
 except ValueError:pass
 else:raise AssertionError('invalid resolution accepted')
try:parse(dict(legacy,outputWidth=1080,outputHeight=1440))
except ValueError:pass
else:raise AssertionError('mismatched aspect accepted')
report={'pass':True,'nativeMetadataChecks':11,'rows':rows}
(work/'source-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('Engine, font, palette, public MP4 settings and native validators passed; '+str(len(rows))+' comparisons')
