// PC-only native converter: FFmpeg streaming + optimized C++ Shift-JIS engine.
const HOST='http://127.0.0.1:39083';
const STORAGE_KEY='tasl-pc-boost-active-v1';
const cancelled=()=>new DOMException('変換を中止しました','AbortError');
const check=signal=>{if(signal?.aborted)throw cancelled();};
const readRecord=()=>{try{return JSON.parse(localStorage.getItem(STORAGE_KEY));}catch{return null;}};
const clearRecord=()=>{try{localStorage.removeItem(STORAGE_KEY);}catch{}};
const saveRecord=data=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}catch{}};

async function jsonResponse(url,options){
 const response=await fetch(url,options);
 let obj;
 try{obj=await response.json();}catch{obj={};}
 if(!response.ok)throw Error(obj.error||obj.message||'PCブーストとの通信に失敗しました');
 return obj;
}
function normalizePlan(plan){
 const duration=plan.duration,count=plan.count;
 return {...plan,conversionMode:plan.mode,
  effectiveFps:count/duration,reduced:count<Math.ceil(duration*plan.fps)};
}
function sleep(ms,signal){
 return new Promise((resolve,reject)=>{
  check(signal);
  const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve();};
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(cancelled());};
  const timer=setTimeout(finish,ms);
  signal?.addEventListener('abort',abort,{once:true});
 });
}
async function fingerprint(file){
 // Cheap enough for multi-GB videos, but strongly identifies a selected video.
 const first=new Uint8Array(await file.slice(0,65536).arrayBuffer());
 const last=new Uint8Array(await file.slice(Math.max(0,file.size-65536)).arrayBuffer());
 const bytes=new Uint8Array(first.length+last.length+16);
 bytes.set(first,0);bytes.set(last,first.length);
 new DataView(bytes.buffer).setFloat64(bytes.length-16,file.size,true);
 new DataView(bytes.buffer).setFloat64(bytes.length-8,file.lastModified,true);
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return [...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export async function convertVideoNative(file,{signal,onProgress=()=>{},...options}={}){
 check(signal);
 let health;
 try{health=await jsonResponse(HOST+'/health',{signal,cache:'no-store'});}
 catch(e){
  if(signal?.aborted)throw cancelled();
  throw Error('PCブーストが起動していません。Windows版EXEを起動し、同じPCのChrome/Edgeを利用してください。('+e.message+')');
 }
 if(!health.native||!health.ffmpeg||!health.ffprobe)
  throw Error('PCブーストにC++エンジン、FFmpegまたはFFprobeがありません。');
 check(signal);
 const serialized=btoa(JSON.stringify({
  mode:options.conversionMode,
  width:options.width,height:options.height,
  sourceGrid:options.sourceGrid,fps:options.fps,
  brightness:options.brightness,contrast:options.contrast,
  gamma:options.gamma,edge:options.edge,native16:options.native16,
  fit:options.fit,positionX:options.positionX,positionY:options.positionY,
  sourceAudioRequired:options.sourceAudioRequired===true
 }));
 const identity=await fingerprint(file);
 check(signal);
 const cacheKey=identity+':'+serialized;
 const record=readRecord();
 const start=performance.now();
 let job=null;
 if(record?.key===cacheKey&&record.id){
  try{
   const state=await jsonResponse(HOST+'/jobs/'+encodeURIComponent(record.id),
    {signal,cache:'no-store'});
   if(!['error','cancelled'].includes(state.state)){
    job={id:record.id};
    onProgress({phase:'boost-wait',message:'前回のPCブースト処理に再接続しました'});
   }
  }catch{}
 }
 if(!job){
  onProgress({phase:'boost-upload'});
  job=await jsonResponse(HOST+'/jobs',{
   method:'POST',body:file,signal,
   headers:{'Content-Type':'application/octet-stream','X-TASL-Options':serialized}
  });
 }
 saveRecord({id:job.id,key:cacheKey,name:file.name});
 let plan=null,lastDone=0,conversionStart=performance.now(),firstProgress=true;
 const onAbort=()=>{
  clearRecord();
  fetch(HOST+'/jobs/'+encodeURIComponent(job.id)+'/cancel',
   {method:'POST',keepalive:true}).catch(()=>{});
 };
 signal?.addEventListener('abort',onAbort,{once:true});
 try{
  while(true){
   check(signal);
   const state=await jsonResponse(HOST+'/jobs/'+encodeURIComponent(job.id),
    {signal,cache:'no-store'});
   if(state.plan?.count)plan=normalizePlan(state.plan);
   if(state.state==='error'){clearRecord();throw Error(state.message||'PC変換が失敗しました');}
   if(state.state==='cancelled'){clearRecord();throw cancelled();}
   if(state.state==='done')break;
   if(plan){
    const elapsed=(performance.now()-conversionStart)/1000;
    const done=state.done||0;
    if(firstProgress&&done){
     onProgress({phase:'resumed',done,total:plan.count,plan,saved:done});
     firstProgress=false;
    }
    if(done!==lastDone||state.state==='converting'){
     lastDone=done;
     const remaining=done>0?elapsed/Math.max(1,done)*(plan.count-done):0;
     onProgress({phase:'converting',done,total:plan.count,elapsed,remaining,
      seconds:done/plan.effectiveFps,plan,saved:done,acceleration:'PC Native'});
    }
   }else onProgress({phase:'boost-wait',message:state.message});
   await sleep(650,signal);
  }
  check(signal);
  if(!plan)throw Error('PCブーストの変換情報を取得できませんでした');
  onProgress({phase:'converting',done:plan.count,total:plan.count,
   elapsed:(performance.now()-conversionStart)/1000,remaining:0,
   seconds:plan.duration,plan,saved:plan.count,acceleration:'PC Native'});
  onProgress({phase:'boost-download'});
  const response=await fetch(HOST+'/jobs/'+encodeURIComponent(job.id)+'/result',{signal});
  if(!response.ok)throw Error('完成したTSLをPCブーストから受信できませんでした');
  const blob=await response.blob();
  clearRecord();
  return {blob,plan,jobId:job.id,source:{width:plan.sourceWidth,height:plan.sourceHeight,
   duration:plan.duration},elapsed:(performance.now()-start)/1000};
 }finally{
  signal?.removeEventListener('abort',onAbort);
 }
}

export async function exportNativeMp4({jobId,signal,onProgress=()=>{}}={}){
 if(!jobId||!/^[0-9a-f]{24}$/.test(jobId))
  throw Error('PCブーストのジョブIDが不正です');
 const route=HOST+'/jobs/'+encodeURIComponent(jobId)+'/mp4';
 check(signal);
 await jsonResponse(route,{method:'POST',signal});
 const cancel=()=>{fetch(route+'/cancel',{method:'POST',keepalive:true}).catch(()=>{});};
 signal?.addEventListener('abort',cancel,{once:true});
 try{
  while(true){
   check(signal);
   const state=await jsonResponse(route,{signal,cache:'no-store'});
   onProgress(state);
   if(state.state==='error')throw Error(state.message||'GPU/CPU MP4生成に失敗しました');
   if(state.state==='cancelled')throw cancelled();
   if(state.state==='done'){
    // Direct HTTP download avoids copying multi-GB long videos into JS memory.
    return {url:route+'/result',size:state.size||0,encoder:state.encoder,
     width:state.width,height:state.height,total:state.total};
   }
   await sleep(600,signal);
  }
 }finally{
  signal?.removeEventListener('abort',cancel);
 }
}
