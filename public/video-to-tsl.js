import {makePlan,fitRect,densityRamp,TSLWriter,optionsFor} from './tsl-converter-core.js';
import {drawTSL} from './tsl.js';
import {fileIdentity,fingerprint,readCheckpoint,beginCheckpoint,appendCheckpoint} from './tsl-checkpoint.js';

const aborted=()=>new DOMException('変換を中止しました','AbortError');
function check(signal){if(signal?.aborted)throw aborted();}
function mediaEvent(video,event,signal,trigger) {
 return new Promise((resolve,reject)=>{
  check(signal);
  const finish=error=>{clearTimeout(timer);video.removeEventListener(event,ok);video.removeEventListener('error',fail);signal?.removeEventListener('abort',cancel);error?reject(error):resolve();};
  const ok=()=>finish(),fail=()=>finish(Error('この動画をデコードできません。H.264形式のMP4を選んでください。')),cancel=()=>finish(aborted());
  const timer=setTimeout(()=>finish(Error('動画の読み取りがタイムアウトしました')),30000);
  video.addEventListener(event,ok,{once:true});video.addEventListener('error',fail,{once:true});signal?.addEventListener('abort',cancel,{once:true});
  try{trigger?.();}catch(e){finish(e);}
 });
}
export function calibrateRamp(){
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
 return densityRamp(char=>{
  drawTSL(canvas,{width:1,height:1,frames:[char]},0);
  const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
  let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]+pixels[i+1]+pixels[i+2];
  return sum;
 });
}
function convertFrame(worker,pixels,width,height,options,signal) {
 return new Promise((resolve,reject)=>{
  check(signal);
  const finish=(error,frame)=>{clearTimeout(timer);worker.onmessage=null;worker.onerror=null;signal?.removeEventListener('abort',cancel);error?reject(error):resolve(frame);};
  const cancel=()=>finish(aborted()),timer=setTimeout(()=>finish(Error('文字変換がタイムアウトしました')),30000);
  signal?.addEventListener('abort',cancel,{once:true});
  worker.onmessage=({data:d})=>finish(d.error?Error(d.error):null,d.frame);
  worker.onerror=e=>finish(Error(e.message||'文字変換ワーカーの起動に失敗しました'));
  worker.postMessage({pixels:pixels.buffer,width,height,options},[pixels.buffer]);
 });
}
export async function convertVideo(file,{signal,onProgress=()=>{},onCheckpointIssue=()=>{},checkpointConfig={},...input}={}) {
 check(signal);const options=optionsFor(input);
 const {fit='contain',positionX=.5,positionY=.5}=input;
 if(!['contain','cover'].includes(fit)||![positionX,positionY].every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw Error('切り抜き設定が不正です');
 if(!file||file.size===0)throw Error('空のファイルです');
 if(file.size>2*1024**3)throw Error('動画ファイルは2GB以下にしてください');
 if(!/\.(mp4|m4v|webm)$/i.test(file.name))throw Error('MP4を選んでください。WebMはこのブラウザーで読み取れる場合に利用できます。');
 const video=document.createElement('video'),url=URL.createObjectURL(file);
 video.muted=true;video.playsInline=true;video.preload='auto';
 let worker;
 try {
  onProgress({phase:'loading'});
  await mediaEvent(video,'loadeddata',signal,()=>{video.src=url;video.load();});
  const plan=makePlan(video.duration,options);
  if(!video.videoWidth||!video.videoHeight)throw Error('映像トラックがありません');
  if(video.videoWidth*video.videoHeight>3840*2160)throw Error('動画の解像度は4K（約830万画素）以下にしてください');
  const canvas=document.createElement('canvas'),sample=4;
  canvas.width=plan.width*sample;canvas.height=plan.height*sample;
  const ctx=canvas.getContext('2d',{willReadFrequently:true,alpha:false});
  const rect=fitRect(video.videoWidth,video.videoHeight,canvas.width,canvas.height,.5,fit,positionX,positionY);
  const ramp=calibrateRamp();
  let writer=new TSLWriter(plan),checkpoint=null,checkpointEnabled=true,resumeStart=0,saved=0;
  // Each checkpoint is keyed by the source, content sample, conversion settings and video metadata.
  // The video itself is deliberately NOT persisted.
  try{
   const identity=fileIdentity(file);
   const signature=JSON.stringify([1,identity,await fingerprint(file),
    [options.width,options.height,options.fps,options.brightness,options.contrast,options.gamma,options.edge,fit,positionX,positionY],
    [video.videoWidth,video.videoHeight,video.duration,plan.count]]);
   const previous=await readCheckpoint();
   if(previous?.job.signature===signature){
    try{
     for(const chunk of previous.chunks)writer.resumeChunk(chunk);
     if(writer.frames!==previous.job.done)throw Error('途中データの画面数が一致しません');
     checkpoint=previous.job;
     resumeStart=saved=writer.frames;
    }catch(e){
     writer=new TSLWriter(plan);
     onCheckpointIssue(Error('保存データが不完全だったため、最初から変換します'));
    }
   }
   if(!checkpoint){
    checkpoint={id:crypto.randomUUID(),signature,identity,config:checkpointConfig,
     total:plan.count,width:plan.width,height:plan.height,createdAt:Date.now()};
    await beginCheckpoint(checkpoint);
   }
  }catch(e){checkpointEnabled=false;onCheckpointIssue(e);}
  check(signal);
  if(resumeStart>0)onProgress({phase:'resumed',done:resumeStart,total:plan.count,plan,saved});
  const started=performance.now();
  let pending=[],startIndex=resumeStart;
  if(resumeStart<plan.count)worker=new Worker(new URL('./tsl-converter-worker.js',import.meta.url),{type:'module'});
  for(let i=resumeStart;i<plan.count;i++){
   check(signal);
   const time=Math.min(plan.steps[i].time,Math.max(0,video.duration-.001));
   if(i>0||time!==video.currentTime)await mediaEvent(video,'seeked',signal,()=>{video.currentTime=time;});
   check(signal);
   ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.drawImage(video,rect.x,rect.y,rect.width,rect.height);
   const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   pending.push(writer.append(await convertFrame(worker,pixels,plan.width,plan.height,{...options,ramp,sample},signal)));
   // Commit small batches atomically; at most 15 latest frames are lost on an abrupt close.
   if(pending.length>=16||i===plan.count-1){
    if(checkpointEnabled){
     try{await appendCheckpoint(checkpoint,startIndex,pending);saved=i+1;}
     catch(e){checkpointEnabled=false;onCheckpointIssue(e);}
    }
    startIndex=i+1;pending=[];
   }
   const elapsed=(performance.now()-started)/1000,processed=i+1-resumeStart;
   onProgress({phase:'converting',done:i+1,total:plan.count,seconds:time,elapsed,
    remaining:elapsed/processed*(plan.count-i-1),plan,saved});
  }
  check(signal);
  const blob=writer.finish();
  return {blob,plan,ramp,source:{width:video.videoWidth,height:video.videoHeight,duration:video.duration},elapsed:(performance.now()-started)/1000};
 } finally {worker?.terminate();video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
