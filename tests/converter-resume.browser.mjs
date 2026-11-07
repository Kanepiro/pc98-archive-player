// Browser regression: closing a PWA page must not lose committed TSL frames.
// Run after generating verification/private/resume.mp4 and starting the dev server.
import {chromium} from '@playwright/test';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
const path=resolve('verification/private/resume.mp4'),url=process.env.PLAYER_URL||'http://127.0.0.1:4184/';
const errors=[];
async function newSession(){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.click('#tab-converter');return {context,page};
}
async function download(page){
 const event=page.waitForEvent('download');await page.click('#tsl-download');
 const item=await event;return readFile(await item.path());
}
async function finish(page){
 await page.waitForFunction(()=>/変換が完了しました|変換できません/.test(document.querySelector('#converter-status').textContent),{},{timeout:180000});
 const status=await page.locator('#converter-status').textContent();
 assert.equal(status,'変換が完了しました');
 const bytes=await download(page),parsed=parseTSL(new TextDecoder('shift_jis').decode(bytes));
 assert.equal(parsed.frames.length,200);return bytes;
}
try{
 const first=await newSession(),page=first.page;
 await page.selectOption('#video-mode','pc98');
 await page.setInputFiles('#video-file',path);
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>{
  const m=document.querySelector('#converter-detail').textContent.match(/途中保存済み (\d+)画面/);
  return m&&Number(m[1])>=16&&Number(m[1])<200;
 },null,{timeout:90000});
 const checkpoint=await page.evaluate(async()=>(await import('/tsl-checkpoint.js')).readCheckpointSummary());
 console.log('Saved before reload',checkpoint.done,'/',checkpoint.total);
 assert.ok(checkpoint.done>0&&checkpoint.done<checkpoint.total);
 await page.reload();await page.click('#tab-converter');
 await page.waitForFunction(()=>document.querySelector('#converter-status').textContent.includes('途中保存あり'));
 await page.setInputFiles('#video-file',{name:'resume.mp4',mimeType:'video/mp4',buffer:await readFile(path)});
 await page.waitForFunction(()=>document.querySelector('#convert-tsl').textContent==='続きから再開');
 assert.equal(await page.locator('#video-mode').inputValue(),'pc98','original conversion mode must be restored');
 assert.match(await page.locator('#converter-status').textContent(),/保存済み/);
 await page.click('#convert-tsl');const resumed=await finish(page);
 assert.equal((await page.evaluate(async()=>(await import('/tsl-checkpoint.js')).readCheckpointSummary())).done,200);
 await page.reload();await page.click('#tab-converter');
 await page.setInputFiles('#video-file',path);
 await page.waitForFunction(()=>document.querySelector('#convert-tsl').textContent==='結果を復元');
 await page.click('#convert-tsl');
 const recovered=await finish(page);
 assert.deepEqual(recovered,resumed,'completed output should be recoverable after reload');
 await first.context.close();
 const second=await newSession();
 await second.page.selectOption('#video-mode','pc98');
 await second.page.setInputFiles('#video-file',path);
 await second.page.click('#convert-tsl');
 const uninterrupted=await finish(second.page);
 const hash=x=>createHash('sha256').update(x).digest('hex');
 assert.equal(hash(resumed),hash(uninterrupted),'resumed output must be byte-for-byte identical');
 await second.context.close();
 assert.deepEqual(errors,[]);
 console.log('PASS: reload + reselect resumes at stored frames; 200-screen TSL identical to uninterrupted conversion.');
}finally{await browser.close();}
