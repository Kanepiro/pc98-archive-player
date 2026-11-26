import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '@playwright/test';

// Run against a local Web build or an isolated Windows release host.
const url=new URL(process.env.PLAYER_URL||'http://127.0.0.1:4173/');
assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
const scratch=await mkdtemp(join(tmpdir(),'tasl-public-qa-'));
const profile=join(scratch,'profile'),video=join(scratch,'tone.mp4');
const ffmpeg=spawnSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','testsrc2=size=192x112:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.7','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video],{encoding:'utf8'});
assert.equal(ffmpeg.status,0,ffmpeg.stderr);
const errors=[],outputs=[],mp4Starts=[];
let context,page;
async function launch(){
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_PATH||undefined,
  acceptDownloads:true,viewport:{width:390,height:844}});
 page=context.pages()[0];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('worker',worker=>{if(worker.url().includes('tsl-export-worker'))mp4Starts.push(worker.url());});
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/mp4/jobs')mp4Starts.push(r.url());});
 page.on('download',download=>outputs.push(download.suggestedFilename()));
 await page.goto(url.href);
 await page.click('#tab-converter');
}
async function select(){
 await page.setInputFiles('#video-file',video);
 await page.waitForFunction(()=>document.querySelector('#video-name').textContent.includes('192×112'));
}
async function tslOnly(){
 const before=mp4Starts.length,downloads=outputs.length;
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>document.querySelector('#converter-status').textContent==='変換が完了しました',null,{timeout:120000});
 assert.equal(await page.locator('#direct-mp4-download').isVisible(),false);
 assert.equal(mp4Starts.length,before);
 assert.equal(outputs.length,downloads);
}
try{
 await launch();
 assert.equal(await page.locator('#video-direct-mp4').isChecked(),false);
 for(const width of [320,390,640,1280]){
  await page.setViewportSize({width,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await select();
 await page.selectOption('#video-mode','pc98');
 await tslOnly();
 // Simulate form restoration without a user toggle. Exercise the real start button.
 await page.evaluate(()=>{document.querySelector('#video-direct-mp4').checked=true;});
 await tslOnly();
 assert.equal(await page.locator('#video-direct-mp4').isChecked(),false);
 await page.check('#video-direct-mp4');
 await page.uncheck('#video-direct-mp4');
 await tslOnly();
 await page.check('#video-direct-mp4');
 const downloadPromise=page.waitForEvent('download',{timeout:180000});
 await page.click('#convert-tsl');
 const download=await downloadPromise;
 const mp4=join(scratch,'output.mp4');await download.saveAs(mp4);
 assert.ok((await readFile(mp4)).length>1024);
 assert.ok(mp4Starts.length>0);
 const probe=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_name,profile,pix_fmt','-of','json',mp4],{encoding:'utf8'});
 assert.equal(probe.status,0,probe.stderr);
 const tracks=JSON.parse(probe.stdout).streams;
 assert.ok(tracks.some(t=>t.codec_name==='h264'&&t.pix_fmt==='yuv420p'));
 assert.ok(tracks.some(t=>t.codec_name==='aac'&&t.profile==='LC'));
 assert.equal(spawnSync('ffmpeg',['-v','error','-xerror','-i',mp4,'-f','null','-']).status,0);
 assert.equal(await page.locator('#video-direct-mp4').isChecked(),false);
 await tslOnly();
 await page.check('#video-direct-mp4');
 const seed=await page.evaluate(async()=>{
  const cp=await import('/tsl-checkpoint.js');
  const job=await cp.readCheckpointSummary();
  const db=await new Promise((ok,fail)=>{const r=indexedDB.open('pc98-tsl-checkpoint-v1',2);r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});
  try{
   const tx=db.transaction('job','readwrite');
   job.config['video-direct-mp4']='true';
   tx.objectStore('job').put(job);
   await new Promise((ok,fail)=>{tx.oncomplete=ok;tx.onabort=()=>fail(tx.error);});
  }finally{db.close();}
  localStorage.setItem('video-direct-mp4','true');
  return job.done;
 });
 assert.ok(seed>0);
 await page.reload();await page.click('#tab-converter');
 assert.equal(await page.locator('#video-direct-mp4').isChecked(),false);
 await select();await page.getByRole('button',{name:'結果を復元',exact:true}).waitFor();
 await tslOnly();
 await page.check('#video-direct-mp4');
 await page.goto(new URL('/windows/index.html',url).href);
 await page.goBack();
 if(!await page.locator('#panel-converter').isVisible())await page.click('#tab-converter');
 assert.equal(await page.locator('#video-direct-mp4').isChecked(),false);
 await page.check('#video-direct-mp4');
 await context.close();context=null;
 await launch();
 assert.equal(await page.locator('#video-direct-mp4').isChecked(),false);
 await select();await page.getByRole('button',{name:'結果を復元',exact:true}).waitFor();
 await tslOnly();
 await page.click('#tab-player');
 await page.click('#demo');
 await page.waitForFunction(()=>!document.querySelector('#play').disabled);
 await page.setInputFiles('#file',{name:'invalid.tsl',mimeType:'application/octet-stream',buffer:Buffer.from('invalid')});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('再生できません'));
 assert.equal(await page.locator('#filename').innerText(),'ファイル未選択');
 assert.equal(await page.locator('#empty').isVisible(),true);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,browser:context.browser().version(),url:url.href,restoredFrames:seed,mp4Starts:mp4Starts.length,downloads:outputs,tracks}));
}finally{
 await context?.close();
 await rm(scratch,{recursive:true,force:true,maxRetries:4});
}
