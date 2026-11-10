// Full workflow: prove the MP4 worker can be aborted without freezing the UI,
// then encode and decode a multi-second (no audio) H.264 TSL file.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import {makePlan,TSLWriter} from '../public/tsl-converter-core.js';
import assert from 'node:assert/strict';
const base=process.env.PLAYER_URL||'http://127.0.0.1:4197/';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
const longPlan=makePlan(110,{width:128,height:36,fps:10}),longWriter=new TSLWriter(longPlan);
const chars=' .:|/(%YVO8D@0#$';
for(let i=0;i<longPlan.count;i++){
 const frame=Array.from({length:36},(_,y)=>Array.from({length:128},(_,x)=>chars[(x*3+y*11+i*7)%chars.length]).join('')).join('\r\n')+'\r\n';
 longWriter.append(frame);
}
const shortPlan=makePlan(16,{width:128,height:36,fps:10}),shortWriter=new TSLWriter(shortPlan);
for(let i=0;i<shortPlan.count;i++){
 const frame=Array.from({length:36},(_,y)=>Array.from({length:128},(_,x)=>chars[(x*3+y*11+i*7)%chars.length]).join('')).join('\r\n')+'\r\n';
 shortWriter.append(frame);
}
const long=new Uint8Array(await longWriter.finish().arrayBuffer()),short=new Uint8Array(await shortWriter.finish().arrayBuffer());
const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base);
 await page.setInputFiles('#file',{name:'long-110s.TSL',mimeType:'application/octet-stream',buffer:Buffer.from(long)});
 await page.waitForFunction(()=>document.querySelector('#filename').textContent==='long-110s.TSL');
 await page.evaluate(()=>{window.__heartbeats=0;window.__heartbeatTimer=setInterval(()=>window.__heartbeats++,100);});
 await page.click('#export-mp4');
 await page.locator('#cancel-mp4').waitFor({state:'visible',timeout:5000});
 await page.waitForTimeout(1000);
 const before=await page.evaluate(()=>window.__heartbeats);
 assert.ok(before>=5,'main thread unresponsive while exporting: '+before);
 const start=Date.now();await page.click('#cancel-mp4');
 await page.waitForFunction(()=>document.querySelector('#status').textContent==='MP4変換を中止しました',null,{timeout:5000});
 const cancelMs=Date.now()-start;
 assert.ok(cancelMs<5000,'could not interrupt worker');
 console.log(JSON.stringify({longFrames:longPlan.count,uiHeartbeat:before,cancelMs}));
 await page.setInputFiles('#file',{name:'short-16s.TSL',mimeType:'application/octet-stream',buffer:Buffer.from(short)});
 await page.waitForFunction(()=>document.querySelector('#filename').textContent==='short-16s.TSL');
 const download=page.waitForEvent('download',{timeout:100000});await page.click('#export-mp4');
 const item=await download;await mkdir('/tmp/pc98-mp4-fix-longtest',{recursive:true});
 const output='/tmp/pc98-mp4-fix-longtest/short-16s.mp4';await item.saveAs(output);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-show_entries','stream=codec_name,width,height','-of','json',output],{encoding:'utf8'}));
 assert.equal(probe.streams[0].codec_name,'h264');
 assert.ok(probe.format.duration>=15.9,'truncated export');
 assert.deepEqual(errors,[]);
 console.log('WORKER UI + CANCEL + 16S MP4 PASS',JSON.stringify(probe));
}catch(e){console.error('FAILED',e.stack);process.exitCode=1;}
finally{await page.evaluate(()=>clearInterval(window.__heartbeatTimer)).catch(()=>{});await context.close();await browser.close();}
