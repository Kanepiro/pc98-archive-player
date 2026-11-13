// Face + object recognition for Mode 4. Inference runs in the browser;
// the current video frame is NEVER uploaded to a server.
// Model binaries are fetched from the official MediaPipe model distribution.
import {FilesetResolver,FaceDetector,ObjectDetector} from './vendor/vision_bundle.mjs';

const W = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const FACE = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const OBJECT = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';
const important=new Set(['person','cat','dog','bird','horse','sheep','cow','elephant','bear',
 'zebra','giraffe','monkey','rabbit','teddy bear']);
const cap=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const normRect=(bb,sourceWidth,sourceHeight,rect,w,h)=>{
 if(!bb)return null;
 const x=(rect.x+rect.width*bb.originX/sourceWidth)/w;
 const y=(rect.y+rect.height*bb.originY/sourceHeight)/h;
 const rw=rect.width*bb.width/sourceWidth/w,rh=rect.height*bb.height/sourceHeight/h;
 if(![x,y,rw,rh].every(Number.isFinite)||rw<=0||rh<=0)return null;
 const l=cap(x),t=cap(y),right=cap(x+rw),bottom=cap(y+rh);
 if(right<=l||bottom<=t)return null;
 return {x:l,y:t,w:right-l,h:bottom-t};
};
const normPoint=(p,rect,w,h)=>{
 const x=(rect.x+rect.width*p.x)/w,y=(rect.y+rect.height*p.y)/h;
 return {x:cap(x),y:cap(y),label:p.label||''};
};
export function mapVisionDetections(objects,faces,sourceWidth,sourceHeight,rect,w,h){
 const regions=[];
 for(const item of objects?.detections||[]){
  const label=item.categories?.[0]?.categoryName?.toLowerCase()||'other';
  const confidence=item.categories?.[0]?.score||0;
  const box=normRect(item.boundingBox,sourceWidth,sourceHeight,rect,w,h);
  if(!box||confidence<.25)continue;
  regions.push({...box,kind:label,
   importance:important.has(label)?(label==='person'?1.6:1.85):1.17,
   confidence:cap(confidence),landmarks:[]});
 }
 for(const item of faces?.detections||[]){
  const confidence=item.categories?.[0]?.score||0;
  const box=normRect(item.boundingBox,sourceWidth,sourceHeight,rect,w,h);
  if(!box||confidence<.60)continue;
  regions.push({...box,kind:'face',importance:2.6,confidence:cap(confidence),
   landmarks:(item.keypoints||[]).map(p=>normPoint(p,rect,w,h))});
 }
 return regions.slice(0,8);
}
export async function createArtisanVision({onStatus=()=>{}}={}){
 const vision=await FilesetResolver.forVisionTasks(W);
 let face=null,object=null;
 try{
  face=await FaceDetector.createFromOptions(vision,{
   baseOptions:{modelAssetPath:FACE,delegate:'CPU'},runningMode:'IMAGE',
   minDetectionConfidence:.55,minSuppressionThreshold:.3});
  onStatus('人物の顔を判別するモデルを準備しました');
 }catch(e){onStatus('顔検出モデルを使用できません: '+e.message);}
 try{
  object=await ObjectDetector.createFromOptions(vision,{
   baseOptions:{modelAssetPath:OBJECT,delegate:'CPU'},runningMode:'IMAGE',
   scoreThreshold:.36,maxResults:6});
  onStatus('人物・動物・物体の検出モデルを準備しました');
 }catch(e){onStatus('物体検出モデルを使用できません: '+e.message);}
 if(!face&&!object)throw Error('画像認識モデルが読み込めませんでした');
 let last=-1,previous=[],disabled=false;
 return {
  get capabilities(){return {face:!!face,object:!!object};},
  detect(video,rect,w,h,time,force=false){
   if(disabled)return [];
   if(!force&&last>=0&&time>=last&&time-last<.42)return previous;
   try{
    const f=face?.detect(video),o=object?.detect(video);
    previous=mapVisionDetections(o,f,video.videoWidth||video.naturalWidth||video.width,video.videoHeight||video.naturalHeight||video.height,rect,w,h);
    last=time;
    return previous;
   }catch(e){onStatus('画像認識を続行できません: '+e.message);disabled=true;return [];}
  },
  close(){face?.close();object?.close();face=object=null;}
 };
}
