// Bounded two-stage visibility analysis for public Windows and Web/PWA. No uploads, saved frames,
// per-frame setting changes, or changes to ordinary conversion algorithms.
import {fitRect,pc98SourceDrawRect,pc98GridFromPixels} from './tsl-converter-core.js';
import {mode4Grid} from './tsl-mode4.js';
import {AUTO_LIMITS,sampleSource,detectActiveBounds,frameStats,shortlist,selectScenes,chooseResult,neutralTone} from './tsl-auto-visibility.js';
const MODES=new Set(['legacy','halftone','quality','artisan']);
const POSITIONS=[.08,.2,.32,.44,.56,.68,.8,.92];
function aborted(signal){if(signal?.aborted)throw new DOMException('解析を中止しました','AbortError');}
function waitVideoEvent(video,event,action,signal,timeout=25000){
 aborted(signal);
 return new Promise((resolve,reject)=>{
  let timer;const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,ok);video.removeEventListener('error',fail);signal?.removeEventListener('abort',cancel);};
  const finish=e=>{cleanup();e?reject(e):resolve();},ok=()=>finish(),fail=()=>finish(Error('動画を読み込めませんでした')),cancel=()=>finish(new DOMException('解析を中止しました','AbortError'));
  video.addEventListener(event,ok,{once:true});video.addEventListener('error',fail,{once:true});signal?.addEventListener('abort',cancel,{once:true});
  timer=setTimeout(()=>finish(Error('動画の読み込みがタイムアウトしました')),timeout);
  try{action();}catch(e){finish(e);}
 });
}
function request(worker,data,signal,transfer=[]){
 aborted(signal);
 return new Promise((resolve,reject)=>{
  const finish=(e,result)=>{clearTimeout(timer);worker.onmessage=worker.onerror=null;signal?.removeEventListener('abort',cancel);e?reject(e):resolve(result);};
  const cancel=()=>finish(new DOMException('解析を中止しました','AbortError')),timer=setTimeout(()=>finish(Error('完成AAの評価がタイムアウトしました')),240000);
  signal?.addEventListener('abort',cancel,{once:true});
  worker.onmessage=({data:d})=>finish(d.error?Error(d.error):null,d);
  worker.onerror=e=>finish(Error(e.message||'解析ワーカーを起動できません'));
  worker.postMessage(data,transfer);
 });
}
export function sampleLuminanceHistogram(pixels,width,height,{sample=4}={}){
 if(!Number.isInteger(width)||width<4||!Number.isInteger(height)||height<4||!Number.isInteger(sample)||sample<1||sample>6||pixels.length!==width*height*sample*sample*4)throw Error('解析用の画像サイズが不正です');
 const bins=new Uint32Array(64),w=width*sample;
 for(let y=0;y<height;y++)for(let x=0;x<Math.floor(width/2);x++){
  let sum=0;for(let dy=0;dy<sample;dy++)for(let dx=0;dx<sample*2;dx++){const i=((y*sample+dy)*w+x*sample*2+dx)*4;sum+=(.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2])*pixels[i+3]/255;}
  bins[Math.min(63,Math.floor(sum/(sample*sample*2*255)*64))]++;
 }return bins;
}
// Compatibility helper for histogram-only callers; the UI always evaluates actual AA.
// Bounded 38 proposals, with the same dark-to-light direction as the real converter.
export function suggestToneSettings(frames,{mode='halftone'}={}){
 if(!MODES.has(mode))throw Error('変換方式が不正です');
 if(!Array.isArray(frames)||!frames.length)throw Error('解析した場面がありません');
 if(frames.some(f=>!(f instanceof Uint32Array)||f.length!==64||!f.some(v=>v>0)))throw Error('解析データが不正です');
 const images=frames.map(hist=>{const total=hist.reduce((s,v)=>s+v,0),gray=new Float32Array(256);let bin=0,sum=hist[0];for(let i=0;i<256;i++){while(sum<(i+.5)*total/256&&bin<63)sum+=hist[++bin];gray[i]=(bin+.5)/64;}return {gray,w:64,h:4};});
 const stats=images.map(f=>frameStats(f)),limited=stats.every(s=>s.p90-s.p10<.055);
 const ranked=shortlist(images,mode).candidates.sort((a,b)=>b.score-a.score);
 return {...(limited?neutralTone():ranked[0].settings),scenes:frames.length,limited};
}
export function analysisGeometry(vw,vh,input){
 const {mode,sourceGrid=false,fit='cover',positionX=.5,positionY=.5,outputWidth,outputHeight,mode4CellSize=60}=input;
 let {width,height}=input;
 if(mode==='artisan')({width,height}=mode4Grid(outputWidth||vw,outputHeight||vh,mode4CellSize));
 else if(sourceGrid)({width,height}=pc98GridFromPixels(vw,vh));
 const sample=mode==='quality'?6:4,pw=mode==='artisan'?width*mode4CellSize/2:width*sample,ph=mode==='artisan'?height*mode4CellSize:height*sample;
 const rect=mode==='artisan'&&outputWidth?fitRect(vw,vh,pw,ph,1,fit,positionX,positionY):mode==='artisan'?{x:Math.floor((pw-vw)/2),y:Math.floor((ph-vh)/2),width:vw,height:vh}:sourceGrid?pc98SourceDrawRect(vw,vh,pw,ph,positionX,positionY):fitRect(vw,vh,pw,ph,.5,fit,positionX,positionY);
 return {width,height,sample,pw,ph,rect};
}
export async function analyzeVideoTone(file,{
 mode='halftone',mode4CellSize=60,width=80,height=45,fit='cover',sourceGrid=false,outputWidth,outputHeight,
 native16=false,edge=.6,positionX=.5,positionY=.5,signal,onProgress=()=>{},diagnostics=false,cpuOnly=false
}={}){
 aborted(signal);const started=performance.now();
 if(!MODES.has(mode))throw Error('変換方式が不正です');
 if(!file||file.size<=0||file.size>2*1024**3)throw Error('動画ファイルは2GB以内にしてください');
 if(!Number.isInteger(width)||width<(mode==='artisan'?2:4)||width>(mode==='artisan'?512:480)||!Number.isInteger(height)||height<(mode==='artisan'?1:4)||height>(mode==='artisan'?256:240))throw Error('文字数が不正です');
 if(!['cover','contain'].includes(fit)||![positionX,positionY].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('切り抜き設定が不正です');
 if(!Number.isFinite(edge)||edge<0||edge>1)throw Error('輪郭補助が不正です');
 if((outputWidth!==undefined||outputHeight!==undefined)&&(!Number.isInteger(outputWidth)||!Number.isInteger(outputHeight)||outputWidth<1||outputHeight<1||outputWidth*outputHeight>3840*2160))throw Error('出力サイズが不正です');
 const video=document.createElement('video'),url=URL.createObjectURL(file);video.muted=true;video.playsInline=true;video.preload='auto';
 let worker;
 try{
  onProgress(0,8,'sampling');
  await waitVideoEvent(video,'loadeddata',()=>{video.src=url;video.load();},signal);
  if(!(video.duration>0&&video.duration<=7200&&Number.isFinite(video.duration)))throw Error('動画は7200秒以内にしてください');
  if(!video.videoWidth||!video.videoHeight||video.videoWidth*video.videoHeight>3840*2160)throw Error('動画の解像度が不正です');
  const geometry=analysisGeometry(video.videoWidth,video.videoHeight,{mode,mode4CellSize,width,height,fit,sourceGrid,outputWidth,outputHeight,positionX,positionY});
  const {pw,ph,rect,sample}=geometry;width=geometry.width;height=geometry.height;
  const positions=video.duration<1.5?[.15,.5,.85]:video.duration<5?[.12,.37,.62,.87]:POSITIONS;
  const times=positions.map(p=>Math.max(0,Math.min(video.duration-.001,video.duration*p)));
  const seek=async t=>{aborted(signal);if(Math.abs(video.currentTime-t)>.005)await waitVideoEvent(video,'seeked',()=>{video.currentTime=t;},signal);aborted(signal);};
  const small=document.createElement('canvas');small.width=Math.min(128,pw);small.height=Math.max(4,Math.min(80,Math.round(ph*small.width/pw)));
  const sc=small.getContext('2d',{willReadFrequently:true,alpha:false});if(!sc)throw Error('画像解析を利用できません');
  const draw=(ctx,w,h)=>{ctx.fillStyle=mode==='artisan'?'#fff':'#000';ctx.fillRect(0,0,w,h);ctx.drawImage(video,rect.x*w/pw,rect.y*h/ph,rect.width*w/pw,rect.height*h/ph);};
  const frames=[];
  for(let i=0;i<times.length;i++){await seek(times[i]);draw(sc,small.width,small.height);frames.push(sampleSource(sc.getImageData(0,0,small.width,small.height).data,small.width,small.height,small.width,small.height));onProgress(i+1,times.length,'sampling');}
  const bounds=detectActiveBounds(frames,small.width,small.height);
  // Known contain/padding margins are excluded even when a source border changes.
  bounds.left=Math.max(bounds.left,rect.x/pw,0);bounds.top=Math.max(bounds.top,rect.y/ph,0);
  bounds.right=Math.min(bounds.right,(rect.x+rect.width)/pw,1);bounds.bottom=Math.min(bounds.bottom,(rect.y+rect.height)/ph,1);
  const stats=frames.map(f=>frameStats(f,bounds));
  if(stats.every(s=>s.p90-s.p10<.055&&s.detail<.012))return {...neutralTone(),scenes:frames.length,limited:true,elapsedMs:performance.now()-started};
  const proposals=shortlist(frames,mode,bounds,native16),indices=selectScenes(frames,bounds),candidates=proposals.candidates.map(c=>c.settings);
  aborted(signal);onProgress(0,candidates.length*indices.length,'converting');
  const {ensureTaslFont}=await import('./tasl-font.js');await ensureTaslFont();aborted(signal);
  let atlas=null,masks=null,ramp;
  if(mode==='legacy'){const {calibrateRamp}=await import('./video-to-tsl.js');ramp=calibrateRamp();}
  if(mode==='quality'){const {makeGlyphAtlas}=await import('./tsl-quality.js');atlas=makeGlyphAtlas(sample);}
  if(mode==='artisan'){const {makeMode4Atlas,ensureMode4Atlas}=await import('./tsl-mode4.js');[atlas,masks]=await Promise.all([makeMode4Atlas(mode4CellSize),ensureMode4Atlas(mode4CellSize)]);}
  worker=new Worker(new URL('./tsl-auto-preview-worker.js',import.meta.url),{type:'module'});
  await request(worker,{type:'init',mode,mode4CellSize,width,height,sample,atlas,masks,cpuOnly,options:{ramp,edge,native16}},signal);
  const canvas=document.createElement('canvas');canvas.width=pw;canvas.height=ph;
  const ctx=canvas.getContext('2d',{willReadFrequently:true,alpha:false});if(!ctx)throw Error('完成AAの画像を取得できません');
  const trials=candidates.map(settings=>({settings,metrics:[],backends:[],...(diagnostics?{frames:[]}: {})}));
  for(let j=0;j<indices.length;j++){
   const index=indices[j];await seek(times[index]);draw(ctx,pw,ph);
   const pixels=ctx.getImageData(0,0,pw,ph).data;
   const result=await request(worker,{type:'evaluate',pixels:pixels.buffer,candidates,bounds,diagnostics},signal,[pixels.buffer]);
   result.trials.forEach((r,k)=>{trials[k].metrics.push(r.metrics);trials[k].backends.push(r.backend);if(diagnostics)trials[k].frames.push({time:times[index],frame:r.frame,offsets:r.offsets});});
   onProgress((j+1)*candidates.length,indices.length*candidates.length,'converting');
  }
  aborted(signal);const winner=chooseResult(trials);
  return {...winner.settings,scenes:frames.length,evaluatedScenes:indices.length,candidates:candidates.length,limited:false,elapsedMs:performance.now()-started,
   ...(diagnostics?{diagnostics:{algorithm:'aa-visibility-v3',histogramCandidates:proposals.histogramCandidates,primaryCount:proposals.primaryCount,bounds,stats,times,indices,geometry,trials,winnerScore:winner.aggregate,neutralScore:winner.neutralScore}}: {})};
 }finally{worker?.terminate();video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}

