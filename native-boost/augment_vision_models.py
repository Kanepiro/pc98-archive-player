"""Add source-model decoding operators to ONNX so DirectML also decodes detections."""
from pathlib import Path
import json
import numpy as np
import onnx
from onnx import helper as H, numpy_helper as N, TensorProto as T
ROOT=Path(__file__).resolve().parent/"models"
def constant(model,name,value):
 model.graph.initializer.append(N.from_array(np.asarray(value),name));return name
def node(model,kind,inputs,outputs,**kw):model.graph.node.append(H.make_node(kind,inputs,outputs,**kw))
def outputs(model,items):
 del model.graph.output[:]
 for name,dtype,shape in items:model.graph.output.append(H.make_tensor_value_info(name,dtype,shape))
def face():
 m=onnx.load(ROOT/"face.onnx")
 anchors=np.asarray([[(x+.5)/grid,(y+.5)/grid] for grid,reps in [(16,2),(8,6)] for y in range(grid) for x in range(grid) for _ in range(reps)],np.float32)
 offsets=np.zeros((1,896,16),np.float32);offsets[0,:,:2]=anchors
 for k in range(6):offsets[0,:,4+k*2:6+k*2]=anchors
 constant(m,"tasl_face_scale",np.float32(1/128));constant(m,"tasl_face_anchors",offsets)
 node(m,"Mul",["regressors","tasl_face_scale"],["tasl_face_scaled"])
 node(m,"Add",["tasl_face_scaled","tasl_face_anchors"],["decoded"])
 node(m,"Sigmoid",["classificators"],["scores"])
 outputs(m,[("decoded",T.FLOAT,[1,896,16]),("scores",T.FLOAT,[1,896,1])])
 onnx.checker.check_model(m);onnx.save(m,ROOT/"face-directml.onnx")
def objects():
 m=onnx.load(ROOT/"object.onnx");cfg=json.loads((ROOT/"metadata.json").read_text())
 anchors=np.load(ROOT/"object-anchors.npy")
 constant(m,"tasl_order",np.array([1,0,3,2],np.int64))
 node(m,"Gather",["StatefulPartitionedCall:0","tasl_order"],["tasl_xywh"],axis=2)
 constant(m,"tasl_scales",np.array([cfg[k] for k in ["x_scale","y_scale","w_scale","h_scale"]],np.float32))
 node(m,"Div",["tasl_xywh","tasl_scales"],["tasl_unscaled"])
 constant(m,"tasl_xy_indices",np.array([0,1],np.int64));constant(m,"tasl_wh_indices",np.array([2,3],np.int64))
 node(m,"Gather",["tasl_unscaled","tasl_xy_indices"],["tasl_xy"],axis=2)
 node(m,"Gather",["tasl_unscaled","tasl_wh_indices"],["tasl_wh"],axis=2)
 constant(m,"tasl_anchor_xy",anchors[None,:,:2]);constant(m,"tasl_anchor_wh",anchors[None,:,2:])
 node(m,"Mul",["tasl_xy","tasl_anchor_wh"],["tasl_center_offset"])
 node(m,"Add",["tasl_center_offset","tasl_anchor_xy"],["tasl_center"])
 wh="tasl_wh"
 if cfg["apply_exponential_on_box_size"]:
  node(m,"Exp",[wh],["tasl_wh_exp"]);wh="tasl_wh_exp"
 node(m,"Mul",[wh,"tasl_anchor_wh"],["tasl_size"])
 node(m,"Concat",["tasl_center","tasl_size"],["decoded"],axis=2)
 scores="StatefulPartitionedCall:1"
 if cfg["sigmoid_score"]:
  node(m,"Sigmoid",[scores],["tasl_sigmoid"]);scores="tasl_sigmoid"
 node(m,"ReduceMax",[scores],["scores"],axes=[2],keepdims=0)
 node(m,"ArgMax",[scores],["classes"],axis=2,keepdims=0)
 outputs(m,[("decoded",T.FLOAT,[1,19206,4]),("scores",T.FLOAT,[1,19206]),("classes",T.INT64,[1,19206])])
 onnx.checker.check_model(m);onnx.save(m,ROOT/"object-directml.onnx")
if __name__=="__main__":face();objects()
