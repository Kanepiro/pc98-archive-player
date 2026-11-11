// Isolate TSL decoding, canvas drawing and H.264 encoding from the UI thread.
// If the Full-HD encoder stalls, terminate it and retry at HD resolution.
const IDLE_LIMIT_MS=35000;
const HD_PIXELS=1280*720;

function onceInWorker(current,{signal,onProgress,onResolution,onStage,maxPixels,tslAppearance,sourceAudioFile}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new DOMException('MP4書き出しを中止しました','AbortError'));return;}
  let worker,watchdog,settled=false;
  const cleanup=()=>{
   clearTimeout(watchdog);
   signal?.removeEventListener('abort',cancel);
   worker?.terminate();
  };
  const finish=(error,blob)=>{
   if(settled)return;
   settled=true;cleanup();
   error?reject(error):resolve(blob);
  };
  const cancel=()=>finish(new DOMException('MP4書き出しを中止しました','AbortError'));
  const pulse=()=>{
   clearTimeout(watchdog);
   watchdog=setTimeout(()=>finish(Error('動画エンコーダーが応答しなくなりました')),IDLE_LIMIT_MS);
  };
  try{
   worker=new Worker(new URL('./tsl-export-worker.js',import.meta.url),{type:'module'});
   worker.onerror=e=>finish(Error(e.message||'MP4書き出しワーカーを開始できませんでした'));
   worker.onmessage=({data:d})=>{
    if(settled)return;
    pulse();
    if(d.type==='progress')onProgress?.(d.seconds,d.total);
    else if(d.type==='resolution')onResolution?.(d.width,d.height);
    else if(d.type==='stage')onStage?.(d.stage);
    else if(d.type==='error')finish(Error(d.message));
    else if(d.type==='done')finish(null,new Blob([d.buffer],{type:'video/mp4'}));
   };
   signal?.addEventListener('abort',cancel,{once:true});
   pulse();
   // Source bytes are retained for playback, but the worker owns its copy.
   const bytes=current.bytes.slice(0);
   worker.postMessage({type:'start',bytes,appearance:tslAppearance,maxPixels,sourceAudioFile},[bytes]);
  }catch(e){finish(e);}
 });
}

export async function exportTslInWorker(current,{signal,onProgress,onResolution,onRetry,onStage,tslAppearance,sourceAudioFile}={}){
 if(!current||current.kind!=='TSL')throw Error('TSLファイルを選択してください');
 if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'||typeof VideoEncoder==='undefined')
  throw Error('このブラウザーはMP4のバックグラウンド書き出しに対応していません。Chrome最新版で開いてください');
 let lastError=null;
 for(const [attempt,maxPixels] of [Infinity,HD_PIXELS].entries()){
  if(signal?.aborted)throw new DOMException('MP4書き出しを中止しました','AbortError');
  if(attempt)onRetry?.();
  try{
   return await onceInWorker(current,{signal,onProgress,onResolution,onStage,maxPixels,tslAppearance,sourceAudioFile});
  }catch(e){
   if(e.name==='AbortError')throw e;
   lastError=e;
   // Fail fast on malformed files rather than unnecessarily retrying them.
   if(/5分を超える|画面データが不足|TSLの|元動画|音声トラック|音声データ|音声コーデック/.test(e.message))throw e;
  }
 }
 throw Error('MP4の書き出しに失敗しました（高画質・HDとも）：'+lastError.message);
}
