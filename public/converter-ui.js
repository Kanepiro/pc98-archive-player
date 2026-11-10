import {convertVideo} from './video-to-tsl.js';
import {tslName,portraitGridForPixels,landscapeGridForPixels} from './tsl-converter-core.js';
import {fileIdentity,readCheckpointSummary} from './tsl-checkpoint.js';
export function setupConverter({openPreview,stopPlayback,isExporting,enterImmersive}) {
 const $=id=>document.getElementById(id);
 let controller=null,result=null,downloadUrl=null,selected=null,selectSerial=0;
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
  for(const id of ['video-file','video-choose','converter-settings'])$(id).disabled=value;
  $('convert-tsl').disabled=value||!selected;
  $('cancel-tsl').hidden=!value;
  $('preview-tsl').disabled=value||!result;
  $('preview-tsl-full').disabled=value||!result;
 }
 function clearResult(){
  result=null;$('tsl-result').hidden=true;
  if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;
 }
 function converterConfig(){
  return Object.fromEntries(['video-mode','video-style','video-font-px','video-size','video-fps','video-fit','crop-x','crop-y','video-brightness','video-contrast','video-gamma','video-edge','video-outline-threshold'].map(id=>[id,$(id).value]));
 }
 function restoreConfig(config){
  for(const [id,value] of Object.entries(config||{}))if($(id)&&typeof value==='string')$(id).value=value;
  layoutHint();
 }
 function selectedGrid(){
  const mode=$('video-mode').value;
  if(mode==='pc98'){
   const [width,height]=$('video-size').value.split('x').map(Number);
   return {width,height};
  }
  const pixels=Number($('video-font-px').value);
  if(mode==='landscape')return landscapeGridForPixels(pixels);
  const aspect=mode==='screen'?Math.min(screen.width,screen.height)/Math.max(screen.width,screen.height):9/16;
  return portraitGridForPixels(aspect,pixels);
 }
 function selectFile(file){
  if(!file||controller||isExporting())return;
  selected=file;clearResult();const serial=++selectSerial;
  $('video-name').textContent='選択した動画：'+file.name;
  $('convert-tsl').textContent='変換';
  $('tsl-progress').hidden=true;
  $('converter-status').textContent='動画を選択しました。設定を確認して「変換」を押してください。';
  $('converter-detail').textContent='';
  busy(false);
  readCheckpointSummary().then(job=>{
   if(serial!==selectSerial||selected!==file||controller||!job||job.identity!==fileIdentity(file)||!job.done)return;
   restoreConfig(job.config);
   $('convert-tsl').textContent=job.done===job.total?'結果を復元':'続きから再開';
   $('converter-status').textContent='動画を選択しました。保存済み '+job.done.toLocaleString()+' / '+job.total.toLocaleString()+'画面から再開できます。';
   $('converter-detail').textContent='動画ファイルは再選択が必要です。変換設定は保存時の値へ戻しました。';
  }).catch(()=>{});
 }
 async function start(){
  if(controller||isExporting()||!selected)return;
  const file=selected,checkpointConfig=converterConfig();
  clearResult();controller=new AbortController();busy(true);
  $('tsl-progress').removeAttribute('value');$('tsl-progress').hidden=false;
  $('converter-status').textContent='動画を読み込み中…';$('converter-detail').textContent='';
  let last=0;
  try{
   const mode=$('video-mode').value;
   const grid=selectedGrid();
   const {width,height}=grid;
   result=await convertVideo(file,{signal:controller.signal,width,height,fps:Number($('video-fps').value),
    brightness:Number($('video-brightness').value),contrast:Number($('video-contrast').value),
    gamma:Number($('video-gamma').value),edge:Number($('video-edge').value),
    conversionMode:$('video-style').value,outlineThreshold:Number($('video-outline-threshold').value),
    fit:$('video-fit').value,positionX:Number($('crop-x').value)/100,positionY:Number($('crop-y').value)/100,
    checkpointConfig,
    onCheckpointIssue:()=>{$('converter-detail').textContent='端末に途中保存できません。変換は続行しますが、閉じると再開できない場合があります。';},
    onProgress:p=>{
     if(p.phase==='loading')return;
     if(p.phase==='resumed'){
      $('tsl-progress').max=p.total;$('tsl-progress').value=p.done;
      $('converter-status').textContent='保存済み '+p.done.toLocaleString()+'画面から再開します…';return;
     }
     const now=performance.now();if(now-last<150&&p.done!==p.total)return;last=now;
     $('tsl-progress').max=p.total;$('tsl-progress').value=p.done;
     $('converter-status').textContent='変換中 '+Math.floor(p.done/p.total*100)+'% · '+p.done.toLocaleString()+' / '+p.total.toLocaleString()+'画面';
     $('converter-detail').textContent=(p.plan.reduced?'長尺のため自動調整 · ':'')+p.plan.effectiveFps.toFixed(2)+' fps · 残り約'+Math.ceil(p.remaining)+'秒 · 途中保存済み '+p.saved.toLocaleString()+'画面';
    }});
   downloadUrl=URL.createObjectURL(result.blob);
   const a=$('tsl-download');a.href=downloadUrl;a.download=tslName(file.name,result.plan.conversionMode);
   $('tsl-result').hidden=false;
   $('converter-status').textContent='変換が完了しました';
   $('converter-detail').textContent=result.plan.width+' × '+result.plan.height+'文字'+(mode==='pc98'?'':' · 約'+Number($('video-font-px').value)+'px')+' · '+result.plan.count.toLocaleString()+'画面 · '+result.plan.duration.toFixed(2)+'秒 · '+(result.blob.size/1024/1024).toFixed(2)+' MB'+(result.plan.reduced?' · 長尺のためフレームレートを自動調整':'');
  }catch(e){
   clearResult();$('converter-status').textContent=e.name==='AbortError'?'変換を中止しました':'変換できません: '+e.message;
   $('converter-detail').textContent='';$('tsl-progress').hidden=true;
  }finally{controller=null;busy(false);$('convert-tsl').textContent='変換';}
 }
 $('video-choose').onclick=()=>$('video-file').click();
 $('video-file').onchange=()=>{const file=$('video-file').files[0];$('video-file').value='';selectFile(file);};
 $('convert-tsl').onclick=start;
 $('cancel-tsl').onclick=()=>{controller?.abort();$('converter-status').textContent='中止しています…';};
 $('preview-tsl').onclick=async()=>{
  if(!result||isExporting())return;
  const file=new File([result.blob],tslName(selected.name,result.plan.conversionMode),{type:'application/octet-stream'});
  show('player');await openPreview(file);
 };
 $('preview-tsl-full').onclick=async()=>{
  if(!result||isExporting())return;
  const file=new File([result.blob],tslName(selected.name,result.plan.conversionMode),{type:'application/octet-stream'});
  show('player');enterImmersive();await openPreview(file);
 };
 function layoutHint(){
  const mode=$('video-mode').value,pc=mode==='pc98';
  const contour=$('video-style').value==='outline';
  for(const id of ['tone-brightness','tone-contrast','tone-gamma','tone-edge'])$(id).hidden=contour;
  $('outline-threshold-setting').hidden=!contour;
  $('pc-grid').hidden=!pc;$('video-font-setting').hidden=pc;
  if(pc){$('layout-hint').textContent='PC-98向けの文字数は固定です。TASL Ver.1.08実機での再生は未検証です。';return;}
  try{
   const pixels=Number($('video-font-px').value),grid=selectedGrid();
   const note=(mode==='landscape'?'横16:9・文字は回転しません。':'縦画面の文字アニメです。')+(contour?'モード2：全角記号の輪郭だけ表示し、ベタ塗りは空白。':'モード1：従来の濃淡変換。');
   $('layout-hint').textContent=`文字サイズ約${pixels}px → ${grid.width}列 × ${grid.height}行で生成（フルHD換算）。${note}PC-98実機互換ではなく、Webプレーヤー向けです。`;
  }catch(e){$('layout-hint').textContent=e.message;}
 }
 $('video-mode').onchange=()=>{$('video-fit').value=$('video-mode').value==='pc98'?'contain':'cover';layoutHint();};
 $('video-style').onchange=layoutHint;
 $('video-font-px').oninput=layoutHint;layoutHint();
 const drop=$('video-drop');
 drop.addEventListener('dragover',e=>{e.preventDefault();if(!controller)drop.classList.add('dragover');});
 drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
 drop.addEventListener('drop',e=>{
  e.preventDefault();drop.classList.remove('dragover');
  if(e.dataTransfer.files.length!==1){if(!controller)$('converter-status').textContent='動画を1本ずつ選んでください';return;}
  selectFile(e.dataTransfer.files[0]);
 });
 readCheckpointSummary().then(job=>{
  if(!selected&&!controller&&job?.done>0){
   $('converter-status').textContent='途中保存あり：'+job.done.toLocaleString()+' / '+job.total.toLocaleString()+'画面。同じ動画を選ぶと続きから再開できます。';
  }
 }).catch(()=>{});
 busy(false);
}
