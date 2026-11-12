// Click-to-run free, on-device luminance analysis + controls + TSL end-to-end.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';
const root=process.env.AUTO_TUNE_TEST_DIR||'/tmp/pc98-free-autotune-20261112';
const url=process.env.PLAYER_URL||'http://127.0.0.1:4283/';
await mkdir(root,{recursive:true});
const source=join(root,'autotune-source.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',
 '-f','lavfi','-i','testsrc2=size=640x360:rate=12:duration=4.5',
 '-vf','eq=brightness=-0.09:contrast=0.9',
 '-pix_fmt','yuv420p','-c:v','libx264','-preset','ultrafast',source]);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
 const errors=[],uploads=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))uploads.push(r.url());});
 await page.goto(url);
 await page.click('#tab-converter');
 assert.equal(await page.locator('#auto-tune').isDisabled(),true);
 await page.selectOption('#video-mode','landscape');
 await page.selectOption('#video-style','halftone');
 await page.setInputFiles('#video-file',source);
 assert.equal(await page.locator('#auto-tune').isDisabled(),false);
 await page.click('#auto-tune');
 await page.waitForFunction(()=>/場面を解析|解析できませんでした|濃淡が少なく/.test(document.querySelector('#auto-tune-status').textContent),null,{timeout:120000});
 const status=await page.locator('#auto-tune-status').textContent();
 assert.match(status,/場面を解析/,status);
 const vals=await page.evaluate(()=>['video-brightness','video-contrast','video-gamma'].map(id=>Number(document.getElementById(id).value)));
 assert.ok(vals[0]>=-100&&vals[0]<=100&&vals[1]>=.25&&vals[1]<=3&&vals[2]>=.4&&vals[2]<=2.5,JSON.stringify(vals));
 assert.equal(await page.locator('#convert-tsl').isDisabled(),false);
 assert.equal(await page.locator('#auto-tune').textContent(),'おまかせ設定（無料・端末内）');
 const initial=vals.slice();
 // Manual override remains possible: click auto only on user request.
 await page.locator('#video-brightness').fill('35');
 assert.equal(await page.locator('#video-brightness').inputValue(),'35');
 // Existing TSL workflow remains manual and functional.
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>/変換が完了しました|変換できません/.test(document.querySelector('#converter-status').textContent),null,{timeout:180000});
 assert.equal(await page.locator('#converter-status').textContent(),'変換が完了しました');
 const downloadEvent=page.waitForEvent('download');
 await page.click('#tsl-download');
 const download=await downloadEvent;
 const data=parseTSL(new TextDecoder('shift_jis').decode(await readFile(await download.path())));
 const chars=new Set([...data.frames.join('').replaceAll('\n','')]);
 assert.ok([...chars].every(x=>['　','・','○','＊','●'].includes(x)));
 // One more analysis using the existing Mode 1 and Mode 3 options.
 for(const mode of ['legacy','quality']){
  await page.selectOption('#video-style',mode);
  await page.click('#auto-tune');
  await page.waitForFunction(()=>/場面を解析|解析できませんでした|濃淡が少なく/.test(document.querySelector('#auto-tune-status').textContent),null,{timeout:120000});
  assert.match(await page.locator('#auto-tune-status').textContent(),/場面を解析/);
 }
 // Analysis cancel never overwrites a previously accepted manual value.
 const beforeCancel=await page.locator('#video-brightness').inputValue();
 await page.click('#auto-tune');
 await page.click('#auto-tune');
 await page.waitForFunction(()=>document.querySelector('#auto-tune-status').textContent.includes('解析を中止しました'),null,{timeout:20000});
 assert.equal(await page.locator('#video-brightness').inputValue(),beforeCancel);
 assert.equal(await page.locator('#convert-tsl').isDisabled(),false);
 // Each video stays local, even though this is an internet-facing PWA.
 assert.deepEqual(uploads,[]);
 assert.deepEqual(errors,[]);
 console.log('OFFLINE AUTO PARAMETER E2E PASS',JSON.stringify({url,mode2Suggestion:initial,status,frames:data.frames.length,chars:[...chars],mode1And3:true,uploads}));
}finally{await browser.close();}
