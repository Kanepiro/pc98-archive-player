import {convertVideo} from './video-to-tsl.js';
import {tslName,portraitGrid} from './tsl-converter-core.js';
export function setupConverter({openPreview,stopPlayback,isExporting,enterImmersive}) {
 const $=id=>document.getElementById(id);
 let controller=null,result=null,downloadUrl=null,selected=null;
 function show(which){
  if(isExporting())return;
  stopPlayback();
  for(const name of ['player','converter']){
   $('panel-'+name).hidden=name!==which;
   $('tab-'+name).setAttribute('aria-selected',String(name===which));
   $('tab-'+name).tabIndex=name===which?0:-1;
  }
 }
 for(const name of ['player','converter']){
  $('tab-'+name).onclick=()=>show(name);
  $('tab-'+name).onkeydown=e=>{
   if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
    e.preventDefault();const next=e.key==='Home'?'player':e.key==='End'?'converter':name==='player'?'converter':'player';
    show(next);$('tab-'+next).focus();
   }
  };
 }
 function busy(value){
  for(const id of ['video-file','video-choose','convert-again','converter-settings'])$(id).disabled=value;
  $('cancel-tsl').hidden=!value;
  $('preview-tsl').disabled=value||!result;
  $('preview-tsl-full').disabled=value||!result;
  $('convert-again').hidden=!selected;
 }
 function clearResult(){
  result=null;$('tsl-result').hidden=true;
  if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;
 }
 async function start(file){
  if(controller||isExporting())return;
  selected=file;clearResult();controller=new AbortController();busy(true);
  $('video-name').textContent=file.name;
  $('tsl-progress').removeAttribute('value');$('tsl-progress').hidden=false;
  $('converter-status').textContent='動画を読み込み中…';$('converter-detail').textContent='';
  let last=0;
  try{
   const mode=$('video-mode').value;
   const target=mode==='screen'?Math.min(screen.width,screen.height)/Math.max(screen.width,screen.height):9/16;
   const grid=mode==='pc98'?Object.fromEntries(['width','height'].map((k,i)=>[k,Number($('video-size').value.split('x')[i])])):portraitGrid(target,Number($('video-columns').value));
   const {width,height}=grid;
   result=await convertVideo(file,{signal:controller.signal,width,height,fps:Number($('video-fps').value),
    brightness:Number($('video-brightness').value),contrast:Number($('video-contrast').value),
    fit:$('video-fit').value,positionX:Number($('crop-x').value)/100,positionY:Number($('crop-y').value)/100,
    onProgress:p=>{
     if(p.phase==='loading')return;
     const now=performance.now();if(now-last<150&&p.done!==p.total)return;last=now;
     $('tsl-progress').max=p.total;$('tsl-progress').value=p.done;
     $('converter-status').textContent='変換中 '+Math.floor(p.done/p.total*100)+'% · '+p.done.toLocaleString()+' / '+p.total.toLocaleString()+'画面';
     $('converter-detail').textContent=(p.plan.reduced?'長尺のため自動調整 · ':'')+p.plan.effectiveFps.toFixed(2)+' fps · 残り約'+Math.ceil(p.remaining)+'秒';
    }});
   downloadUrl=URL.createObjectURL(result.blob);
   const a=$('tsl-download');a.href=downloadUrl;a.download=tslName(file.name);
   $('tsl-result').hidden=false;
   $('converter-status').textContent='変換が完了しました';
   $('converter-detail').textContent=result.plan.width+' × '+result.plan.height+'文字 · '+result.plan.count.toLocaleString()+'画面 · '+result.plan.duration.toFixed(2)+'秒 · '+(result.blob.size/1024/1024).toFixed(2)+' MB'+(result.plan.reduced?' · 長尺のためフレームレートを自動調整':'');
  }catch(e){
   clearResult();$('converter-status').textContent=e.name==='AbortError'?'変換を中止しました':'変換できません: '+e.message;
   $('converter-detail').textContent='';$('tsl-progress').hidden=true;
  }finally{controller=null;busy(false);}
 }
 $('video-choose').onclick=()=>$('video-file').click();
 $('video-file').onchange=()=>{const file=$('video-file').files[0];$('video-file').value='';if(file)start(file);};
 $('convert-again').onclick=()=>{if(selected)start(selected);};
 $('cancel-tsl').onclick=()=>{controller?.abort();$('converter-status').textContent='中止しています…';};
 $('preview-tsl').onclick=async()=>{
  if(!result||isExporting())return;
  const file=new File([result.blob],tslName(selected.name),{type:'application/octet-stream'});
  show('player');await openPreview(file);
 };
 $('preview-tsl-full').onclick=async()=>{
  if(!result||isExporting())return;
  const file=new File([result.blob],tslName(selected.name),{type:'application/octet-stream'});
  show('player');enterImmersive();await openPreview(file);
 };
 function layoutHint(){
  const mode=$('video-mode').value,pc=mode==='pc98';
  $('pc-grid').hidden=!pc;$('portrait-grid').hidden=pc;
  const target=mode==='screen'?Math.min(screen.width,screen.height)/Math.max(screen.width,screen.height):9/16;
  const grid=pc?null:portraitGrid(target,Number($('video-columns').value));
  $('layout-hint').textContent=pc?'PC-98向けの文字数。TASL Ver.1.08実機での再生は未検証です。':
   grid.width+'列 × '+grid.height+'行を生成。縦画面TSLはWebプレーヤー向けで、PC-98 TASLの標準画面範囲を超えます。';
 }
 $('video-mode').onchange=()=>{$('video-fit').value=$('video-mode').value==='pc98'?'contain':'cover';layoutHint();};
 $('video-columns').onchange=layoutHint;layoutHint();
 const drop=$('video-drop');
 drop.addEventListener('dragover',e=>{e.preventDefault();if(!controller)drop.classList.add('dragover');});
 drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
 drop.addEventListener('drop',e=>{
  e.preventDefault();drop.classList.remove('dragover');
  if(e.dataTransfer.files.length!==1){if(!controller)$('converter-status').textContent='動画を1本ずつ選んでください';return;}
  start(e.dataTransfer.files[0]);
 });
 window.addEventListener('pagehide',()=>controller?.abort());
 busy(false);
}
