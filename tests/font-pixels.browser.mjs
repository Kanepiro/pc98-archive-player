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
 await page.locator('#panel-converter summary').click();
 assert.equal(await page.locator('#video-font-px').inputValue(),'20');
 for(const [px,columns,rows] of [[40,45,40],[20,90,80]]){
  await page.locator('#video-font-px').fill(String(px));
  assert.match(await page.locator('#layout-hint').textContent(),new RegExp(columns+'列 × '+rows+'行'));
  if(px===40)await page.setInputFiles('#video-file',sample);
  else await page.click('#convert-again');
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
  assert.equal(probe.streams[0].width,1080);
  assert.equal(probe.streams[0].height,1920);
  assert.equal(probe.streams[0].codec_name,'h264');
  assert.match(await page.locator('#status').textContent(),/1080×1920/);
  console.log(JSON.stringify({pixels:px,grid:columns+'x'+rows,
   mp4:probe.streams[0],output:mp4}));
  await page.click('#tab-converter');
 }
 await page.selectOption('#video-mode','pc98');
 assert.equal(await page.locator('#portrait-font-setting').isVisible(),false);
 assert.equal(await page.locator('#pc-grid').isVisible(),true);
 await page.selectOption('#video-mode','portrait');
 assert.equal(await page.locator('#portrait-font-setting').isVisible(),true);
 assert.deepEqual(errors,[]);
 console.log('Font-pixel converter + direct-render MP4 end-to-end: PASS');
}finally {await browser.close();}
