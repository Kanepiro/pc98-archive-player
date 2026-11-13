import {convertVideo} from './video-to-tsl.js';
import {analyzeVideoTone} from './tsl-auto-settings.js';
import {tslName,portraitGridForPixels,landscapeGridForPixels,native16PortraitGrid,native16LandscapeGrid} from './tsl-converter-core.js';
import {fileIdentity,readCheckpointSummary} from './tsl-checkpoint.js';
import {exportTslInWorker} from './tsl-export-controller.js';
export function setupConverter({openPreview,stopPlayback,isExporting,enterImmersive}) {
 const $=id=>document.getElementById(id);
 // A deliberate setting change takes precedence over a saved checkpoint.
 // Automatic restores do not emit input/change events.
 $('converter-settings').addEventListener('input',()=>{userAdjustedSettings=true;});
 $('converter-settings').addEventListener('change',()=>{userAdjustedSettings=true;});
 let controller=null,tuningController=null,result=null,downloadUrl=null,directMp4Url=null,selected=null,selectSerial=0,userAdjustedSettings=false;
 let ordinaryPixelValue='24',lastStyle=$('video-style').value;
 const compatibleCheckpoint=job=>{
  const native16=job?.config?.['video-font-render']==='native16';
  const mode=job?.config?.['video-style'];
  return mode!=='outline'&&job?.engineVersion===(mode==='artisan'?19:mode==='quality'?(native16?8:7):mode==='halftone'?(native16?13:12):(native16?3:2));
 };
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
  for(const id of ['video-file','video-choose','converter-settings','video-direct-mp4'])$(id).disabled=value;
  $('convert-tsl').disabled=value||!selected;
  $('cancel-tsl').hidden=!controller;
  $('auto-tune').disabled=!!controller||(!tuningController&&!selected);
  $('auto-tune').textContent=tuningController?'解析を中止':'おまかせ設定（無料・端末内）';
  $('preview-tsl').disabled=value||!result;
  $('preview-tsl-full').disabled=value||!result;
 }
 function clearResult(){
  result=null;$('tsl-result').hidden=true;
  if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;
  if(directMp4Url)URL.revokeObjectURL(directMp4Url);directMp4Url=null;$('direct-mp4-download').hidden=true;
 }
 function converterConfig(){
  return Object.fromEntries(['video-mode','video-style','video-font-render','video-font-px','video-size','video-fps','video-fit','crop-x','crop-y','video-brightness','video-contrast','video-gamma','video-edge'].map(id=>[id,$(id).value]));
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
  const native16=$('video-font-render').value==='native16';
  const pixels=Number($('video-font-px').value);
  if(mode==='landscape')return native16?native16LandscapeGrid():landscapeGridForPixels(pixels);
  const aspect=mode==='screen'?Math.min(screen.width,screen.height)/Math.max(screen.width,screen.height):9/16;
  return native16?native16PortraitGrid(aspect):portraitGridForPixels(aspect,pixels);
 }
 function selectFile(file){
  if(!file||controller||tuningController||isExporting())return;
  selected=file;clearResult();const serial=++selectSerial;
  $('video-name').textContent='選択した動画：'+file.name;
  $('convert-tsl').textContent='変換';
  $('tsl-progress').hidden=true;
  $('converter-status').textContent='動画を選択しました。設定を確認して「変換」を押してください。';
  $('converter-detail').textContent='';
  $('auto-tune-status').textContent='動画の数場面から明るさ・コントラスト・ガンマを簡易推定します。精度は保証されません。';
  busy(false);
  readCheckpointSummary().then(job=>{
   if(serial!==selectSerial||selected!==file||controller||!job||job.identity!==fileIdentity(file)||!job.done||!compatibleCheckpoint(job))return;
   if(userAdjustedSettings||tuningController)return; // Never overwrite a user choice or an in-progress analysis.
   restoreConfig(job.config);
   $('convert-tsl').textContent=job.done===job.total?'結果を復元':'続きから再開';
   $('converter-status').textContent='動画を選択しました。保存済み '+job.done.toLocaleString()+' / '+job.total.toLocaleString()+'画面から再開できます。';
   $('converter-detail').textContent='動画ファイルは再選択が必要です。変換設定は保存時の値へ戻しました。';
  }).catch(()=>{});
 }
 async function start(){
  if(controller||tuningController||isExporting()||!selected)return;
  const file=selected,checkpointConfig=converterConfig(),directMP4=$('video-direct-mp4').checked;
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
    conversionMode:$('video-style').value,native16:$('video-font-render').value==='native16',
    fit:$('video-fit').value,positionX:Number($('crop-x').value)/100,positionY:Number($('crop-y').value)/100,
    checkpointConfig,
    onCheckpointIssue:()=>{$('converter-detail').textContent='端末に途中保存できません。変換は続行しますが、閉じると再開できない場合があります。';},
    onProgress:p=>{
     if(p.phase==='loading')return;
     if(p.phase==='vision'){
      $('converter-status').textContent='モード4：'+p.message;
      return;
     }
     if(p.phase==='atlas'){
      $('converter-status').textContent='モード4：272文字の字形を解析中… '+p.done.toLocaleString()+' / '+p.total.toLocaleString();
      $('converter-detail').textContent='指定された272文字と余白を描画しています。変換前に一度だけ実行します。';
      return;
     }
     if(p.phase==='resumed'){
      $('tsl-progress').max=p.total;$('tsl-progress').value=p.done;
      $('converter-status').textContent='保存済み '+p.done.toLocaleString()+'画面から再開します…';return;
     }
     const now=performance.now();if(now-last<150&&p.done!==p.total)return;last=now;
     $('tsl-progress').max=p.total;$('tsl-progress').value=p.done;
     $('converter-status').textContent='変換中 '+Math.floor(p.done/p.total*100)+'% · '+p.done.toLocaleString()+' / '+p.total.toLocaleString()+'画面';
     $('converter-detail').textContent=(p.plan.reduced?'長尺のため自動調整 · ':'')+p.plan.effectiveFps.toFixed(2)+' fps · '+(p.acceleration==='WebGPU'?'WebGPU使用':p.acceleration==='CPU（GPU精度照合）'?'CPU処理（GPUとの精度差）':'CPU処理')+' · 残り約'+Math.ceil(p.remaining)+'秒 · 途中保存済み '+p.saved.toLocaleString()+'画面';
    }});
   downloadUrl=URL.createObjectURL(result.blob);
   const a=$('tsl-download');a.href=downloadUrl;a.download=tslName(file.name,result.plan.conversionMode);
   $('tsl-result').hidden=false;
   $('converter-status').textContent=directMP4?'TSL完成。元音声付きMP4を作成中…':'変換が完了しました';
   $('converter-detail').textContent=result.plan.width+' × '+result.plan.height+'文字'+(result.plan.native16?' · 全角16×16ドット（半角8×16）':(mode==='pc98'?'':' · 約'+Number($('video-font-px').value)+'px'))+' · '+result.plan.count.toLocaleString()+'画面 · '+result.plan.duration.toFixed(2)+'秒 · '+(result.blob.size/1024/1024).toFixed(2)+' MB'+(result.plan.reduced?' · 長尺のためフレームレートを自動調整':'');
   if(directMP4){
    if(result.plan.duration>300)throw Error('音声付きMP4は5分以内の動画に対応しています（TSLは保存可能）');
    const bytes=await result.blob.arrayBuffer();
    const started=performance.now();
    const mp4=await exportTslInWorker({kind:'TSL',bytes},{
     signal:controller.signal,sourceAudioFile:file,
     onRetry:()=>{$('converter-status').textContent='高解像度のMP4書き出しが止まったためHDで再試行中…';},
     onStage:stage=>{$('converter-status').textContent=stage==='reading'?'TSLをMP4用に読み込み中…':
       stage==='audio-reading'?'元動画の音声を確認中…':
       stage==='audio-encoding'?'元音声と映像を合成中…':'TSL映像をエンコード中…';},
     onResolution:(w,h)=>{$('converter-detail').textContent='MP4解像度 '+w+'×'+h+' · TSL '+result.plan.count.toLocaleString()+'画面';},
     onProgress:(seconds,total)=>{
      const t=Math.floor(seconds);
      if(t!==last){last=t;$('converter-status').textContent='音声付きMP4変換中 '+Math.round(seconds/total*100)+'% · '+t+' / '+Math.ceil(total)+'秒';}
     }
    });
    if(controller.signal.aborted)throw new DOMException('変換を中止しました','AbortError');
    directMp4Url=URL.createObjectURL(mp4);
    const filename=file.name.replace(/\.(mp4|m4v|webm)$/i,'')+'_TASL_音声付き.mp4';
    const link=$('direct-mp4-download');link.href=directMp4Url;link.download=filename;link.hidden=false;
    const a=document.createElement('a');a.href=directMp4Url;a.download=filename;document.body.append(a);a.click();a.remove();
    $('converter-status').textContent='音声付きMP4の保存準備が完了しました';
    $('converter-detail').textContent=filename+' · '+(mp4.size/1024/1024).toFixed(1)+' MB · '+Math.round((performance.now()-started)/1000)+'秒でMP4処理完了';
   }
  }catch(e){
   const hasTSL=!!result;
   if(!hasTSL)clearResult();
   $('converter-status').textContent=e.name==='AbortError'?'変換を中止しました':(hasTSL?'TSLは完成しましたが、MP4作成に失敗: ':'変換できません: ')+e.message;
   if(!hasTSL)$('converter-detail').textContent='';$('tsl-progress').hidden=true;
  }finally{controller=null;busy(false);$('convert-tsl').textContent='変換';}
 }
 async function runAutoTune(){
  if(tuningController){tuningController.abort();return;}
  if(controller||isExporting()||!selected)return;
  const file=selected,serial=selectSerial,tune=new AbortController();
  tuningController=tune;busy(true);
  $('auto-tune-status').textContent='動画を端末内で読み込んでいます…';
  try{
   const {width,height}=selectedGrid();
   const recommended=await analyzeVideoTone(file,{
    mode:$('video-style').value,width,height,fit:$('video-fit').value,
    positionX:Number($('crop-x').value)/100,positionY:Number($('crop-y').value)/100,
    signal:tune.signal,
    onProgress:(done,total)=>{$('auto-tune-status').textContent='無料の簡易解析中 '+done+' / '+total+' 場面（端末内のみ）';}
   });
   if(tune.signal.aborted||file!==selected||serial!==selectSerial)return;
   if(recommended.limited){
    $('auto-tune-status').textContent='映像の濃淡が少なく、適切な提案を計算できませんでした。設定は変更していません。';
    return;
   }
   $('video-brightness').value=String(recommended.brightness);
   $('video-contrast').value=String(recommended.contrast);
   $('video-gamma').value=String(recommended.gamma);
   userAdjustedSettings=true;
   $('auto-tune-status').textContent=recommended.scenes+'場面を解析 · 明るさ '+(recommended.brightness>=0?'+':'')+recommended.brightness+' / コントラスト '+recommended.contrast.toFixed(2)+' / ガンマ '+recommended.gamma.toFixed(2)+'。お好みで微調整できます。';
   $('converter-status').textContent='おすすめの画質設定を入力しました。「変換」を押すと開始します。';
  }catch(e){
   $('auto-tune-status').textContent=e.name==='AbortError'?'解析を中止しました。設定は変更していません。':'自動解析できませんでした：'+e.message;
  }finally{tuningController=null;busy(false);}
 }
 $('auto-tune').onclick=runAutoTune;
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
  const quality=$('video-style').value==='quality',halftone=$('video-style').value==='halftone',artisan=$('video-style').value==='artisan';
  $('tone-edge').hidden=quality||halftone||artisan;
  const native16=$('video-font-render').value==='native16';
  // Keep the second grid column occupied for both font rendering choices.
  // Hiding this label made every subsequent converter setting jump up a row.
  $('pc-grid').hidden=!pc;$('video-font-setting').hidden=pc;
  $('video-font-px').disabled=native16;
  if(pc){$('layout-hint').textContent=(native16?'PC-98実寸：全角16×16／半角8×16ドット。':'既存表示：半角12×24／全角24×24ドット。')+'文字数は選択したグリッドを使用。TASL Ver.1.08実機での再生は未検証です。';return;}
  try{
   const pixels=Number($('video-font-px').value),grid=selectedGrid();
   const note=(mode==='landscape'?'横16:9・文字は回転しません。':'縦画面の文字アニメです。')+(artisan?'モード4：顔・人物・動物の認識と主輪郭抽出、全画面・複数行のAA組版。272文字＋余白のみ。初回はAI認識用データを読み込みます。':quality?'モード3：XDoG・線追跡・字形照合と時間方向の安定化で映像を文字化。':halftone?'モード2：空白・句点「。」・「ｏ」「○」「◎」の5階調で網点風に変換。':'モード1：従来の濃淡変換。');
   $('layout-hint').textContent=native16
    ?`PC-98実寸：全角16×16ドット／半角8×16ドット → ${grid.width}列 × ${grid.height}行。フルHDで等倍描画または最近傍拡大。${note}実機のROM書体そのものではありません。`
    :`文字サイズ約${pixels}px → ${grid.width}列 × ${grid.height}行で生成（フルHD換算）。${note}Webプレーヤー向けです。`;
  }catch(e){$('layout-hint').textContent=e.message;}
 }
 $('video-mode').onchange=()=>{$('video-fit').value=$('video-mode').value==='pc98'?'contain':'cover';layoutHint();};
 $('video-style').onchange=()=>{
  if($('video-style').value==='artisan'){
   ordinaryPixelValue=$('video-font-px').value;
   $('video-font-render').value='legacy';
   if($('video-mode').value==='pc98')$('video-mode').value='landscape';
   $('video-font-px').value='96';
  }else if(lastStyle==='artisan')$('video-font-px').value=ordinaryPixelValue;
  lastStyle=$('video-style').value;
  layoutHint();
 };
 $('video-font-px').oninput=layoutHint;
 $('video-font-render').onchange=layoutHint;layoutHint();
 const drop=$('video-drop');
 drop.addEventListener('dragover',e=>{e.preventDefault();if(!controller)drop.classList.add('dragover');});
 drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
 drop.addEventListener('drop',e=>{
  e.preventDefault();drop.classList.remove('dragover');
  if(e.dataTransfer.files.length!==1){if(!controller)$('converter-status').textContent='動画を1本ずつ選んでください';return;}
  selectFile(e.dataTransfer.files[0]);
 });
 readCheckpointSummary().then(job=>{
  if(!selected&&!controller&&job?.done>0&&compatibleCheckpoint(job)){
   $('converter-status').textContent='途中保存あり：'+job.done.toLocaleString()+' / '+job.total.toLocaleString()+'画面。同じ動画を選ぶと続きから再開できます。';
  }
 }).catch(()=>{});
 busy(false);
}
