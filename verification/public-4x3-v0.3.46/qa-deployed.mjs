import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const work=import.meta.dirname,require=createRequire(path.join(work,'web/package.json')),{chromium}=require('@playwright/test');
const label=process.argv[2]||'preview',assetsOnly=process.argv.includes('--assets-only');
const access=label==='production'?{baseURL:'https://pc98-archive-player-seven.vercel.app'}:JSON.parse(await readFile(path.join(work,'preview-access.json'),'utf8'));
const base=access.baseURL,out=path.join(work,'qa',label);await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true}),page=await context.newPage(),errors=[],assets=[],rows=[];
page.on('pageerror',e=>errors.push(e.message));
async function files(dir,prefix=''){const list=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.isDirectory())list.push(...await files(path.join(dir,e.name),prefix+e.name+'/'));else list.push(prefix+e.name)}return list;}
async function input(){await page.evaluate(()=>{const i=document.createElement('input');i.type='file';i.id='remote-fixture';document.body.append(i)});await page.setInputFiles('#remote-fixture',path.join(work,'fixture.mp4'));}
async function convert(preset,mode){return page.evaluate(async({preset,mode})=>{
 const {convertVideo}=await import('/video-to-tsl.js'),{deleteCheckpoint}=await import('/tsl-checkpoint.js'),{presetGrid}=await import('/tsl-output-presets.js');await deleteCheckpoint();
 const file=document.querySelector('#remote-fixture').files[0],c=await convertVideo(file,{...presetGrid(preset),conversionMode:mode,fps:24,fit:'contain'});globalThis.remoteResult=c;
 return {hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await c.blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join(''),count:c.plan.count};
},{preset,mode});}
try{
 if(access.share)await page.goto(base+'/?_vercel_share='+encodeURIComponent(access.share));
 else await page.goto(base+'/mobile/');
 assert.match(await page.locator('header').innerText(),/0.3.46/);
 const names=await files(path.join(work,'web/dist'));let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<names.length){const name=names[next++],r=await context.request.get(base+'/'+name.split('/').map(encodeURIComponent).join('/'));assert(r.ok(),name+' HTTP '+r.status());const bytes=await r.body(),expected=await readFile(path.join(work,'web/dist',name));const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(bytes),sha(expected),'asset '+name);assets.push({name,bytes:bytes.length,sha256:sha(bytes)});}}));
 console.log(label+' '+assets.length+' asset hashes match local build');
 await page.goto(base+'/windows/');assert.match(await page.locator('header').innerText(),/0.3.46/);
 assert.equal(await page.locator('#windows-download').getAttribute('href'),'https://github.com/Kanepiro/pc98-archive-player/releases/download/windows-v0.3.46/TASL-PC-Boost-v0.3.46-Windows-x64.zip');
 await page.goto(base+'/mobile/');assert.match(await page.locator('header').innerText(),/0.3.46/);
 assert.deepEqual(await page.locator('#video-mode option').evaluateAll(es=>es.map(e=>e.value)),['portrait','portrait-3x4','landscape','landscape-4x3','screen','pc98']);
 assert.equal(await page.locator('#video-mode').inputValue(),'portrait');
 if(!assetsOnly){
  // No local input is loaded until all external network access is disabled.
  await page.evaluate(async()=>await navigator.serviceWorker.ready);
  await page.waitForFunction(()=>document.querySelector('#offline').textContent.includes('準備済み'),null,{timeout:90000});
  await context.setOffline(true);
  await page.reload();assert.match(await page.locator('header').innerText(),/0.3.46/);
  await input();
  for(const [preset,mode] of [['portrait-3x4','legacy'],['landscape-4x3','artisan']]){
   const result=await convert(preset,mode),expected=JSON.parse(await readFile(path.join(work,'qa/web',preset+'-'+mode+'.json'),'utf8')).summary;
   assert.equal(result.hash,expected.tslSHA256);
   const data=await page.evaluate(async()=>{const c=remoteResult;let resolution;const b=await(await import('/tsl-export-controller.js')).exportTslInWorker({kind:'TSL',bytes:await c.blob.arrayBuffer()},{sourceAudioFile:document.querySelector('#remote-fixture').files[0],onResolution:(w,h)=>resolution=[w,h]});return {bytes:Array.from(new Uint8Array(await b.arrayBuffer())),resolution};});
   assert.deepEqual(data.resolution,expected.resolution);await writeFile(path.join(out,preset+'-'+mode+'.mp4'),Buffer.from(data.bytes));rows.push({preset,mode,...result,resolution:data.resolution,networkOfflineBeforeInput:true});console.log(label+' '+preset+' '+mode+' conversion and MP4 PASS');
  }
  await page.evaluate(async()=>await navigator.serviceWorker.ready);await page.waitForFunction(()=>document.querySelector('#offline').textContent.includes('準備済み'),null,{timeout:90000});
  await context.setOffline(true);await page.reload();assert.match(await page.locator('header').innerText(),/0.3.46/);await input();
  for(const row of rows){const offline=await convert(row.preset,row.mode);assert.equal(offline.hash,row.hash);row.offlineIdentical=true;}
 }
 await page.click('#tab-converter');await page.selectOption('#video-mode','landscape-4x3');await page.screenshot({path:path.join(out,'mobile-v0.3.46.png'),fullPage:true});
 assert.deepEqual(errors,[]);await writeFile(path.join(out,assetsOnly?'assets.json':'summary.json'),JSON.stringify({pass:true,baseURL:base,assets,rows,errors,browserVersion:browser.version()},null,2));console.log(label+' verification PASS');
}finally{await browser.close();}
