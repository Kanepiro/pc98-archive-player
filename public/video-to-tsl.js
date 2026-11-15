import {ensureTaslFont} from './tasl-font.js';
import {makePlan,fitRect,densityRamp,TSLWriter,optionsFor,pc98GridFromPixels,pc98SourceDrawRect} from './tsl-converter-core.js';
import {drawTSL} from './tsl.js';
import {makeGlyphAtlas} from './tsl-quality.js';
import {mode4Grid,makeMode4Atlas,MODE4_ENGINE} from './tsl-mode4-grid60.js';
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
  const cancel=()=>finish(aborted()),timer=setTimeout(()=>finish(Error('文字変換がタイムアウトしました')),options.conversionMode==='artisan'?300000:30000);
  signal?.addEventListener('abort',cancel,{once:true});
  worker.onmessage=({data:d})=>finish(d.error?Error(d.error):null,d);
  worker.onerror=e=>finish(Error(e.message||'文字変換ワーカーの起動に失敗しました'));
  worker.postMessage({pixels:pixels.buffer,width,height,options},[pixels.buffer]);
 });
}
function readQualityState(worker,signal){
 return new Promise((resolve,reject)=>{
  check(signal);
  const finish=(error,state)=>{
   clearTimeout(timer);worker.onmessage=null;worker.onerror=null;
   signal?.removeEventListener('abort',cancel);
   error?reject(error):resolve(state);
  };
  const cancel=()=>finish(aborted());
  const timer=setTimeout(()=>finish(Error('文字状態の保存がタイムアウトしました')),30000);
  signal?.addEventListener('abort',cancel,{once:true});
  worker.onerror=e=>finish(Error(e.message||'文字状態の保存に失敗しました'));
  worker.onmessage=({data:d})=>finish(d.error?Error(d.error):null,d.state);
  worker.postMessage({type:'snapshot'});
 });
}
export async function convertVideo(file,{signal,onProgress=()=>{},onCheckpointIssue=()=>{},checkpointConfig={},...input}={}) {
 await ensureTaslFont();
 check(signal);const taskStarted=performance.now();let options=optionsFor({...input,...(input.conversionMode==='artisan'?{mode4Cell60:true}:{})});
 const {fit='contain',positionX=.5,positionY=.5,sourceGrid=false}=input;
 if(!['contain','cover'].includes(fit)||![positionX,positionY].every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw Error('切り抜き設定が不正です');
 if(!file||file.size===0)throw Error('空のファイルです');
 if(file.size>2*1024**3)throw Error('動画ファイルは2GB以下にしてください');
 if(!/\.(mp4|m4v|webm)$/i.test(file.name))throw Error('MP4を選んでください。WebMはこのブラウザーで読み取れる場合に利用できます。');
 const video=document.createElement('video'),url=URL.createObjectURL(file);
 video.muted=true;video.playsInline=true;video.preload='auto';
 let worker,vision,frameReader=null,metricsId=null,metricFrames=[];
 if(input.exactNative)try{const r=await fetch('/api/metrics/start',{method:'POST'});if(r.ok)metricsId=(await r.json()).id;}catch{}
 try {
  onProgress({phase:'loading'});
  await mediaEvent(video,'loadeddata',signal,()=>{video.src=url;video.load();});
  if(!video.videoWidth||!video.videoHeight)throw Error('映像トラックがありません');
  if(video.videoWidth*video.videoHeight>3840*2160)throw Error('動画の解像度は4K（約830万画素）以下にしてください');
  // Source-resolution PC-98 mode always derives the grid from actual decoded
  // video metadata, never a size preset or a stale UI value.
  if(options.conversionMode==='artisan')options=optionsFor({...options,...mode4Grid(video.videoWidth,video.videoHeight)});
  else if(sourceGrid){
   const native=pc98GridFromPixels(video.videoWidth,video.videoHeight);
   options=optionsFor({...options,width:native.width,height:native.height,native16:true});
  }
  const plan=makePlan(video.duration,options);
  const canvas=document.createElement('canvas'),sample=options.conversionMode==='artisan'
   ?(plan.width*plan.height<=3000?10:6):options.conversionMode==='quality'?6:4;
  canvas.width=options.mode4Cell60?plan.width*30:plan.width*sample;canvas.height=options.mode4Cell60?plan.height*60:plan.height*sample;
  const ctx=canvas.getContext('2d',{willReadFrequently:true,alpha:false});
  const rect=options.mode4Cell60?{x:Math.floor((canvas.width-video.videoWidth)/2),y:Math.floor((canvas.height-video.videoHeight)/2),width:video.videoWidth,height:video.videoHeight}:sourceGrid?
   pc98SourceDrawRect(video.videoWidth,video.videoHeight,canvas.width,canvas.height,positionX,positionY):
   fitRect(video.videoWidth,video.videoHeight,canvas.width,canvas.height,.5,fit,positionX,positionY);
  const ramp=options.conversionMode==='legacy'?calibrateRamp():undefined;
  let writer=new TSLWriter(plan),checkpoint=null,checkpointEnabled=true,resumeStart=0,saved=0,resumeState=null;
  // Each checkpoint is keyed by the source, content sample, conversion settings and video metadata.
  // The video itself is deliberately NOT persisted.
  try{
   const identity=fileIdentity(file);
   const baseEngineVersion=options.conversionMode==='artisan'?MODE4_ENGINE:options.conversionMode==='quality'?(options.native16?48:47):options.conversionMode==='halftone'?(options.native16?55:54):(options.native16?43:42);
   const engineVersion=baseEngineVersion+(!options.mode4Cell60&&sourceGrid?20:0);
   const signature=JSON.stringify([engineVersion,identity,await fingerprint(file),
    [options.mode4ScoreLimit,options.mode4BlurSigma,options.mode4EdgeHigh,options.mode4EdgeLow,options.mode4MinEdge,options.width,options.height,options.fps,options.brightness,options.contrast,options.gamma,options.edge,options.conversionMode,options.native16,sourceGrid,fit,positionX,positionY],
    [video.videoWidth,video.videoHeight,video.duration,plan.count],!!input.exactNative,!!input.legacyLayout]);
   const previous=await readCheckpoint();
   if(previous?.job.signature===signature){
    try{
     for(const chunk of previous.chunks)writer.resumeChunk(chunk);
     if(writer.frames!==previous.job.done)throw Error('途中データの画面数が一致しません');
     if(['quality','artisan'].includes(options.conversionMode)&&writer.frames>0){
      if(!previous.qualityState)throw Error('文字の時間状態が保存されていません');
      resumeState=previous.qualityState;
     }
     checkpoint=previous.job;
     resumeStart=saved=writer.frames;
    }catch(e){
     writer=new TSLWriter(plan);
     onCheckpointIssue(Error('保存データが不完全だったため、最初から変換します'));
    }
   }
   if(!checkpoint){
    checkpoint={id:crypto.randomUUID(),signature,identity,engineVersion,config:checkpointConfig,
     total:plan.count,width:plan.width,height:plan.height,createdAt:Date.now()};
    await beginCheckpoint(checkpoint);
   }
  }catch(e){checkpointEnabled=false;onCheckpointIssue(e);}
  check(signal);
  if(resumeStart>0)onProgress({phase:'resumed',done:resumeStart,total:plan.count,plan,saved});
  const started=performance.now();
  let pending=[],startIndex=resumeStart,acceleration='CPU';
  if(resumeStart<plan.count){
   worker=new Worker(new URL('./tsl-converter-worker.js',import.meta.url),{type:'module'});
   {
    const atlas=options.conversionMode==='artisan'
     ?await makeMode4Atlas()
     :options.conversionMode==='quality'?makeGlyphAtlas(sample):null;
    await new Promise((resolve,reject)=>{
     check(signal);
     const timeout=setTimeout(()=>finish(Error('文字パレットの準備がタイムアウトしました')),120000);
     const finish=error=>{
      clearTimeout(timeout);worker.onmessage=null;worker.onerror=null;
      signal?.removeEventListener('abort',cancel);
      error?reject(error):resolve();
     };
     const cancel=()=>finish(aborted());
     signal?.addEventListener('abort',cancel,{once:true});
     worker.onerror=e=>finish(Error(e.message||'変換ワーカーを開始できませんでした'));
     worker.onmessage=({data:d})=>finish(d.error?Error(d.error):null);
     worker.postMessage({type:'init',atlas,sample,state:resumeState,width:plan.width,height:plan.height,mode:options.conversionMode,
      exactNative:input.exactNative===true,legacyLayout:input.legacyLayout===true});
    });
   }

  }
  if(options.conversionMode==='artisan'&&resumeStart<plan.count){
   const {createVideoFrameReader}=await import('./video-frame-reader.js');
   frameReader=await createVideoFrameReader(file,
    plan.steps.slice(resumeStart).map(s=>s.time),{signal});
  }
  for(let i=resumeStart;i<plan.count;i++){
   check(signal);
   const time=Math.min(plan.steps[i].time,Math.max(0,video.duration-.001));
   let sourceFrame=video,decodedFrame=null;
   if(frameReader){decodedFrame=await frameReader.read();sourceFrame=decodedFrame.image;}
   else if(i>0||time!==video.currentTime)await mediaEvent(video,'seeked',signal,()=>{video.currentTime=time;});
   check(signal);
   const detections=await vision?.detect(sourceFrame,rect,canvas.width,canvas.height,time)||[];
   // Recognition affects importance, never the user-selected framing.
   const frameRect=rect,semantic=detections;
   ctx.fillStyle=options.mode4Cell60?'#fff':'#000';ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.drawImage(sourceFrame,frameRect.x,frameRect.y,frameRect.width,frameRect.height);
   const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   const converted=await convertFrame(worker,pixels,plan.width,plan.height,{...options,ramp,sample,semantic},signal);
   acceleration=converted.acceleration||'CPU';
   if(metricsId)metricFrames.push({frame:i,sourceSecond:time,decodedSecond:decodedFrame?.timestamp??null,backend:acceleration,perf:converted.perf,
    gpu:converted.adapterInfo,fallbackReason:converted.gpuReason,vision:vision?{backend:vision.backend||'MediaPipe CPU',timing:vision.timing}:null});
   pending.push(writer.append(converted.frame,converted.offsets));
   // Commit small batches atomically; at most 15 latest frames are lost on an abrupt close.
   if(pending.length>=16||i===plan.count-1){
    if(checkpointEnabled){
     try{
      const state=['quality','artisan'].includes(options.conversionMode)?await readQualityState(worker,signal):null;
      await appendCheckpoint(checkpoint,startIndex,pending,state);
      saved=i+1;
     }catch(e){
      if(e.name==='AbortError')throw e;
      checkpointEnabled=false;onCheckpointIssue(e);
     }
    }
    startIndex=i+1;pending=[];
   }
   const elapsed=(performance.now()-started)/1000,processed=i+1-resumeStart;
   onProgress({phase:'converting',done:i+1,total:plan.count,seconds:time,elapsed,
    remaining:elapsed/processed*(plan.count-i-1),plan,saved,acceleration,
    visionBackend:vision?(vision.backend||'MediaPipe CPU'):'利用不可',audit:converted.audit,perf:converted.perf,adapterInfo:converted.adapterInfo,gpuReason:converted.gpuReason});
  }
  check(signal);
  const blob=writer.finish();
  let metricsUrl=null;
  if(metricsId)try{
   const r=await fetch('/api/metrics/'+metricsId+'/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    appVersion:'0.3.44-rc.3',source:{name:file.name,bytes:file.size,width:video.videoWidth,height:video.videoHeight,duration:video.duration},
    settings:options,plan,resumedFrom:resumeStart,totalConversionSeconds:(performance.now()-taskStarted)/1000,frames:metricFrames,status:'completed'})});
   if(r.ok){metricsUrl=(await r.json()).url;metricsId=null;}
  }catch{}
  return {blob,plan,ramp,metricsUrl,source:{width:video.videoWidth,height:video.videoHeight,duration:video.duration},elapsed:(performance.now()-started)/1000};
 } finally {
  if(metricsId)fetch('/api/metrics/'+metricsId+'/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appVersion:'0.3.44-rc.3',status:'interrupted',frames:metricFrames}),keepalive:true}).catch(()=>{});
  worker?.terminate();vision?.close();await frameReader?.close();video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
