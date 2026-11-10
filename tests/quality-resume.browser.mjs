// Quality mode must restore its temporal glyph state across page reloads.
// Compare resumed output byte-for-byte with an uninterrupted full conversion.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';

const base=process.env.PLAYER_URL||'http://127.0.0.1:4199/';
const out=process.env.QUALITY_TEST_DIR||'/tmp/pc98-mode3-resume';
await mkdir(out,{recursive:true});
const path=join(out,'quality-resume-source.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-nostdin',
 '-f','lavfi','-i','testsrc=size=640x360:rate=10','-t','4',
 '-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',path]);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const fingerprint=b=>createHash('sha256').update(b).digest('hex');
async function session(){
 const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
 const page=await context.newPage();await page.goto(base);await page.click('#tab-converter');
 return {context,page};
}
async function configure(p){
 await p.selectOption('#video-mode','landscape');
 await p.selectOption('#video-style','quality');
 await p.selectOption('#video-fps','10');
}
async function completed(p){
 await p.waitForFunction(()=>/変換が完了しました|変換できません/.test(document.querySelector('#converter-status').textContent),null,{timeout:180000});
 assert.equal(await p.locator('#converter-status').textContent(),'変換が完了しました');
 const result=p.waitForEvent('download');await p.click('#tsl-download');
 const bytes=await readFile(await (await result).path());
 const decoded=parseTSL(new TextDecoder('shift_jis').decode(bytes));
 assert.equal(decoded.frames.length,40);
 return bytes;
}
try{
 const first=await session(),p=first.page;await configure(p);
 await p.setInputFiles('#video-file',path);await p.click('#convert-tsl');
 await p.waitForFunction(()=>{
  const message=document.querySelector('#converter-detail').textContent;
  const matched=message.match(/途中保存済み ([0-9,]+)画面/);
  const done=matched?Number(matched[1].replace(/,/g,'')):0;
  return done>=16&&done<40;
 },null,{timeout:120000});
 const job=await p.evaluate(async()=>(await import('/tsl-checkpoint.js')).readCheckpointSummary());
 console.log('mode3 saved state',job.done,'/',job.total);
 await p.reload();await p.click('#tab-converter');
 await p.setInputFiles('#video-file',path);
 await p.waitForFunction(()=>document.querySelector('#convert-tsl').textContent==='続きから再開',null,{timeout:20000});
 assert.equal(await p.locator('#video-style').inputValue(),'quality');
 await p.click('#convert-tsl');const resumed=await completed(p);
 const output=await session(),q=output.page;await configure(q);await q.setInputFiles('#video-file',path);
 await q.click('#convert-tsl');const fresh=await completed(q);
 assert.equal(fingerprint(resumed),fingerprint(fresh),'temporal quality state was not restored exactly');
 console.log('MODE3_RESUME_IDENTICAL',fingerprint(resumed),'bytes',fresh.length);
 await first.context.close();await output.context.close();
}catch(e){console.error(e.stack);process.exitCode=1;}finally{await browser.close();}
