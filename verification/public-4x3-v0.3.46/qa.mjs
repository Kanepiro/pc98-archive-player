import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const work=import.meta.dirname,require=createRequire(path.join(work,'web/package.json'));
const {chromium}=require('@playwright/test');
const platform=process.argv[2],phase=process.argv[3]||'new',native=platform==='windows';
const base=native?'http://127.0.0.1:39460':'http://127.0.0.1:39462';
const old=native?'http://127.0.0.1:39461':'http://127.0.0.1:39463';
const out=path.join(work,'qa',platform);await mkdir(out,{recursive:true});
const input=path.join(work,'fixture.mp4'),errors=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox','--no-first-run']});
const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900},serviceWorkers:'block'});
async function pageAt(url){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);return p;}
async function fixture(p){await p.evaluate(()=>{const i=document.createElement('input');i.type='file';i.id='qa-file';document.body.append(i)});await p.setInputFiles('#qa-file',input);}
async function save(name,data){await writeFile(path.join(out,name+'.json'),JSON.stringify(data,null,2));console.log(platform+' '+name+' PASS',data.summary||'');}
async function prior(name){try{return JSON.parse(await readFile(path.join(out,name+'.json'),'utf8')).pass===true;}catch{return false;}}
async function pixels(p,bytes){return p.evaluate(async bytes=>{
 const {parseTSL,drawTSL}=await import('/tsl.js');const d=parseTSL(new TextDecoder('shift_jis').decode(Uint8Array.from(bytes)));
 await(await import('/tasl-font.js')).ensureTaslFont();if(d.mode4Cell60)await(await import('/tsl-mode4-grid60.js')).ensureMode4Atlas();
 const frames=[0,Math.floor(d.frames.length/2),d.frames.length-1],hashes=[];
 for(const frame of frames){const c=document.createElement('canvas');drawTSL(c,d,frame);hashes.push({frame,width:c.width,height:c.height,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,c.width,c.height).data)),v=>v.toString(16).padStart(2,'0')).join('')});}
 return {hashes,schedule:d.schedule,frames:d.frames.length,width:d.width,height:d.height,output:[d.outputWidth,d.outputHeight]};
},bytes);}
async function exportBrowser(p,bytes,name,audio=false){const r=await p.evaluate(async({bytes,audio})=>{
 const {exportTslInWorker}=await import('/tsl-export-controller.js');let resolution,retries=0;
 const blob=await exportTslInWorker({kind:'TSL',bytes:Uint8Array.from(bytes).buffer},{sourceAudioFile:audio?document.querySelector('#qa-file').files[0]:null,onResolution:(w,h)=>resolution=[w,h],onRetry:()=>retries++});
 return {bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),resolution,retries};
},{bytes,audio});await writeFile(path.join(out,name+'.mp4'),Buffer.from(r.bytes));delete r.bytes;return r;}
async function runConversion(p,preset,mode,native16=false){return p.evaluate(async({preset,mode,native,native16})=>{
 const {convertVideo}=await import('/video-to-tsl.js'),{deleteCheckpoint}=await import('/tsl-checkpoint.js'),core=await import('/tsl-converter-core.js');
 await deleteCheckpoint();const file=document.querySelector('#qa-file').files[0];
 let g,fit=preset==='pc98'?'contain':'cover';
 if(['portrait-3x4','landscape-4x3'].includes(preset)){g=(await import('/tsl-output-presets.js')).presetGrid(preset,24,native16);fit='contain';}
 else g=preset==='landscape'?core.landscapeGridForPixels(24):core.portraitGridForPixels(preset==='screen'?Math.min(screen.width,screen.height)/Math.max(screen.width,screen.height):9/16,24);
 const backends=new Set(),start=performance.now();
 const c=await convertVideo(file,{...g,conversionMode:mode,fps:24,native16,sourceGrid:preset==='pc98',fit,exactNative:native,onProgress:p=>{if(p.acceleration)backends.add(p.acceleration)}});
 globalThis.qaConverted=c;
 return {bytes:Array.from(new Uint8Array(await c.blob.arrayBuffer())),plan:c.plan,seconds:(performance.now()-start)/1000,backends:[...backends]};
},{preset,mode,native,native16});}
async function exportConverted(p,bytes,name){
 if(!native)return exportBrowser(p,bytes,name,true);
 const result=await p.evaluate(async()=>{const c=qaConverted;const e=await(await import('/pc-boost.js')).exportFaithfulNativeMp4({file:document.querySelector('#qa-file').files[0],tslBlob:c.blob,plan:c.plan,source:c.source});return {...e,report:await(await fetch(e.reportUrl)).json()};});
 await writeFile(path.join(out,name+'.mp4'),Buffer.from(await(await fetch(base+result.url)).arrayBuffer()));return result;
}
try{
 if(phase==='new')for(const preset of ['portrait-3x4','landscape-4x3'])for(const mode of ['legacy','halftone','quality','artisan']){
  const name=preset+'-'+mode;if(await prior(name)){console.log('Already verified '+name);continue;}
  console.log('START '+platform+' '+name);
  const p=await pageAt(base);await p.evaluate(async()=>await(await import('/tsl-checkpoint.js')).deleteCheckpoint());
  assert.equal(await p.locator('#video-mode').inputValue(),'portrait');
  assert.deepEqual(await p.locator('#video-mode option').evaluateAll(es=>es.map(e=>e.value)),['portrait','portrait-3x4','landscape','landscape-4x3','screen','pc98']);
  await p.click('#tab-converter');await p.selectOption('#video-mode',preset);await p.selectOption('#video-style',mode);await p.selectOption('#video-fps','24');
  assert.equal(await p.locator('#video-fit').inputValue(),'contain');assert.ok(await p.locator('#video-fit').isEnabled());
  await p.setInputFiles('#video-file',input);await p.check('#video-direct-mp4');
  const download=p.waitForEvent('download',{timeout:600000});await p.click('#convert-tsl');
  await p.waitForFunction(()=>/音声付きMP4の保存準備が完了|変換できません|失敗/.test(document.querySelector('#converter-status').textContent),null,{timeout:600000});
  assert.match(await p.locator('#converter-status').textContent(),/音声付きMP4の保存準備が完了/);
  await(await download).saveAs(path.join(out,name+'.mp4'));
  const data=await p.evaluate(async()=>({bytes:Array.from(new Uint8Array(await(await fetch(document.querySelector('#tsl-download').href)).arrayBuffer())),metrics:document.querySelector('#gpu-metrics-download')?.hidden===false?await(await fetch(document.querySelector('#gpu-metrics-download').href)).json():null}));
  const bytes=data.bytes,tsl=Buffer.from(bytes);await writeFile(path.join(out,name+'.tsl'),tsl);
  const expected=preset==='portrait-3x4'?[1080,1440]:[1440,1080],paint=await pixels(p,bytes);
  assert.deepEqual(paint.output,expected);assert.equal(paint.width*.5/paint.height,expected[0]/expected[1]);
  if(mode==='artisan')assert.deepEqual([paint.width/2,paint.height],preset==='portrait-3x4'?[18,24]:[24,18]);
  await p.click('#preview-tsl');await p.waitForFunction(()=>document.querySelector('#kind').textContent==='TSL');
  const preview=await p.locator('#screen').evaluate(c=>({width:c.width,height:c.height}));assert.equal(preview.width/preview.height,expected[0]/expected[1]);
  await p.screenshot({path:path.join(out,name+'.png')});
  await p.reload();await p.click('#tab-converter');await p.setInputFiles('#video-file',input);
  await p.waitForFunction(()=>document.querySelector('#convert-tsl').textContent==='結果を復元',null,{timeout:30000});
  assert.equal(await p.locator('#video-mode').inputValue(),preset);assert.equal(await p.locator('#video-style').inputValue(),mode);assert.equal(await p.locator('#video-fps').inputValue(),'24');assert.equal(await p.locator('#video-fit').inputValue(),'contain');
  await fixture(p);
  const resume=await p.evaluate(async({preset,mode,native})=>{
   const {convertVideo}=await import('/video-to-tsl.js'),{deleteCheckpoint}=await import('/tsl-checkpoint.js'),{presetGrid,outputPreset}=await import('/tsl-output-presets.js'),{mode4Grid}=await import('/tsl-mode4-grid60.js');
   const file=document.querySelector('#qa-file').files[0],o=outputPreset(preset),g=mode==='artisan'?{...mode4Grid(o.outputWidth,o.outputHeight),...o}:presetGrid(preset);
   const config=Object.fromEntries(['video-mode','video-style','video-font-render','video-font-px','video-fps','video-fit','crop-x','crop-y','video-brightness','video-contrast','video-gamma','video-edge'].map(id=>[id,document.getElementById(id).value]));
   const issues=[],settings={...g,conversionMode:mode,native16:false,fps:24,fit:'contain',exactNative:native,checkpointConfig:config,onCheckpointIssue:e=>issues.push(String(e))};
   const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
   let completedFrom=null;const completed=await convertVideo(file,{...settings,onProgress:p=>{if(p.phase==='resumed')completedFrom=p.done;}});
   await deleteCheckpoint();const controller=new AbortController();let aborted=false;
   try{await convertVideo(file,{...settings,signal:controller.signal,onProgress:p=>{if(p.phase==='converting'&&p.done===17)controller.abort();}});}catch(e){if(e.name!=='AbortError')throw e;aborted=true;}
   let resumedFrom=null;const resumed=await convertVideo(file,{...settings,onProgress:p=>{if(p.phase==='resumed')resumedFrom=p.done;}});
   return {aborted,resumedFrom,completedFrom,completedHash:await digest(completed.blob),resumedHash:await digest(resumed.blob),issues};
  },{preset,mode,native});
  assert.equal(resume.completedHash,hash(tsl));assert.equal(resume.resumedHash,hash(tsl));assert.equal(resume.completedFrom,paint.frames);assert.equal(resume.resumedFrom,16);assert(resume.aborted);assert.deepEqual(resume.issues,[]);
  // A freshly reloaded TSL is exported independently of the conversion result.
  await p.setInputFiles('#file',path.join(out,name+'.tsl'));await p.waitForFunction(()=>!document.querySelector('#play').disabled);
  const exported=await exportBrowser(p,bytes,name+'-reopened');assert.deepEqual(exported.resolution,expected);assert.equal(exported.retries,0);
  const negative=await p.evaluate(async bytes=>{const data=(await import('/tsl.js')).parseTSL(new TextDecoder('shift_jis').decode(Uint8Array.from(bytes)));try{await(await import('/mp4-export.js')).exportMP4({kind:'TSL',data},{tslMaxPixels:1280*720});return null;}catch(e){return e.message;}},bytes);assert.match(negative,/指定解像度/);
  const op=await pageAt(old),oldPaint=await pixels(op,bytes);await op.close();assert.deepEqual(oldPaint.hashes,paint.hashes);assert.deepEqual(oldPaint.schedule,paint.schedule);
  await save(name,{pass:true,summary:{preset,mode,frames:paint.frames,grid:[paint.width,paint.height],resolution:expected,tslSHA256:hash(tsl)},paint,resume,exported,settingsReload:true,download:true,oldPlayerPixelsIdentical:true,strictResolutionError:negative,metrics:data.metrics});await p.close();
 }
 if(phase==='regression')for(const preset of ['portrait','landscape','screen','pc98'])for(const mode of ['legacy','halftone','quality','artisan']){
  const name='regression-'+preset+'-'+mode;if(await prior(name)){console.log('Already verified '+name);continue;}
  const pair=[];
  for(const [label,url] of [['baseline',old],['candidate',base]]){
   console.log('START '+platform+' '+name+' '+label);const p=await pageAt(url);await fixture(p);
   const r=await runConversion(p,preset,mode),bytes=r.bytes;delete r.bytes;
   await writeFile(path.join(out,name+'-'+label+'.tsl'),Buffer.from(bytes));
   const paint=await pixels(p,bytes);
   // Native result URLs are relative to the page's own server.
   let exported;
   if(native){const e=await p.evaluate(async()=>{const c=qaConverted,e=await(await import('/pc-boost.js')).exportFaithfulNativeMp4({file:document.querySelector('#qa-file').files[0],tslBlob:c.blob,plan:c.plan,source:c.source});return {...e,report:await(await fetch(e.reportUrl)).json()};});await writeFile(path.join(out,name+'-'+label+'.mp4'),Buffer.from(await(await fetch(url+e.url)).arrayBuffer()));exported=e;}
   else exported=await exportBrowser(p,bytes,name+'-'+label,true);
   pair.push({label,hash:hash(Buffer.from(bytes)),...r,paint,exported});await p.close();
  }
  assert.equal(pair[0].hash,pair[1].hash,name+' TSL changed');assert.deepEqual(pair[0].paint,pair[1].paint,name+' preview changed');
  await save(name,{pass:true,summary:{preset,mode,tslIdentical:true,previewIdentical:true},pair});
 }
 if(phase==='native16')for(const preset of ['portrait-3x4','landscape-4x3'])for(const mode of ['legacy','halftone','quality']){
  const name='native16-'+preset+'-'+mode;if(await prior(name))continue;
  const p=await pageAt(base);await fixture(p);const r=await runConversion(p,preset,mode,true),bytes=r.bytes;delete r.bytes;
  await writeFile(path.join(out,name+'.tsl'),Buffer.from(bytes));const exported=await exportConverted(p,bytes,name),paint=await pixels(p,bytes);
  const expected=preset==='portrait-3x4'?[1080,1440]:[1440,1080];assert.deepEqual(paint.output,expected);
  assert.deepEqual(native?[exported.width,exported.height]:exported.resolution,expected);
  await save(name,{pass:true,...r,paint,exported});await p.close();
 }
 assert.deepEqual(errors,[]);await save(phase+'-complete',{pass:true,errors,browserVersion:browser.version(),finishedAt:new Date().toISOString()});
}finally{await browser.close();await writeFile(path.join(out,phase+'-errors.json'),JSON.stringify(errors));}
