import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';

const url=process.env.PLAYER_URL||'http://127.0.0.1:4187/';
const out=process.env.QUALITY_TEST_DIR||'/tmp/pc98-font-px-qc';
await mkdir(out,{recursive:true});
const sample=join(out,'font-px-short.mp4');
// A short animated fixture makes the end-to-end test reproducible.
execFileSync('ffmpeg',['-y','-nostdin','-hide_banner','-loglevel','error',
  '-f','lavfi','-i','testsrc2=size=320x568:rate=10','-t','1.5','-an',
  '-c:v','libx264','-preset','ultrafast','-crf','23','-pix_fmt','yuv420p',sample]);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);
 await page.click('#tab-converter');
 assert.equal(await page.locator('#converter-options').evaluate(x=>x.open),true);
 assert.equal(await page.locator('#convert-tsl').isDisabled(),true);
 assert.equal(await page.locator('header').getByText('v0.3.2').isVisible(),true);
 assert.equal(await page.locator('#video-font-px').inputValue(),'24');
 for(const [px,columns,rows,expectedW,expectedH] of [[256,7,6,1080,1852],[128,14,12,1080,1852],[40,45,40,1080,1920],[24,75,67,1074,1920],[20,90,80,1080,1920]]){
  await page.locator('#video-font-px').fill(String(px));
  assert.match(await page.locator('#layout-hint').textContent(),new RegExp(columns+'列 × '+rows+'行'));
  if(px===256){
   const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.click('#video-choose')]);
   await chooser.setFiles(sample);
   assert.equal(await page.locator('#convert-tsl').isEnabled(),true);
   assert.equal(await page.locator('#tsl-result').isVisible(),false);
   assert.equal(await page.locator('#tsl-progress').isVisible(),false);
   assert.match(await page.locator('#converter-status').textContent(),/動画を選択しました/);
  }
  await page.click('#convert-tsl');
  await page.waitForFunction(()=>/変換が完了しました|変換できません/.test(document.getElementById('converter-status').textContent),{},{timeout:90000});
  assert.equal(await page.locator('#converter-status').textContent(),'変換が完了しました');
  const [tslDownload]=await Promise.all([page.waitForEvent('download'),page.click('#tsl-download')]);
  const bytes=await readFile(await tslDownload.path());
  const parsed=parseTSL(new TextDecoder('shift_jis').decode(bytes));
  assert.equal(parsed.width,columns);
  assert.equal(parsed.height,rows);
  assert.ok(parsed.frames.length>=10);
  await page.click('#preview-tsl');
  await page.waitForFunction(()=>document.querySelector('#filename').textContent==='font-px-short.TSL');
  const [mp4Download]=await Promise.all([
   page.waitForEvent('download',{timeout:90000}),page.click('#export-mp4')
  ]);
  const mp4=join(out,'font-'+px+'px.mp4');await mp4Download.saveAs(mp4);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0',
   '-show_entries','stream=width,height,codec_name','-of','json',mp4],{encoding:'utf8'}));
  assert.equal(probe.streams[0].width,expectedW);
  assert.equal(probe.streams[0].height,expectedH);
  assert.equal(probe.streams[0].codec_name,'h264');
  assert.match(await page.locator('#status').textContent(),new RegExp(expectedW+'×'+expectedH));
  console.log(JSON.stringify({pixels:px,grid:columns+'x'+rows,
   mp4:probe.streams[0],output:mp4}));
  await page.click('#tab-converter');
 }
 // Selecting a replacement must invalidate the old result without autostarting.
 await page.setInputFiles('#video-file',sample);
 assert.match(await page.locator('#converter-status').textContent(),/動画を選択しました/);
 assert.equal(await page.locator('#tsl-result').isVisible(),false);
 assert.equal(await page.locator('#tsl-progress').isVisible(),false);
 assert.equal(await page.locator('#convert-tsl').isEnabled(),true);
 // Drag-and-drop must also only select, never begin conversion.
 const fileBytes=await readFile(sample);
 const transfer=await page.evaluateHandle(bytes=>{
  const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],'dropped.mp4',{type:'video/mp4'}));return data;
 },[...fileBytes]);
 await page.dispatchEvent('#video-drop','drop',{dataTransfer:transfer});
 assert.match(await page.locator('#converter-status').textContent(),/動画を選択しました/);
 assert.equal(await page.locator('#tsl-result').isVisible(),false);
 assert.match(await page.locator('#video-name').textContent(),/dropped.mp4/);
 await transfer.dispose();
 await page.screenshot({path:join(out,'mobile-ui-selection.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.selectOption('#video-mode','pc98');
 assert.equal(await page.locator('#portrait-font-setting').isVisible(),false);
 assert.equal(await page.locator('#pc-grid').isVisible(),true);
 await page.selectOption('#video-mode','portrait');
 assert.equal(await page.locator('#portrait-font-setting').isVisible(),true);
 assert.deepEqual(errors,[]);
 console.log('Font-pixel converter + direct-render MP4 end-to-end: PASS');
}finally {await browser.close();}
