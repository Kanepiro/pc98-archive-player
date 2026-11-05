import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';
const url=process.env.PLAYER_URL||'http://127.0.0.1:4183/';
const out=process.env.RESULT_PATH||'verification/converter-local.json';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
const page=await context.newPage(),errors=[],uploads=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))uploads.push({url:r.url(),method:r.method()});});
const results={url,environment:'Linux Google Chrome, 390x844 mobile emulation; not Windows or Android hardware',checks:[],errors};
async function choose(path){
 await page.setInputFiles('#video-file',resolve('verification/private/'+path));
 assert.match(await page.locator('#converter-status').textContent(),/動画を選択しました/);
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>/完了|変換できません/.test(document.querySelector('#converter-status').textContent),{},{timeout:180000});
 assert.equal(await page.locator('#converter-status').textContent(),'変換が完了しました');
}
async function download(){
 const event=page.waitForEvent('download');await page.click('#tsl-download');const file=await event;
 const bytes=await readFile(await file.path());return {name:file.suggestedFilename(),data:parseTSL(new TextDecoder('shift_jis').decode(bytes)),bytes:bytes.length,buffer:bytes};
}
try{
 if(process.env.PREVIEW_ACCESS_FILE){await page.goto((await readFile(process.env.PREVIEW_ACCESS_FILE,'utf8')).trim());}
 await page.goto(url);await page.locator('#offline').filter({hasText:'準備済み'}).waitFor({timeout:30000});
 await page.click('#tab-converter');
 assert.equal(await page.locator('#converter-options').evaluate(x=>x.open),true);
 assert.equal(await page.locator('#convert-tsl').isDisabled(),true);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await choose('short.mp4');const short=await download();
 assert.equal(short.name,'short.TSL');assert.equal(short.data.width,75);assert.equal(short.data.height,67);assert.ok(short.data.frames.length>=20);assert.ok(Math.abs(short.data.duration-2.033)<1/60);
 results.short={frames:short.data.frames.length,duration:short.data.duration,bytes:short.bytes};
 results.ramp=await page.evaluate(async()=>{const m=await import('/video-to-tsl.js');return m.calibrateRamp();});
 await page.screenshot({path:'verification/private/converter-complete.png',fullPage:true});
 const imageData=await page.evaluate(async()=>{const m=await import('/tsl.js');const c=document.createElement('canvas');m.drawTSL(c,{width:79,height:27,frames:[''.padEnd(79,'#')]},0);return c.width;});assert.equal(imageData,948);
 await page.click('#preview-tsl');await page.screenshot({path:'verification/private/converted-preview.png',fullPage:true});await page.waitForFunction(()=>document.querySelector('#status').textContent==='再生が終了しました');
 assert.equal(await page.locator('#filename').textContent(),'short.TSL');
 assert.ok((await page.evaluate(()=>window.playerDiagnostics.frames))>1);
 results.checks.push('MP4 selection → manual convert button → download → existing player preview completes');
 const mp4Event=page.waitForEvent('download',{timeout:60000});await page.click('#export-mp4');const mp4=await mp4Event;
 assert.ok((await readFile(await mp4.path())).length>1000);
 results.checks.push('Generated TSL exports back to MP4 using existing exporter');
 await page.click('#tab-converter');
 await page.selectOption('#video-mode','pc98');
 await page.setInputFiles('#video-file',resolve('verification/private/long.mp4'));
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>document.querySelector('#converter-status').textContent.startsWith('変換中 '));
 await page.click('#cancel-tsl');await page.waitForFunction(()=>document.querySelector('#converter-status').textContent==='変換を中止しました');
 assert.equal(await page.locator('#tsl-result').isVisible(),false);
 results.checks.push('Cancel mid-conversion releases worker and hides incomplete result');
 await page.setInputFiles('#video-file',{name:'broken.mp4',mimeType:'video/mp4',buffer:Buffer.from('not an mp4')});
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>document.querySelector('#converter-status').textContent.startsWith('変換できません'));
 results.checks.push('Corrupt MP4 displays a recoverable error');
 await choose('350frames.mp4');const large=await download();
 assert.equal(large.data.frames.length,350);assert.ok(Math.abs(large.data.duration-35)<1e-8);
 results.over300={frames:large.data.frames.length,duration:large.data.duration};
 // Open the downloaded output through the original file input, not a second parser.
 await page.click('#tab-player');await page.setInputFiles('#file',{name:'350.TSL',mimeType:'application/octet-stream',buffer:large.buffer});
 await page.waitForFunction(()=>document.querySelector('#filename').textContent==='350.TSL');
 results.checks.push('350-screen TSL download reloads through original player');
 await page.click('#tab-converter');
 await page.selectOption('#video-fps','5');
 // 10 minutes at 5 fps = 3,000 screens; real decoding, not just a schedule simulation.
 const began=Date.now();await choose('long.mp4');const long=await download();
 assert.equal(long.data.frames.length,3000);assert.ok(Math.abs(long.data.duration-600)<1e-7);
 results.long={sourceSeconds:600,frames:long.data.frames.length,elapsedSeconds:(Date.now()-began)/1000,bytes:long.bytes};
 await choose('portrait.webm');const webm=await download();assert.ok(Math.abs(webm.data.duration-1)<1/60);
 results.checks.push('WebM VP9 decoding');
 await page.selectOption('#video-mode','screen');await choose('short.mp4');const tall=await download();
 assert.notEqual(tall.data.width,short.data.width);assert.ok(Math.abs(tall.data.width*.5/tall.data.height-390/844)<.005);
 await page.click('#preview-tsl-full');await page.waitForTimeout(2400);
 const box=await page.locator('#stage').boundingBox(),viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));
 assert.ok(box.width>=viewport.w*.99&&box.height>=viewport.h*.99);
 assert.equal(await page.locator('#screen').evaluate(c=>c.width/c.height),tall.data.width*.5/tall.data.height);
 await page.screenshot({path:'verification/private/portrait-fullscreen.png'});
 await page.locator('#stage').dispatchEvent('pointerdown');await page.click('#exit-immersive');
 assert.equal(await page.locator('#stage').evaluate(e=>e.classList.contains('immersive')),false);
 await page.click('#tab-converter');
 // Also exercise the mobile fallback where native fullscreen is unavailable.
 await page.evaluate(()=>{document.getElementById('stage').requestFullscreen=undefined;});
 await page.click('#preview-tsl-full');await page.waitForTimeout(2500);
 const fallback=await page.locator('#stage').boundingBox();assert.ok(fallback.height>=844*.99&&fallback.width>=390*.99);
 await page.screenshot({path:'verification/private/portrait-viewport.png'});
 await page.locator('#stage').dispatchEvent('pointerdown');await page.click('#exit-immersive');await page.click('#tab-converter');
 results.portrait={width:tall.data.width,height:tall.data.height,viewport,stage:box,aspectError:Math.abs(tall.data.width*.5/tall.data.height-390/844)};
 results.checks.push('9:16 and device-ratio TSL; native/fallback fullscreen uses shared canvas without glyph distortion');
 await context.setOffline(true);await page.reload();await page.click('#tab-converter');await choose('short.mp4');await download();
 results.checks.push('Offline reload, local MP4 conversion and download');await context.setOffline(false);
 await page.setViewportSize({width:1280,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 results.checks.push('Desktop width and mobile width fit without horizontal overflow');
 const dropFile=await readFile('verification/private/short.mp4');
 const transfer=await page.evaluateHandle(bytes=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(bytes)],'drop.mp4',{type:'video/mp4'}));return dt;},[...dropFile]);
 await page.dispatchEvent('#video-drop','drop',{dataTransfer:transfer});
 assert.match(await page.locator('#converter-status').textContent(),/動画を選択しました/);
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>document.querySelector('#converter-status').textContent==='変換が完了しました');
 assert.equal((await download()).name,'drop.TSL');await transfer.dispose();
 results.checks.push('Drag and drop selects without converting; convert button triggers conversion');
 assert.deepEqual(errors,[]);assert.deepEqual(uploads,[]);
 results.checks.push('No page errors and no upload requests');results.status='pass';
}catch(e){results.status='fail';results.failure=e.stack;process.exitCode=1;await page.screenshot({path:'verification/private/converter-failure.png',fullPage:true}).catch(()=>{});}
finally{await mkdir('verification',{recursive:true});await writeFile(out,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));await browser.close();}
