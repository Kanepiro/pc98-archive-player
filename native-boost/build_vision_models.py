"""Reproducibly convert the exact MediaPipe model versions used by v0.3.37."""
from pathlib import Path
import hashlib,subprocess,sys,urllib.request
root=Path(__file__).resolve().parent;models=root/'models';models.mkdir(exist_ok=True)
sources={
 'face':('https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite','b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f'),
 'object':('https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite','0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb')}
for name,(url,digest) in sources.items():
 p=models/(name+'.tflite')
 if not p.exists():urllib.request.urlretrieve(url,p)
 if hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise RuntimeError('Source model hash mismatch: '+name)
 subprocess.run([sys.executable,'-m','tf2onnx.convert','--tflite',str(p),'--opset','17','--output',str(models/(name+'.onnx'))],check=True)
subprocess.run([sys.executable,str(root/'prepare_vision_models.py')],check=True)
subprocess.run([sys.executable,str(root/'augment_vision_models.py')],check=True)
