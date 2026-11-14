import os,sys,json,struct
from pathlib import Path
import numpy as np,cv2
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native-boost'))
from fullgpu_bridge import ContourGpuClient
os.environ['TASL_TEST_WARP']='1'
w,h=1920,1080;y,x=np.mgrid[:h,:w]
rgb=np.stack([(x*7+y*3)%256,(x//3+y*11)%256,((x//20)^(y//20))*40%256],axis=2).astype(np.uint8)
rgba=cv2.cvtColor(rgb,cv2.COLOR_RGB2RGBA)
client=ContourGpuClient(lambda n:str(root/'native-boost'/(n+'.exe')))
data=client.compute(struct.pack('<4I3fI',0x43504754,6,w,h,0,1,1,0)+rgba.tobytes())
face=np.frombuffer(data,np.float32,count=128*128*3,offset=16).reshape(128,128,3)
obj=np.frombuffer(data,np.uint8,count=320*320*4,offset=16+128*128*3*4).reshape(320,320,4)[:,:,:3]
scale=128/max(w,h);mat=np.array([[scale,0,(128-w*scale)/2],[0,scale,(128-h*scale)/2]],np.float32)
referenceFace=cv2.warpAffine(rgb,mat,(128,128),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=0).astype(np.float32)/127.5-1
referenceObject=cv2.resize(rgb,(320,320),interpolation=cv2.INTER_LINEAR)
errors={'faceMaxAbs':float(np.max(np.abs(face-referenceFace))),'objectMaxAbs':int(np.max(np.abs(obj.astype(int)-referenceObject.astype(int)))),'backend':'WARP software test'}
assert errors['faceMaxAbs']<.016,errors
assert errors['objectMaxAbs']<=2,errors
(root/'gpu-validation/preprocess-report.json').write_text(json.dumps(errors,indent=2));print(errors)
