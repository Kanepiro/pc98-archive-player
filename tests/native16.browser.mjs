import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';

const url=process.env.PLAYER_URL||'http://127.0.0.1:4283/';
const out=process.env.NATIVE16_TEST_DIR||'/tmp/pc98-native16-menu-qc';
await mkdir(out,{recursive:true});
const source=join(out,'native16-source.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-nostdin',
 '-f','lavfi','-i','testsrc2=size=640x360:rate=10:duration=1.6',
 '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1.6',
 '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-shortest',source]);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(url);await page.click('#tab-converter');
 assert.equal(await page.locator('#video-font-render').inputValue(),'legacy');
 assert.equal(await page.locator('#video-font-px').inputValue(),'24');
 // On mobile, switching draw mode must NOT move any other form controls.
 const layoutPositions=()=>page.evaluate(()=>{
  const labels=['video-font-render','video-font-setting','video-mode','video-fps',
    'video-fit','crop-x','crop-y','video-brightness','video-contrast','video-gamma','video-edge'];
  return Object.fromEntries(labels.map(id=>{
   const element=document.getElementById(id);
   const rect=(element.closest('label')||element).getBoundingClientRect();
   return [id,{left:Math.round(rect.left),top:Math.round(rect.top),
     width:Math.round(rect.width),height:Math.round(rect.height)}];
  }));
 });
 // The two columns must form matching pairs, including native rendering.
 const assertPairedRows=async()=>{
  const pairs=[
   ['video-style','video-mode'],
   ['video-font-render','video-font-px'],
   ['video-fps','video-fit'],
   ['crop-x','crop-y'],
   ['video-brightness','video-contrast'],
   ['video-gamma','video-edge']
  ];
  const positions=await page.evaluate(pairs=>Object.fromEntries(
   pairs.flat().map(id=>{
    const element=document.getElementById(id);
    const box=(element.closest('label')||element).getBoundingClientRect();
    return[id,{top:Math.round(box.top),left:Math.round(box.left)}];
   })),pairs);
  for(const [left,right] of pairs){
   assert.equal(positions[left].top,positions[right].top,
    left+' and '+right+' must start on same row');
   assert.ok(positions[left].left<positions[right].left,
    left+' and '+right+' must remain in left and right columns');
  }
 };
 await assertPairedRows();
 const layoutBefore=await layoutPositions();
 await page.selectOption('#video-font-render','native16');
 await assertPairedRows();
 const layoutAfter=await layoutPositions();
 assert.deepEqual(layoutAfter,layoutBefore,'Switching to native16 must not reflow the converter grid');
 assert.equal(await page.locator('#video-font-px').isDisabled(),true);
 assert.equal(await page.locator('#video-font-px').inputValue(),'24','User-entered pixel size is retained');
 await page.selectOption('#video-font-render','legacy');
 assert.deepEqual(await layoutPositions(),layoutBefore,'Switching back must keep layout fixed');
 assert.equal(await page.locator('#video-font-px').isEnabled(),true);
 
 assert.match(await page.locator('#video-font-render option').allTextContents().then(x=>x.join(' ')),/16×16ドット（PC-98実寸）/);
 await page.selectOption('#video-mode','landscape');
 await page.locator('#video-font-px').fill('16');
 assert.match(await page.locator('#layout-hint').textContent(),/160列 × 45行/);
 assert.equal(await page.locator('#video-font-setting').isVisible(),true,'existing px font size input stays visible');
 await page.selectOption('#video-font-render','native16');
 assert.match(await page.locator('#layout-hint').textContent(),/240列 × 67行/);
 assert.equal(await page.locator('#video-font-setting').isVisible(),true,'font-size grid slot stays visible in native mode');
 assert.equal(await page.locator('#video-font-px').isDisabled(),true,'unused px value is disabled');
 await page.selectOption('#video-mode','portrait');
 assert.match(await page.locator('#layout-hint').textContent(),/135列 × 120行/);
 await page.selectOption('#video-mode','landscape');
 await page.selectOption('#video-style','halftone');
 await page.selectOption('#video-fps','10');
 await page.setInputFiles('#video-file',source);
 await page.locator('#video-direct-mp4').check();
 const [mp4Download]=await Promise.all([
   page.waitForEvent('download',{timeout:180000}),
   (async()=>{await page.click('#convert-tsl');await page.waitForFunction(()=>/音声付きMP4の保存準備が完了しました|変換できません|作成に失敗/.test(document.querySelector('#converter-status').textContent),null,{timeout:180000});})()
 ]);
 assert.equal(await page.locator('#converter-status').textContent(),'音声付きMP4の保存準備が完了しました');
 const mp4path=join(out,'native16-with-audio.mp4');await mp4Download.saveAs(mp4path);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,codec_type,width,height,duration','-show_entries','format=duration','-of','json',mp4path],{encoding:'utf8'}));
 const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
 assert.deepEqual({w:video.width,h:video.height,codec:video.codec_name},{w:1920,h:1080,codec:'h264'});
 assert.equal(audio.codec_name,'aac');
 const tslDownload=page.waitForEvent('download',{timeout:30000});
 await page.click('#tsl-download');
 const tslFile=await tslDownload;
 const bytes=await readFile(await tslFile.path()),tsl=parseTSL(new TextDecoder('shift_jis').decode(bytes));
 assert.equal(tsl.width,240);assert.equal(tsl.height,67);assert.equal(tsl.native16,true);
 assert.ok(tsl.frames.length>=15);
 await page.click('#preview-tsl');
 await page.waitForFunction(()=>document.querySelector('#filename').textContent.endsWith('_Mode2.TSL'),null,{timeout:12000});
 const player=await page.locator('#screen').evaluate(c=>({width:c.width,height:c.height}));
 assert.deepEqual(player,{width:1920,height:1072});
 const glyphs=await page.evaluate(async()=>{
  const {drawTSL}=await import('/tsl.js');
  const native=document.createElement('canvas'),legacy=document.createElement('canvas');
  drawTSL(native,{width:2,height:1,native16:true,frames:['◎']},0);
  drawTSL(legacy,{width:2,height:1,native16:false,frames:['◎']},0);
  const half=document.createElement('canvas');
  drawTSL(half,{width:1,height:1,native16:true,frames:['A']},0);
  return {native:[native.width,native.height],old:[legacy.width,legacy.height],half:[half.width,half.height]};
 });
 assert.deepEqual(glyphs,{native:[16,16],old:[24,24],half:[8,16]});
 // Existing 16px numerical control MUST still produce old 160x45 cell grid.
 await page.click('#tab-converter');
 await page.locator('#video-direct-mp4').uncheck();
 await page.selectOption('#video-font-render','legacy');
 assert.equal(await page.locator('#video-font-px').inputValue(),'16');
 assert.match(await page.locator('#layout-hint').textContent(),/160列 × 45行/);
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>/変換が完了しました|変換できません/.test(document.querySelector('#converter-status').textContent),null,{timeout:120000});
 assert.equal(await page.locator('#converter-status').textContent(),'変換が完了しました');
 const dl=page.waitForEvent('download',{timeout:30000});await page.click('#tsl-download');
 const oldFile=await dl,old=parseTSL(new TextDecoder('shift_jis').decode(await readFile(await oldFile.path())));
 assert.deepEqual({width:old.width,height:old.height,native16:old.native16},{width:160,height:45,native16:false});
 assert.deepEqual(errors,[]);
 console.log('EXPLICIT 16x16 MENU E2E PASS',JSON.stringify({production:url,nativeTSL:{width:tsl.width,height:tsl.height,frames:tsl.frames.length,bytes:bytes.length},preview:player,glyphs,mp4:video,audio:audio.codec_name,legacy16px:{w:old.width,h:old.height},errors}));
}finally{await browser.close();}
