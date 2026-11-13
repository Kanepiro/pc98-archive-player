// PC-98 grid is computed from actual decoded video dimensions, not a preset.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';
const root=process.env.PC98_AUTO_GRID_TEST_DIR||'/tmp/tasl-pc98-source-grid-e2e';
const url=process.env.PLAYER_URL||'http://127.0.0.1:4488/';
await mkdir(root,{recursive:true});
const examples=[[640,400,40,25,80],[1280,720,80,45,160],
 [1920,1080,120,67,240]];
const sources=[];
for(const [width,height] of examples){
 const path=join(root,'source-'+width+'x'+height+'.mp4');
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-nostdin',
  '-f','lavfi','-i','testsrc2=size='+width+'x'+height+':rate=2:duration=0.5',
  '-c:v','libx264','-preset','ultrafast','-crf','32','-pix_fmt','yuv420p',path]);
 sources.push(path);
}
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',
 args:['--no-sandbox']});
try{
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:420,height:880}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);
 await page.click('#tab-converter');
 await page.selectOption('#video-mode','pc98');
 await page.selectOption('#video-style','halftone');
 assert.equal(await page.locator('#video-font-render').inputValue(),'native16');
 assert.equal(await page.locator('#video-font-render').isDisabled(),true);
 assert.equal(await page.locator('#video-size').count(),0,'fixed grid presets must be removed');
 for(let i=0;i<examples.length;i++){
  const [w,h,fullwidth,rows,cols]=examples[i];
  await page.setInputFiles('#video-file',sources[i]);
  await page.waitForFunction(([w,h,fullwidth,rows])=>{
   const text=document.getElementById('layout-hint').textContent;
   return text.includes('元動画 '+w+'×'+h+'px')&&
    text.includes('全角'+fullwidth+'×'+rows+'文字相当');
  },[w,h,fullwidth,rows],{timeout:30000});
  const hint=await page.locator('#layout-hint').textContent();
  assert.ok(hint.includes('半角'+cols+'×'+rows+'列'),hint);
  assert.equal(await page.locator('#auto-tune').isEnabled(),true);
  assert.equal(await page.locator('#convert-tsl').isEnabled(),true);
  if(i===0){
   await page.click('#auto-tune');
   await page.waitForFunction(()=>/場面を解析|濃淡が少なく|解析できませんでした/.test(
    document.querySelector('#auto-tune-status').textContent),null,{timeout:120000});
   assert.match(await page.locator('#auto-tune-status').textContent(),/場面を解析/);
  }
  await page.selectOption('#video-fps','5');
  await page.click('#convert-tsl');
  await page.waitForFunction(()=>/変換が完了しました|変換できません/.test(
   document.getElementById('converter-status').textContent),null,{timeout:180000});
  const status=await page.locator('#converter-status').textContent();
  assert.equal(status,'変換が完了しました',w+'x'+h+': '+status);
  const download=page.waitForEvent('download');
  await page.click('#tsl-download');
  const file=await download;
  const tsl=parseTSL(new TextDecoder('shift_jis').decode(await readFile(await file.path())));
  assert.deepEqual([tsl.width,tsl.height,tsl.native16],[cols,rows,true]);
  assert.ok(tsl.frames.length>=1);
  const detail=await page.locator('#converter-detail').textContent();
  assert.ok(detail.includes('全角'+fullwidth+'×'+rows),detail);
  console.log('PC98_SOURCE_GRID_PASS',JSON.stringify({
   source:[w,h],displayFullwidth:[fullwidth,rows],tslHalfwidth:[cols,rows],
   native16:tsl.native16,frames:tsl.frames.length
  }));
 }
 // Mode 4 must honor the same source-sized grid rather than silently
 // switching the user's PC-98 mode back to 16:9 presets.
 await page.selectOption('#video-style','artisan');
 assert.equal(await page.locator('#video-mode').inputValue(),'pc98');
 assert.equal(await page.locator('#video-font-render').inputValue(),'native16');
 await page.setInputFiles('#video-file',sources[0]);
 await page.waitForFunction(()=>document.getElementById('layout-hint').textContent.includes('全角40×25文字相当'));
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>/変換が完了しました|変換できません/.test(
  document.getElementById('converter-status').textContent),null,{timeout:180000});
 assert.equal(await page.locator('#converter-status').textContent(),'変換が完了しました');
 const aaDownload=page.waitForEvent('download');await page.click('#tsl-download');
 const aaFile=await aaDownload;
 const aa=parseTSL(new TextDecoder('shift_jis').decode(await readFile(await aaFile.path())));
 assert.deepEqual([aa.width,aa.height,aa.native16],[80,25,true]);
 console.log('PC98_MODE4_AUTO_GRID_PASS',JSON.stringify({grid:[aa.width,aa.height],
  fullwidth:[40,25],frames:aa.frames.length}));
 await page.selectOption('#video-mode','landscape');
 assert.equal(await page.locator('#video-font-render').isEnabled(),true);
 await page.selectOption('#video-font-render','legacy');
 assert.equal(await page.locator('#video-font-px').isEnabled(),true);
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
