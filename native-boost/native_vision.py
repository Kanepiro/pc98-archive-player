"""Exact source-model weights executed with native ONNX Runtime DirectML."""
from pathlib import Path
import json, os, threading, time, tempfile, subprocess, struct
import numpy as np
import cv2
class NativeVision:
    def __init__(self, root):
        self.root=Path(root)/"models";self.lock=threading.RLock()
        self.sessions={};self.reason="";self.test_cpu=os.getenv("TASL_TEST_VISION_CPU")=="1"
        self.ready=False;self.known=False;self.profile=[]
        from fullgpu_bridge import ContourGpuClient, NmsGpuClient
        self.preprocessor=ContourGpuClient(lambda n:str(self.root.parent/(n+".exe")))
        self.nms=NmsGpuClient(lambda n:str(self.root.parent/(n+".exe")))
    def initialize(self):
        with self.lock:
            if self.known:return self.ready
            self.known=True
            try:
                import onnxruntime as ort
                available=ort.get_available_providers()
                if "DmlExecutionProvider" not in available and not self.test_cpu:
                    raise RuntimeError("DirectML Execution Provider unavailable")
                device=0
                if not self.test_cpu:
                    p=subprocess.run([str(self.root.parent/"fullgpu_layout.exe"),"--adapter-index"],capture_output=True,timeout=30,check=True)
                    device=int(p.stdout.strip())
                providers=["CPUExecutionProvider"] if self.test_cpu else [("DmlExecutionProvider",{"device_id":device}),"CPUExecutionProvider"]
                for name in ["face","object"]:
                    opts=ort.SessionOptions();opts.enable_mem_pattern=False
                    opts.execution_mode=ort.ExecutionMode.ORT_SEQUENTIAL
                    # Preserve quantize/dequantize boundaries from the source TFLite model.
                    opts.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
                    opts.enable_profiling=True
                    opts.profile_file_prefix=str(Path(tempfile.gettempdir())/("tasl-vision-"+name))
                    self.sessions[name]=ort.InferenceSession(str(self.root/(name+"-directml.onnx")),sess_options=opts,providers=providers)
                # Confirm actual DML kernel execution, not just provider availability.
                for name,session in self.sessions.items():
                    inp=session.get_inputs()[0];dtype=np.float32 if name=="face" else np.uint8
                    session.run(None,{inp.name:np.zeros(inp.shape,dtype=dtype)})
                evidence=self.finish_profiles()
                if not self.test_cpu and any(not p.get("executedNodeEvents",{}).get("DmlExecutionProvider",0) for p in evidence):
                    raise RuntimeError("DirectML did not execute model kernels; use original CPU models")
                self.metadata=json.loads((self.root/"metadata.json").read_text())
                self.ready=True
            except Exception as e:self.reason=str(e);self.sessions={}
            return self.ready
    @property
    def backend(self):return "CPU-Test" if self.test_cpu else "DirectML"
    def finish_profiles(self):
        with self.lock:
            for name,session in self.sessions.items():
                try:
                    path=session.end_profiling()
                    events=json.loads(Path(path).read_text())
                    nodes=[e for e in events if e.get("cat")=="Node" and e.get("args",{}).get("provider")]
                    counts={}
                    for e in nodes:
                        provider=e["args"]["provider"];counts[provider]=counts.get(provider,0)+1
                    self.profile.append({"model":name,"file":path,"executedNodeEvents":counts})
                except Exception as e:self.profile.append({"model":name,"error":str(e)})
            return self.profile
    @staticmethod
    def iou(box,boxes):
        a=np.maximum(box[:2]-box[2:]*.5,boxes[:,:2]-boxes[:,2:]*.5)
        b=np.minimum(box[:2]+box[2:]*.5,boxes[:,:2]+boxes[:,2:]*.5)
        inter=np.prod(np.maximum(0,b-a),axis=1)
        union=box[2]*box[3]+boxes[:,2]*boxes[:,3]-inter
        return inter/np.maximum(union,1e-9)
    def detect(self,rgba,w,h):
        if not self.initialize():raise RuntimeError(self.reason)
        with self.lock:
            rgb=np.frombuffer(rgba,np.uint8).reshape(h,w,4)[:,:,:3]
            start=time.perf_counter()
            # Match MediaPipe's square face crop and zero-border letterboxing.
            size=max(w,h);sx=128/size;tx=(128-w*sx)*.5;ty=(128-h*sx)*.5
            transform=np.array([[sx,0,tx],[0,sx,ty]],np.float32)
            preprocess_backend="CPU"
            try:
                if self.test_cpu and os.getenv("TASL_TEST_NATIVE_VISION")!="1":raise RuntimeError("Explicit CPU model test")
                payload=struct.pack("<4I3fI",0x43504754,6,w,h,0,1,1,0)+rgba
                data=self.preprocessor.compute(payload)
                face_input=np.frombuffer(data,np.float32,count=128*128*3,offset=16).reshape(1,128,128,3)
                obj=np.frombuffer(data,np.uint8,count=320*320*4,offset=16+128*128*3*4).reshape(320,320,4)[:,:,:3].copy()
                preprocess_backend="WARP-Test" if self.preprocessor.software else "DirectCompute"
            except Exception as e:
                face=cv2.warpAffine(rgb,transform,(128,128),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=0)
                obj=cv2.resize(rgb,(320,320),interpolation=cv2.INTER_LINEAR)
                face_input=(face.astype(np.float32)/127.5-1)[None]
                preprocess_backend="CPU: "+str(e)[:150]
            prep=time.perf_counter()-start
            t=time.perf_counter()
            fs=self.sessions["face"];fv=fs.run(None,{fs.get_inputs()[0].name:face_input})
            face_ms=(time.perf_counter()-t)*1000;t=time.perf_counter()
            ob=self.sessions["object"];ov=ob.run(None,{ob.get_inputs()[0].name:obj[None]})
            object_ms=(time.perf_counter()-t)*1000;t=time.perf_counter()
            face_candidates,object_candidates,nms_backend=self.suppress(fv,ov)
            faces=[]
            for original,score in face_candidates:
                box=original.copy();box[0]=(box[0]*128-tx)/(w*sx);box[1]=(box[1]*128-ty)/(h*sx)
                box[2]*=size/w;box[3]*=size/h
                points=[{"x":float((box[4+k*2]*128-tx)/(w*sx)),"y":float((box[5+k*2]*128-ty)/(h*sx))} for k in range(6)]
                faces.append(self.detection(box[:4],score,"face",w,h,points))
            objects=[self.detection(box,score,self.metadata["labels"][label],w,h) for box,score,label in object_candidates]
            return {"faces":{"detections":faces},"objects":{"detections":objects},
                "backend":self.backend,"providerEvidence":self.profile,"preprocessBackend":preprocess_backend,"timing":{"preprocessCpuMs":prep*1000,"faceInferenceMs":face_ms,
                 "objectInferenceMs":object_ms,"nmsBackend":nms_backend,"nmsWallMs":(time.perf_counter()-t)*1000}}
    def suppress(self,fv,ov):
        fb,fs=fv[0][0],fv[1].reshape(-1)
        ob,oscores,classes=ov[0][0],ov[1].reshape(-1),ov[2].reshape(-1)
        try:
            if self.test_cpu and os.getenv("TASL_TEST_NATIVE_VISION")!="1":raise RuntimeError("Explicit CPU test")
            nf,no=len(fs),len(oscores)
            data=np.concatenate([fb.ravel(),fs,ob.ravel(),oscores,classes.astype(np.float32)]).astype(np.float32).tobytes()
            result=self.nms.compute(struct.pack("<4I",0x534d4e54,nf,no,0)+data)
            fc,oc=struct.unpack_from("<2I",result)
            if fc>nf or oc>6:raise RuntimeError("Invalid GPU detection count")
            faces=np.frombuffer(result,np.float32,count=nf*17,offset=8).reshape(nf,17)
            objects=np.frombuffer(result,np.float32,count=36,offset=8+nf*17*4).reshape(6,6)
            return [(r[:16],float(r[16])) for r in faces[:fc]],[(r[:4],float(r[4]),int(r[5])) for r in objects[:oc]],"WARP-Test" if self.nms.software else "DirectCompute"
        except Exception as e:
            reason=str(e)[:150]
        ids=np.flatnonzero(fs>=.55);ids=ids[np.argsort(-fs[ids],kind="stable")];faces=[]
        while len(ids):
            first=ids[0];overlap=self.iou(fb[first,:4],fb[ids,:4])>.3;overlap[0]=True
            group=ids[overlap];ids=ids[~overlap];weights=fs[group]
            faces.append(((fb[group]*weights[:,None]).sum(axis=0)/weights.sum(),float(fs[first])))
        ids=np.flatnonzero(oscores>=.36);ids=ids[np.argsort(-oscores[ids],kind="stable")];objects=[]
        while len(ids) and len(objects)<6:
            first=ids[0];objects.append((ob[first],float(oscores[first]),int(classes[first])))
            overlaps=self.iou(ob[first],ob[ids]);overlaps[0]=1;ids=ids[overlaps<=.3]
        return faces,objects,"CPU: "+reason
    @staticmethod
    def detection(box,score,label,w,h,points=None):
        x,y,bw,bh=[float(v) for v in box]
        result={"boundingBox":{"originX":(x-bw*.5)*w,"originY":(y-bh*.5)*h,"width":bw*w,"height":bh*h},
                "categories":[{"categoryName":label,"score":score}]}
        if points is not None:result["keypoints"]=points
        return result
