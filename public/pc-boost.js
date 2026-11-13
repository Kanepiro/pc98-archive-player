// Optional PC-only C++ converter. Completely separate from browser workers.
const HOST = 'http://127.0.0.1:39083';
const cancelled = () => new DOMException('変換を中止しました', 'AbortError');
const check = signal => { if (signal?.aborted) throw cancelled(); };

async function jsonResponse(url, options) {
 const response = await fetch(url, options);
 let obj;
 try { obj = await response.json(); } catch { obj = {}; }
 if (!response.ok) throw Error(obj.error || obj.message || 'PCブーストとの通信に失敗しました');
 return obj;
}
function normalizePlan(plan) {
 const duration=plan.duration,count=plan.count;
 return {...plan,conversionMode:plan.mode,
  effectiveFps:count/duration,
  reduced:count<Math.ceil(duration*plan.fps)};
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
export async function convertVideoNative(file,{signal,onProgress=()=>{},...options}={}) {
 check(signal);
 let health;
 try { health=await jsonResponse(HOST+'/health',{signal,cache:'no-store'}); }
 catch(e) {
  if(signal?.aborted)throw cancelled();
  throw Error('PCブーストの補助プログラムが見つかりません。PCで起動してから再試行してください。ブラウザーのローカルネットワーク接続許可も確認してください。('+e.message+')');
 }
 if(!health.native||!health.ffmpeg||!health.ffprobe)
  throw Error('PCブーストにネイティブ変換機またはFFmpegがありません。');
 check(signal);
 onProgress({phase:'boost-upload'});
 const serialized=btoa(JSON.stringify({
  mode:options.conversionMode,
  width:options.width,height:options.height,
  sourceGrid:options.sourceGrid,fps:options.fps,
  brightness:options.brightness,contrast:options.contrast,
  gamma:options.gamma,edge:options.edge,native16:options.native16,
  fit:options.fit,positionX:options.positionX,positionY:options.positionY
 }));
 const start=performance.now();
 const job=await jsonResponse(HOST+'/jobs',{
  method:'POST',body:file,signal,
  headers:{'Content-Type':'application/octet-stream','X-TASL-Options':serialized}
 });
 let plan=null,complete=null,lastDone=0,conversionStart=performance.now();
 const onAbort=()=>{
  fetch(HOST+'/jobs/'+encodeURIComponent(job.id)+'/cancel',{method:'POST',keepalive:true}).catch(()=>{});
 };
 signal?.addEventListener('abort',onAbort,{once:true});
 try{
  while(true){
   check(signal);
   const state=await jsonResponse(HOST+'/jobs/'+encodeURIComponent(job.id),
    {signal,cache:'no-store'});
   if(state.plan?.count)plan=normalizePlan(state.plan);
   if(state.state==='error')throw Error(state.message||'PC変換が失敗しました');
   if(state.state==='cancelled')throw cancelled();
   if(state.state==='done'){complete=state;break;}
   if(plan){
    const elapsed=(performance.now()-conversionStart)/1000;
    const done=state.done||0;
    if(done!==lastDone||state.state==='converting'){
     lastDone=done;
     const remaining=done>0?elapsed/done*(plan.count-done):0;
     onProgress({phase:'converting',done,total:plan.count,elapsed,remaining,
      seconds:done/plan.effectiveFps,plan,saved:0,acceleration:'PC Native'});
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
  if(!response.ok)throw Error('完成したTSLをPC補助プログラムから受信できませんでした');
  const blob=await response.blob();
  return {blob,plan,source:{width:plan.sourceWidth,height:plan.sourceHeight,
   duration:plan.duration},elapsed:(performance.now()-start)/1000};
 }finally{
  signal?.removeEventListener('abort',onAbort);
 }
}
