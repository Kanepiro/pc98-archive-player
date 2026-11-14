import os,sys,json
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native-boost'))
os.environ['TASL_TEST_WARP']='1';os.environ['TASL_TEST_VISION_CPU']='1'
from native_vision import NativeVision
v=NativeVision(root/'native-boost')
rng=np.random.default_rng(736);fb=rng.random((1,896,16),dtype=np.float32);fb[:,:,2:4]*=.3
fs=rng.random((1,896,1),dtype=np.float32);fs[fs<.97]=0
ob=rng.random((1,19206,4),dtype=np.float32);ob[:,:,2:]*=.3
scores=rng.random((1,19206),dtype=np.float32);scores[scores<.999]=0
classes=rng.integers(0,90,(1,19206));fv=[fb,fs];ov=[ob,scores,classes]
cpu=v.suppress(fv,ov);os.environ['TASL_TEST_NATIVE_VISION']='1';gpu=v.suppress(fv,ov)
assert gpu[2]=='WARP-Test',gpu[2]
assert len(cpu[0])==len(gpu[0]) and len(cpu[1])==len(gpu[1])
error=0
for a,b in zip(cpu[0],gpu[0]):error=max(error,float(np.max(np.abs(a[0]-b[0]))));assert abs(a[1]-b[1])<1e-6
for a,b in zip(cpu[1],gpu[1]):assert np.max(np.abs(a[0]-b[0]))<1e-6 and a[1:]==b[1:]
assert error<1e-5,error
report={'backend':gpu[2],'faces':len(gpu[0]),'objects':len(gpu[1]),'maxFaceCoordinateError':error}
(root/'gpu-validation/nms-report.json').write_text(json.dumps(report,indent=2));print(report)
