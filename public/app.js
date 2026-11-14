import {setupImmersive} from './immersive.js';
import {setupConverter} from './converter-ui.js';
import {decodeMAG} from './mag.js';
import {parseTSL,tslFrameAt,drawTSL} from './tsl.js';
import {exportMP4,mp4Name} from './mp4-export.js';
import {exportTslInWorker} from './tsl-export-controller.js';
const $=id=>document.getElementById(id),canvas=$('screen'),ctx=canvas.getContext('2d',{alpha:false});
let current=null,session=null,serial=0,loadSerial=0,frameRequest=0,installPrompt=null,swRegistration=null;
let exportController=null, exportDownloadUrl=null;
const events=[],metrics={version:'0.3.42-rc2',kind:null,frames:0,seconds:0,underruns:0,gapSamples:0};
function log(type,detail={}){events.push({time:new Date().toISOString(),type,...detail});if(events.length>120)events.shift();}
function status(s){$('status').textContent=s;}
function clock(t){metrics.seconds=t;$('clock').textContent=Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');}
function buttons(running=false){
 const busy=!!exportController;
 $('tab-converter').disabled=busy;
 $('tab-player').disabled=busy;
 $('play').disabled=!current||current.kind==='MAG'||running||busy;
 $('stop').disabled=!running;
 $('export-mp4').disabled=!current||busy;
 $('cancel-mp4').hidden=!busy;
 $('open').disabled=busy;
 $('open-empty').disabled=busy;
 $('file').disabled=busy;
 $('demo').disabled=busy;
 $('tsl-text-color').disabled=busy;
 $('tsl-bg-color').disabled=busy;
 $('apply-tsl-colors').disabled=busy||current?.kind!=='TSL';
}
function tslAppearance(){return {foreground:$('tsl-text-color').value,background:$('tsl-bg-color').value};}
function recolorTsl(){
 const appearance=tslAppearance();
 const details=$('tsl-color-status');
 if(current?.kind!=='TSL'){
  details.textContent='TSLファイルを開くと色が反映されます。';
  return;
 }
 try{
  const seconds=session?.kind==='TSL'?Math.max(0,(performance.now()-session.started)/1000):metrics.seconds;
  const frame=tslFrameAt(current.data,Math.min(seconds,current.data.duration));
  drawTSL(canvas,current.data,frame,appearance);ratio(canvas.width,canvas.height);
  if(session?.kind==='TSL'){
   session.last=frame;
   session.lastColors=appearance.foreground+'|'+appearance.background;
  }
  // Read back a blank pixel in the last character cell to distinguish a
  // stale JavaScript bundle from a native canvas paint failure on Android.
  const actual=canvas.getContext('2d').getImageData(canvas.width-1,canvas.height-1,1,1).data;
  const expected=[1,3,5].map(i=>parseInt(appearance.background.slice(i,i+2),16));
  const matches=expected.every((channel,i)=>Math.abs(channel-actual[i])<=2);
  details.textContent=matches
   ?'反映済み：文字 '+appearance.foreground+' ／ 背景 '+appearance.background
   :'描画確認エラー：設定 背景 '+appearance.background+' ／ 実際 '+[...actual.slice(0,3)].join(',');
  log('tsl-color-render',{appearance,readback:[...actual.slice(0,3)],ok:matches});
 }catch(e){
  details.textContent='色の反映に失敗しました: '+e.message;
  log('tsl-color-error',{message:String(e.message||e)});
 }
}
function ratio(w,h){$('stage').style.aspectRatio=w+'/'+h;}
function paint(frame){if(canvas.width!==frame.width||canvas.height!==frame.height){canvas.width=frame.width;canvas.height=frame.height;}ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels),frame.width,frame.height),0,0);ratio(frame.width,frame.height);metrics.frames++;}
function release(s){
 if(!s)return;s.worker?.terminate();s.node?.port.postMessage({type:'stop'});
 s.node?.disconnect();s.gain?.disconnect();s.audio?.close().catch(()=>{});
}
function stop(message='停止しました'){
 serial++;cancelAnimationFrame(frameRequest);release(session);session=null;buttons(false);
 document.querySelectorAll('.keypad .down').forEach(b=>b.classList.remove('down'));
 if(current)status(message);
}
function failure(e){
 log('error',{message:String(e.message||e)});stop();status('再生できません: '+String(e.message||e));
}
async function openFile(file){
 const id=++loadSerial;stop();current=null;buttons();status('読み込み中…');
 if(exportDownloadUrl)URL.revokeObjectURL(exportDownloadUrl);
 exportDownloadUrl=null;$('mp4-download').hidden=true;
 try{
  if(!file||file.size>256*1024*1024)throw Error('256MiB以下のファイルを選んでください');
  const bytes=await file.arrayBuffer();if(id!==loadSerial)return;
  const head=String.fromCharCode(...new Uint8Array(bytes,0,Math.min(16,bytes.byteLength))),ext=file.name.split('.').pop().toUpperCase();
  let kind,data;
  if(head.startsWith('MAKI02  ')){kind='MAG';data=decodeMAG(bytes);}
  else if(ext==='MMS'){kind='MMS';}
  else if(ext==='TSL'){kind='TSL';data=parseTSL(new TextDecoder('shift_jis').decode(bytes));}
  else throw Error('MAG・TSL・MMSのいずれかを選んでください');
  current={kind,data,bytes,name:file.name};Object.assign(metrics,{kind,filename:file.name,frames:0,seconds:0,underruns:0,gapSamples:0});
  $('empty').hidden=true;$('filename').textContent=file.name;$('kind').textContent=kind;$('keys').hidden=kind!=='MMS';
  $('volume').disabled=kind!=='MMS';$('loop').disabled=kind==='MAG';clock(0);
  canvas.width=640;canvas.height=400;ctx.fillStyle='#05080b';ctx.fillRect(0,0,640,400);ratio(640,400);
  if(kind==='MAG'){paint({width:data.width,height:data.height,pixels:data.rgba.buffer});ratio(data.width,data.height*data.pixelAspect);status(data.width+' × '+data.height+' / '+data.colors+'色');}
  else if(kind==='TSL'){drawTSL(canvas,data,tslFrameAt(data,0),tslAppearance());ratio(canvas.width,canvas.height);status('再生できます（TSLには音声がありません）');}
  else status('再生できます');
  buttons();log('open',{name:file.name,kind,size:file.size});
 }catch(e){if(id===loadSerial){current=null;buttons();failure(e);}}
}
function finish(s){
 if(session!==s)return;
 cancelAnimationFrame(frameRequest);release(s);session=null;buttons(false);status('再生が終了しました');log('ended',{...metrics});
 if($('loop').checked&&!document.hidden)play();
}
function tick(s){
 if(session!==s)return;
 if(s.kind==='TSL'){
  const t=(performance.now()-s.started)/1000,at=Math.min(t,current.data.duration);clock(at);
  const index=tslFrameAt(current.data,at),appearance=tslAppearance();
  const colors=appearance.foreground+'|'+appearance.background;
  if(index!==s.last||colors!==s.lastColors){drawTSL(canvas,current.data,index,appearance);ratio(canvas.width,canvas.height);s.last=index;s.lastColors=colors;metrics.frames++;}
  if(t>=current.data.duration){finish(s);return;}
 }else if(s.clock){
  const output=s.audio.getOutputTimestamp?.(),now=output?.contextTime>0?output.contextTime+Math.max(0,(performance.now()-output.performanceTime)/1000):s.audio.currentTime-(s.audio.baseLatency||0)-(s.audio.outputLatency||0);
  const t=Math.max(0,s.clock.seconds+Math.min(.025,now-s.clock.contextTime));clock(t);
  let latest;while(s.frames.length&&s.frames[0].time<=t+.001)latest=s.frames.shift();
  if(latest)paint(latest);
  if(s.ending&&now>=s.ending.contextTime){clock(s.ending.seconds);if(s.frames.length)paint(s.frames.at(-1));finish(s);return;}
 }
 frameRequest=requestAnimationFrame(()=>tick(s));
}
async function play(){
 if(!current||current.kind==='MAG')return;
 stop();const token=++serial,s=session={kind:current.kind,frames:[],started:performance.now(),last:-1};buttons(true);
 Object.assign(metrics,{frames:0,seconds:0,underruns:0,gapSamples:0});clock(0);status('再生準備中…');
 try{
  if(s.kind==='TSL'){status('再生中');tick(s);return;}
  if(!window.AudioWorkletNode)throw Error('このブラウザーはAudioWorkletに対応していません。Chromeで開いてください');
  s.audio=new AudioContext({latencyHint:'playback'});await s.audio.resume();
  await s.audio.audioWorklet.addModule('/pcm-worklet.js');if(token!==serial){release(s);return;}
  s.node=new AudioWorkletNode(s.audio,'pc98-pcm',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
  s.gain=s.audio.createGain();s.gain.gain.value=Number($('volume').value)/100;s.node.connect(s.gain).connect(s.audio.destination);
  const channel=new MessageChannel();s.node.port.postMessage({type:'connect',port:channel.port1},[channel.port1]);
  s.node.port.onmessage=({data:d})=>{
   if(session!==s)return;
   if(d.type==='clock'){s.clock=d;metrics.underruns=d.underruns;metrics.gapSamples=d.gapSamples;}
   else if(d.type==='ended'){s.ending=d;Object.assign(metrics,{underruns:d.underruns,gapSamples:d.gapSamples});}
  };
  s.worker=new Worker('/mms-worker.js',{type:'module'});
  s.worker.onerror=e=>{if(session===s)failure(Error(e.message||'再生ワーカーのエラー'));};
  s.worker.onmessage=({data:d})=>{
   if(session!==s)return;
   if(d.type==='frame'){s.frames.push(d);if(s.frames.length>180)failure(Error('映像の処理が追いつきません'));}
   else if(d.type==='ready'){status('再生中');log('audio-start',{rate:s.audio.sampleRate,baseLatency:s.audio.baseLatency});}
   else if(d.type==='error')failure(Error(d.message));
   else if(d.type==='generated-end')log('generated-end',d);
  };
  const bytes=current.bytes.slice(0);s.worker.postMessage({type:'load',bytes,rate:s.audio.sampleRate,port:channel.port2},[bytes,channel.port2]);tick(s);
 }catch(e){if(token===serial)failure(e);else release(s);}
}
$('open').onclick=$('open-empty').onclick=()=>$('file').click();
$('file').onchange=()=>{const file=$('file').files[0];$('file').value='';if(file)openFile(file);};
$('play').onclick=play;$('stop').onclick=()=>stop();
for(const id of ['tsl-text-color','tsl-bg-color']){
 const picker=$(id);
 // Android native color dialogs may commit on change rather than input.
 picker.addEventListener('input',recolorTsl);
 picker.addEventListener('change',recolorTsl);
 picker.addEventListener('blur',recolorTsl);
}
// Explicit fallback even when a native picker changes its value without firing events.
$('apply-tsl-colors').onclick=recolorTsl;
window.addEventListener('focus',()=>requestAnimationFrame(recolorTsl));
$('export-mp4').onclick=async()=>{
 if(!current||exportController)return;
 stop('MP4保存のため再生を停止しました');
 const selected=current,appearance=selected.kind==='TSL'?tslAppearance():undefined;
 exportController=new AbortController();buttons(false);
 $('mp4-download').hidden=true;
 let lastShown=-1,exportResolution='';
 status('MP4書き出し準備中…');
 try {
  const exporter=selected.kind==='TSL'?exportTslInWorker:exportMP4;
  const blob=await exporter(selected,{signal:exportController.signal,tslAppearance:appearance,
    onRetry:()=>status('高解像度の書き出しが停止したため、HDで再試行しています…'),
    onStage:stage=>status(stage==='reading'?'TSLをMP4用に準備中…':'MP4エンコードを開始しています…'),
    onResolution:(w,h)=>{exportResolution=`${w}×${h} / `;},onProgress:(seconds,total)=>{
   const count=Math.floor(seconds);
   if(count!==lastShown){lastShown=count;status('MP4変換中 '+Math.floor(seconds/60)+':'+String(count%60).padStart(2,'0')+(total?' / '+Math.ceil(total)+'秒':''));}
  }});
  if(exportDownloadUrl)URL.revokeObjectURL(exportDownloadUrl);
  exportDownloadUrl=URL.createObjectURL(blob);
  const link=$('mp4-download');link.href=exportDownloadUrl;link.download=mp4Name(selected.name);link.hidden=false;
  const a=document.createElement('a');a.href=exportDownloadUrl;a.download=mp4Name(selected.name);
  document.body.append(a);a.click();a.remove();
  status('MP4を書き出しました（'+exportResolution+(blob.size/1024/1024).toFixed(1)+' MB）');
  log('mp4-export',{name:a.download,bytes:blob.size});
 } catch (e) {
  log('mp4-export-error',{message:String(e.message||e)});
  status(e.name==='AbortError'?'MP4変換を中止しました':'MP4保存失敗: '+String(e.message||e));
 } finally {exportController=null;buttons(false);}
};
$('cancel-mp4').onclick=()=>{exportController?.abort();status('MP4変換を中止しています…');};
$('volume').oninput=()=>{if(session?.gain)session.gain.gain.setTargetAtTime(Number($('volume').value)/100,session.audio.currentTime,.015);};
$('fullscreen').onclick=()=>{const p=document.fullscreenElement?document.exitFullscreen():$('stage').requestFullscreen?.();p?.catch(e=>status('全画面表示: '+e.message));};
$('demo').onclick=async()=>{try{const r=await fetch('/ContinuityTest.MMS');if(!r.ok)throw Error('動作確認データを取得できません');await openFile(new File([await r.arrayBuffer()],'ContinuityTest.MMS'));}catch(e){failure(e);}};
function key(code,down){session?.worker?.postMessage({type:'key',key:code,down});}
for(const b of document.querySelectorAll('[data-key]')){
 const code=Number(b.dataset.key);
 b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);b.classList.add('down');key(code,true);};
 b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>{b.classList.remove('down');key(code,false);};
}
window.addEventListener('keydown',e=>{if(session?.kind==='MMS'&&!['INPUT','BUTTON','SUMMARY'].includes(e.target.tagName)){e.preventDefault();key(e.keyCode,true);}});
window.addEventListener('keyup',e=>key(e.keyCode,false));
window.addEventListener('blur',()=>{for(let i=0;i<256;i++)key(i,false);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&session)stop('画面を離れたため停止しました');});
$('diagnostics').onclick=()=>{
 const payload={...metrics,userAgent:navigator.userAgent,events},url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');
 a.href=url;a.download='pc98-player-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;});
$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install').hidden=true;}};
async function setupOffline(){
 if(!('serviceWorker' in navigator))return;
 try{
  swRegistration=await navigator.serviceWorker.register('/sw.js?v=0.3.42-rc2',{updateViaCache:'none'});await navigator.serviceWorker.ready;
  swRegistration.update().catch(()=>{});
  $('offline').textContent='オフライン準備済み';
  const show=()=>{if(swRegistration.waiting)$('update').hidden=false;};show();
  swRegistration.addEventListener('updatefound',()=>swRegistration.installing?.addEventListener('statechange',show));
 }catch(e){$('offline').textContent='オフライン保存は利用できません';log('offline-error',{message:e.message});}
}
$('update').onclick=()=>{stop();if(swRegistration?.waiting)swRegistration.waiting.postMessage({type:'activate'});else location.reload();};
let hadServiceWorkerController=!!navigator.serviceWorker?.controller;
navigator.serviceWorker?.addEventListener('controllerchange',()=>{
 // First install is not an update: do not reset the active tab or file selection.
 if(!hadServiceWorkerController){hadServiceWorkerController=true;return;}
 // An existing PWA was upgraded; refresh only when no user work can be lost.
 if(!current&&!exportController)location.reload();
 else { $('update').hidden=false; $('offline').textContent='新版を取得しました。作業後に更新を適用してください'; }
});
setupOffline();
// Read-only operational metrics used by browser verification and the diagnostic download.
Object.defineProperty(window,'playerDiagnostics',{get:()=>JSON.parse(JSON.stringify({...metrics,events}))});
const enterImmersive=setupImmersive({stage:$('stage'),stop:()=>stop()});
setupConverter({enterImmersive,openPreview:async file=>{await openFile(file);if(current?.kind==='TSL')await play();},stopPlayback:()=>stop(),isExporting:()=>!!exportController});
