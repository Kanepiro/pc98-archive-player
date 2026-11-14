"""Bit-for-bit replay against the unmodified v0.3.41 native executables."""
import json, os, struct, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
env={**os.environ,'TASL_TEST_WARP':'1'}
old=root/'baseline-build/Release'
new=root/'native-boost'
def run(folder,name,data):
 return subprocess.run([str(folder/(name+'.exe')),'--stream'],input=data,capture_output=True,
  env=env,timeout=180,check=True).stdout
payload=(root/'gpu-validation/resident-input.bin').read_bytes()
w,h=struct.unpack_from('<2I',payload,40)
reference=run(old,'fullgpu_layout',payload[32:])
current=run(new,'fullgpu_layout',payload)
assert reference[:w*h*4+80]==current[:w*h*4+80], 'Original v0.3.41 layout mismatch'
# Alternating operation dimensions catches stale data in a retained larger arena.
packets=[];sizes=[]
for frame in range(3):
 for op,w,h in [(1,32,24),(2,16,16),(3,32,24),(4,32,24),(6,16,16)]:
  n=w*h
  data=struct.pack('<4I3fI',0x43504754,op,w,h,0,1,1,0)
  if op in (3,6): data+=struct.pack('<%dI'%n,*[(i+frame)%2 if op==3 else (0xff000000|(i*173+frame*719)&0xffffff) for i in range(n)])
  else:data+=struct.pack('<%df'%n,*[((i*17+frame*7)%97)/96 for i in range(n)])
  packets.append(data)
  sizes.append(24+(128*128*3+320*320)*4 if op==6 else 24+n*(12 if op in (1,4) else 4))
a=run(old,'fullgpu_contour',b''.join(packets));b=run(new,'fullgpu_contour',b''.join(packets))
offset=0
for size in sizes:
 assert a[offset:offset+size-8]==b[offset:offset+size-8], ('Contour replay',offset,size)
 offset+=size
assert len(a)==len(b)==offset
# Two different model output shapes and changing detections, same fixed buffers.
packets=[];sizes=[]
for nf,no in [(896,19206),(64,128),(896,19206)]:
 values=[0.0]*(nf*17+no*6)
 values[0]=.9;values[1:5]=[.1,.2,.3,.4]
 at=nf*17;values[at:at+6]=[.8,.1,.2,.3,.4,0]
 packets.append(struct.pack('<4I',0x534d4e54,nf,no,0)+struct.pack('<%df'%len(values),*values))
 sizes.append((2+nf*17+36)*4)
a=run(old,'fullgpu_nms',b''.join(packets));b=run(new,'fullgpu_nms',b''.join(packets))
assert a==b and len(a)==sum(sizes),'NMS replay'
report={'baselineCommit':'d4ba273d9036a59a2770fe2f0c4456bcf8f74e00','adapter':'Explicit WARP software',
 'originalLayoutExact':True,'contourOperationsExact':len(sizes)*5,'nmsFramesExact':len(sizes)}
(root/'gpu-validation/resident-original-parity.json').write_text(json.dumps(report,indent=2))
print(report)
