// Offline, deterministic brightness/contrast/gamma suggestion.
// No API calls, no AI model, no upload and no saved video frames.
// It is a histogram proxy, not an image-quality guarantee.
import {fitRect,pc98SourceDrawRect} from './tsl-converter-core.js';
import {HALFTONE_TONES,HALFTONE_DITHER_STRENGTH} from './tsl-halftone.js';
const clamp=x=>Math.max(0,Math.min(1,x));
const BAYER4=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const MODE_SET=new Set(['legacy','halftone','quality','artisan']);
const POSITIONS=[.08,.2,.32,.44,.56,.68,.8,.92];
const HIST_BINS=64;

function aborted(signal) {
 if(signal?.aborted)throw new DOMException('解析を中止しました','AbortError');
}
function waitVideoEvent(video,event,action,signal,timeout=25000) {
 aborted(signal);
 return new Promise((resolve,reject)=>{
  let timer;
  const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,success);video.removeEventListener('error',failure);signal?.removeEventListener('abort',cancel);};
  const finish=error=>{cleanup();error?reject(error):resolve();};
  const success=()=>finish(),failure=()=>finish(Error('動画を読み込めませんでした')),cancel=()=>finish(new DOMException('解析を中止しました','AbortError'));
  video.addEventListener(event,success,{once:true});
  video.addEventListener('error',failure,{once:true});
  signal?.addEventListener('abort',cancel,{once:true});
  timer=setTimeout(()=>finish(Error('動画の読み込みがタイムアウトしました')),timeout);
  try{action();}catch(error){finish(error);}
 });
}
export function sampleLuminanceHistogram(pixels,width,height,{sample=4}={}) {
 if(!Number.isInteger(width)||width<4||!Number.isInteger(height)||height<4||
    !Number.isInteger(sample)||sample<1||sample>6||
    pixels.length!==width*height*sample*sample*4)
  throw Error('解析用の画像サイズが不正です');
 const bins=new Uint32Array(HIST_BINS),imgW=width*sample,cols=Math.floor(width/2);
 for(let y=0;y<height;y++)for(let x=0;x<cols;x++){
  let sum=0;
  for(let dy=0;dy<sample;dy++){
   const base=((y*sample+dy)*imgW+x*2*sample)*4;
   for(let dx=0;dx<sample*2;dx++){
    const p=base+dx*4,a=pixels[p+3]/255;
    sum+=(.2126*pixels[p]+.7152*pixels[p+1]+.0722*pixels[p+2])*a;
   }
  }
  const lum=sum/(sample*sample*2*255);
  bins[Math.min(HIST_BINS-1,Math.floor(lum*HIST_BINS))]++;
 }
 return bins;
}
function entropy(counts) {
 const total=counts.reduce((s,n)=>s+n,0);
 if(!total)return 0;
 let sum=0;
 for(const count of counts){const p=count/total;if(p)sum-=p*Math.log2(p);}
 return sum;
}
function quantile(hist,p) {
 const total=hist.reduce((s,n)=>s+n,0),target=total*p;
 let count=0;
 for(let i=0;i<hist.length;i++){count+=hist[i];if(count>=target)return (i+.5)/HIST_BINS;}
 return 1;
}
function arrRange(start,end,step) {
 const result=[];
 for(let i=0;i<=Math.round((end-start)/step);i++)result.push(+(start+i*step).toFixed(3));
 return result;
}
// A balanced tonal histogram is a proxy for detail, not an aesthetic judgment.
export function suggestToneSettings(frames,{mode='halftone'}={}) {
 if(!MODE_SET.has(mode))throw Error('変換方式が不正です');
 if(!Array.isArray(frames)||!frames.length)throw Error('解析した場面がありません');
 const snapshots=frames.map(frame=>{
  if(!(frame instanceof Uint32Array)||frame.length!==HIST_BINS||!frame.some(v=>v>0))
   throw Error('解析データが不正です');
  return frame;
 });
 const global=new Uint32Array(HIST_BINS);
 for(const frame of snapshots)for(let i=0;i<HIST_BINS;i++)global[i]+=frame[i];
 const spread=quantile(global,.9)-quantile(global,.1);
 if(spread<.055)return {brightness:0,contrast:1,gamma:1,scenes:frames.length,limited:true};
 const isHalftone=mode==='halftone',classes=isHalftone?HALFTONE_TONES.length:16;
 let best=null;
 // Modest range avoids extreme changes for short/noisy samples.
 const brightnessValues=arrRange(-25,40,5),contrastValues=arrRange(.7,1.8,.1),gammaValues=arrRange(.6,1.3,.05);
 for(const brightness of brightnessValues)for(const contrast of contrastValues)for(const gamma of gammaValues){
  const levels=Array.from({length:HIST_BINS},(_,i)=>{
   const gray=(i+.5)/HIST_BINS,adj=clamp((gray-.5)*contrast+.5+brightness/100);
   return isHalftone?1-Math.pow(adj,gamma):Math.pow(adj,gamma);
  });
  const globalCounts=new Float64Array(classes),sceneEntropies=[];
  for(const frame of snapshots){
   const counts=new Float64Array(classes);
   for(let i=0;i<HIST_BINS;i++){
    const count=frame[i];if(!count)continue;
    const v=levels[i];
    if(isHalftone){
     // Approximate the fixed 4x4 Bayer ordered dither across a scene.
     for(let j=0;j<16;j++){
      const value=clamp(v+(BAYER4[j]-7.5)/16*HALFTONE_DITHER_STRENGTH);
      const index=Math.min(classes-1,Math.floor(value*classes));
      counts[index]+=count/16;
     }
    }else{
     counts[Math.min(15,Math.floor(clamp(v)*16))]+=count;
    }
   }
   sceneEntropies.push(entropy(counts));
   for(let j=0;j<classes;j++)globalCounts[j]+=counts[j];
  }
  const avg=sceneEntropies.reduce((a,b)=>a+b)/sceneEntropies.length,
   worst=Math.min(...sceneEntropies),total=globalCounts.reduce((a,b)=>a+b);
  let score=.48*avg+.52*worst;
  if(isHalftone){
   // Large, filled dots dominate and flatten dark scenes in Mode 2.
   score-=1*Math.max(0,globalCounts[classes-1]/total-.3);
   score-=.45*Math.max(0,globalCounts[0]/total-.45);
  }else{
   // Avoid clipping highlights/shadows in the 16-character / contour modes.
   score-=.8*Math.max(0,(globalCounts[0]+globalCounts[15])/total-.32);
  }
  // Mild preference for less intrusive changes when quality scores tie.
  score-=.0015*(Math.abs(brightness)/5+Math.abs(contrast-1)/.1+Math.abs(gamma-1)/.05);
  if(!best||score>best.score)
   best={brightness,contrast,gamma,score};
 }
 return {brightness:best.brightness,contrast:best.contrast,gamma:best.gamma,scenes:frames.length,limited:false};
}

export async function analyzeVideoTone(file,{
 mode='halftone',width=80,height=45,fit='cover',sourceGrid=false,
 positionX=.5,positionY=.5,signal,onProgress=()=>{}
}={}) {
 aborted(signal);
 if(!MODE_SET.has(mode))throw Error('変換方式が不正です');
 if(!file||file.size<=0||file.size>2*1024**3)throw Error('動画ファイルは2GB以内にしてください');
 // The recommended-settings analyser samples an internally capped 128x80
 // image, but must accept every input grid that the converter itself permits.
 // In particular PC-98 native 16-dot display uses 240x67 (landscape) or
 // up to 240x120 (portrait). The old 160x100 check rejected those layouts.
 if(!Number.isInteger(width)||width<4||width>480||
    !Number.isInteger(height)||height<4||height>240)
  throw Error('文字数が不正です');
 if(!['cover','contain'].includes(fit)||![positionX,positionY].every(x=>Number.isFinite(x)&&x>=0&&x<=1))
  throw Error('切り抜き設定が不正です');
 // Keep the crop and cell ratio of the selected layout, but cap analysis work.
 const scale=Math.min(1,128/width,80/height);
 const w=Math.max(4,2*Math.floor(width*scale/2)),h=Math.max(4,Math.round(height*scale));
 const sample=4,canvas=document.createElement('canvas');
 canvas.width=w*sample;canvas.height=h*sample;
 const ctx=canvas.getContext('2d',{willReadFrequently:true,alpha:false});
 if(!ctx)throw Error('画像解析を利用できません');
 const video=document.createElement('video'),url=URL.createObjectURL(file);
 video.muted=true;video.playsInline=true;video.preload='auto';
 const frames=[];
 try{
  onProgress(0,POSITIONS.length);
  await waitVideoEvent(video,'loadeddata',()=>{video.src=url;video.load();},signal);
  if(!(video.duration>0&&video.duration<=7200&&Number.isFinite(video.duration)))
   throw Error('動画は2時間以内にしてください');
  if(!video.videoWidth||!video.videoHeight)throw Error('映像を取得できません');
  const rect=sourceGrid?
   pc98SourceDrawRect(video.videoWidth,video.videoHeight,canvas.width,canvas.height,positionX,positionY):
   fitRect(video.videoWidth,video.videoHeight,canvas.width,canvas.height,.5,fit,positionX,positionY);
  const positions=video.duration<1.5?[.15,.5,.85]:video.duration<5?[.12,.37,.62,.87]:POSITIONS;
  for(let i=0;i<positions.length;i++){
   aborted(signal);
   const sec=Math.max(0,Math.min(video.duration-.001,video.duration*positions[i]));
   if(Math.abs(video.currentTime-sec)>.005)
    await waitVideoEvent(video,'seeked',()=>{video.currentTime=sec;},signal,25000);
   aborted(signal);
   ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.drawImage(video,rect.x,rect.y,rect.width,rect.height);
   frames.push(sampleLuminanceHistogram(ctx.getImageData(0,0,canvas.width,canvas.height).data,w,h,{sample}));
   onProgress(i+1,positions.length);
  }
  aborted(signal);
  return suggestToneSettings(frames,{mode});
 }finally{
  video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);
 }
}
