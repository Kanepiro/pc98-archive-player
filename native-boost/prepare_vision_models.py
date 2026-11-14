"""Convert the exact original TFLite models and extract their own decoding metadata."""
from pathlib import Path
import json, zipfile, hashlib, subprocess, sys
import numpy as np
from tensorflow.lite.python import schema_py_generated as schema
import flatbuffers.table as table
import flatbuffers.number_types as nt
ROOT=Path(__file__).resolve().parent/"models"
def tab_at(buf,pos):return table.Table(buf,pos)
def root(buf):return tab_at(buf,int.from_bytes(buf[:4],"little"))
def field(t,k):return t.Offset(4+k*2)
def child(t,k):
 off=field(t,k)
 return tab_at(t.Bytes,t.Indirect(t.Pos+off)) if off else None
def vector(t,k):
 off=field(t,k)
 return (t.Vector(off),t.VectorLen(off)) if off else (0,0)
def text(t,k):
 off=field(t,k)
 return t.String(t.Pos+off).decode() if off else ""
def scalar(t,k,kind=nt.Float32Flags,default=0):
 off=field(t,k)
 return t.Get(kind,t.Pos+off) if off else default
def extract():
 raw=(ROOT/"object.tflite").read_bytes();model=schema.Model.GetRootAsModel(raw,0)
 metadata=None
 for i in range(model.MetadataLength()):
  item=model.Metadata(i)
  if item.Name()==b"TFLITE_METADATA":metadata=model.Buffers(item.Buffer()).DataAsNumpy().tobytes()
 if metadata is None:raise RuntimeError("Original model metadata is missing")
 md=root(metadata);start,length=vector(md,3);sub=tab_at(metadata,md.Indirect(start))
 start,length=vector(sub,9);detector=None
 for i in range(length):
  item=tab_at(metadata,sub.Indirect(start+i*4))
  if text(item,0)=="DETECTOR_METADATA":
   pos,n=vector(item,1);detector=root(metadata[pos:pos+n])
 if detector is None:raise RuntimeError("Original detector decoding metadata is missing")
 options=child(detector,2)
 keys=["num_classes","num_boxes","num_coords","keypoint_coord_offset","num_keypoints","num_values_per_keypoint",
       "x_scale","y_scale","w_scale","h_scale","apply_exponential_on_box_size","sigmoid_score"]
 config={k:scalar(options,i,nt.Int32Flags if i<6 else nt.BoolFlags if i>=10 else nt.Float32Flags) for i,k in enumerate(keys)}
 anchors_table=child(child(detector,1),0);start,n=vector(anchors_table,0)
 anchors=[]
 for i in range(n):
  anchor=tab_at(anchors_table.Bytes,anchors_table.Indirect(start+i*4))
  anchors.append([scalar(anchor,j) for j in range(4)])
 anchors=np.asarray(anchors,np.float32)
 assert anchors.shape==(config["num_boxes"],4)
 np.save(ROOT/"object-anchors.npy",anchors)
 config["labels"]=zipfile.ZipFile(ROOT/"object.tflite").read("labels.txt").decode().splitlines()
 config["source_sha256"]={name:hashlib.sha256((ROOT/(name+".tflite")).read_bytes()).hexdigest() for name in ["face","object"]}
 (ROOT/"metadata.json").write_text(json.dumps(config,indent=2))
 print(json.dumps({k:v for k,v in config.items() if k!="labels"},indent=2))
if __name__=="__main__":extract()
