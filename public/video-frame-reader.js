import {Input,BlobSource,ALL_FORMATS,EncodedPacketSink,CanvasSink} from 'mediabunny';
import {frameRequestTime,verifyDecodedFrame} from './video-frame-timing.js';

// Decode the file timeline directly. A paused/hidden HTML video can report a
// completed seek while canvas capture still sees an old presentation surface.
// Recognition and character conversion must consume the very same decoded frame.
export async function createVideoFrameReader(file,times,{signal}={}){
 const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
 let iterator=null,closed=false,index=0,previous=-Infinity;
 const aborted=()=>new DOMException('変換を中止しました','AbortError');
 const dispose=()=>{if(!closed){closed=true;input.dispose();}};
 async function wait(operation){
  if(signal?.aborted){dispose();throw aborted();}
  let timer,cancel;
  try{
   return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
    cancel=()=>{dispose();reject(aborted());};
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>{dispose();reject(Error('動画フレームの読み取りがタイムアウトしました'));},30000);
   })]);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
 }
 try{
  const track=await wait(()=>input.getPrimaryVideoTrack());
  if(!track||!await wait(()=>track.canDecode()))throw Error('この動画の映像を時刻付きで読み取れません。H.264形式のMP4を選んでください');
  const first=await wait(()=>track.getFirstTimestamp()),end=await wait(()=>track.computeDuration());
  const requests=times.map(t=>frameRequestTime(t,first,end));
  // Bound canvas allocation; no scaling, cropping, FPS changes or frame dropping.
  const sink=new CanvasSink(track,{poolSize:2,alpha:false});
  iterator=sink.canvasesAtTimestamps(requests);
  return {
   async read(){
    if(closed)throw Error('動画の読み取りは終了しています');
    const next=await wait(()=>iterator.next());
    if(next.done||!next.value)throw Error('動画のフレームが不足しています');
    const frame=next.value;
    previous=verifyDecodedFrame(frame,requests[index++],previous);
    return {image:frame.canvas,timestamp:frame.timestamp,duration:frame.duration};
   },
   async close(){
    dispose();
    try{await iterator.return();}catch{}
   }
  };
 }catch(e){dispose();throw e;}
}

// Seek the HTML decoder inside the selected packet's presentation interval.
// Keep the original HTML video colors and scaling for modes 1–3.
export async function createSeekTimeline(file){
 const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
 try{
  const track=await input.getPrimaryVideoTrack();
  if(!track){input.dispose();return null;}
  const sink=new EncodedPacketSink(track);
  let packet=null;
  return {
   async at(time){
    // HTML seek targets truncate to microseconds. Presented packet timestamps
    // round to that clock. Keep the original choice at fractional boundaries.
    const us=Math.floor(time*1e6);
    const contains=()=>packet&&us>=Math.round(packet.timestamp*1e6)&&us<Math.round((packet.timestamp+packet.duration)*1e6);
    if(!contains()){
     packet=await sink.getPacket((us+0.499999)/1e6,{metadataOnly:true});
    }
    if(!contains())return null;
    return {seek:packet.timestamp+packet.duration/2,timestamp:packet.timestamp};
   },
   close(){input.dispose();}
  };
 }catch(error){input.dispose();throw error;}
}
