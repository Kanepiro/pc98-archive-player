// TSL-to-MP4 export runs entirely off the page's main thread.
// Canvas drawing, Shift-JIS decoding, and WebCodecs encoding happen here.
import {parseTSL} from './tsl.js';
import {exportMP4} from './mp4-export.js';

let inUse=false;
self.onmessage=async({data:d})=>{
 if(inUse||d?.type!=='start')return;
 inUse=true;
 try{
  if(typeof OffscreenCanvas==='undefined'||typeof VideoEncoder==='undefined')
   throw Error('このブラウザーはバックグラウンドの動画書き出しに対応していません');
  self.postMessage({type:'stage',stage:'reading'});
  const data=parseTSL(new TextDecoder('shift_jis').decode(d.bytes));
  if(data.duration>300)throw Error('5分を超える作品のMP4書き出しは未対応です');
  self.postMessage({type:'stage',stage:'encoding'});
  let lastSent=-1;
  const blob=await exportMP4({kind:'TSL',data},{
   tslMaxPixels:d.maxPixels,
   tslAppearance:d.appearance,
   onResolution:(width,height)=>self.postMessage({type:'resolution',width,height}),
   onProgress:(seconds,total)=>{
    const step=Math.floor(seconds*2);
    if(step!==lastSent){
     lastSent=step;
     self.postMessage({type:'progress',seconds,total});
    }
   }
  });
  const buffer=await blob.arrayBuffer();
  self.postMessage({type:'done',buffer},[buffer]);
 }catch(e){
  self.postMessage({type:'error',message:String(e?.message||e)});
 }finally{inUse=false;}
};
