// Only the local Windows process receives pixels. No external upload.
import {mapVisionDetections} from './tsl-artisan-vision.js';
export async function createNativeVision({onStatus=()=>{}}={}){
 const r=await fetch('/api/vision/health');if(!r.ok)throw Error('Native vision unavailable');
 const h=await r.json();if(!h.ready)throw Error(h.reason);
 let last=-1,previous=[],fallback=null,lastTiming=null,backend=h.backend;
 const canvas=document.createElement('canvas'),c=canvas.getContext('2d',{willReadFrequently:true});
 return {
  get backend(){return backend;},get timing(){return lastTiming;},
  async detect(video,rect,w,h,time,force=false){
   if(fallback)return fallback.detect(video,rect,w,h,time,force);
   if(!force&&last>=0&&time>=last&&time-last<.42)return previous;
   try{
    const sw=video.videoWidth||video.naturalWidth||video.width,sh=video.videoHeight||video.naturalHeight||video.height;
    canvas.width=sw;canvas.height=sh;c.drawImage(video,0,0);
    const pixels=c.getImageData(0,0,sw,sh).data;
    const result=await fetch('/api/vision/detect',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-TASL-Width':String(sw),'X-TASL-Height':String(sh)},body:pixels,signal:AbortSignal.timeout(90000)});
    if(!result.ok)throw Error((await result.text()).slice(0,300));
    const d=await result.json();backend=d.backend;lastTiming={...d.timing,preprocessBackend:d.preprocessBackend,providerEvidence:d.providerEvidence};
    previous=mapVisionDetections(d.objects,d.faces,sw,sh,rect,w,h);last=time;return previous;
   }catch(e){
    onStatus('DirectML画像認識を使用できないため元のCPUモデルへ切替: '+e.message);
    const m=await import('./tsl-artisan-vision.js');fallback=await m.createArtisanVision({onStatus});
    backend='MediaPipe CPU';return fallback.detect(video,rect,w,h,time,force);
   }
  },
  close(){fallback?.close();}
 };
}
