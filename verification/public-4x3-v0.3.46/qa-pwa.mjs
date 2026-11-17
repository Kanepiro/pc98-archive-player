import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const work=import.meta.dirname,require=createRequire(path.join(work,'web/package.json')),{chromium}=require('@playwright/test');
let root=path.join(work,'web-baseline/dist');
const headers=Object.fromEntries(JSON.parse(await readFile(path.join(work,'web/vercel.json'),'utf8')).headers[0].headers.map(x=>[x.key,x.value]));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.otf':'font/otf','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),p=path.resolve(root,'.'+decodeURIComponent(u.pathname));assert(p===root||p.startsWith(root+path.sep));const file=u.pathname.endsWith('/')?path.join(p,'index.html'):p;const body=await readFile(file);res.writeHead(200,{...headers,'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(resolve=>server.listen(39464,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
async function input(){await page.evaluate(()=>{const f=document.createElement('input');f.id='pwa-fixture';f.type='file';document.body.append(f)});await page.setInputFiles('#pwa-fixture',path.join(work,'fixture.mp4'));}
async function convert(preset,mode){return page.evaluate(async({preset,mode})=>{
 const {convertVideo}=await import('/video-to-tsl.js');let g={sourceGrid:true};
 if(preset)g=(await import('/tsl-output-presets.js')).presetGrid(preset);
 let from=null;const c=await convertVideo(document.querySelector('#pwa-fixture').files[0],{...g,conversionMode:mode,fps:24,fit:'contain',onProgress:p=>{if(p.phase==='resumed')from=p.done;}});
 return {hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await c.blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join(''),from,count:c.plan.count};
 },{preset,mode});}
try{
 await page.goto('http://127.0.0.1:39464/mobile/');assert.match(await page.locator('header').innerText(),/0.3.45/);
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;localStorage.setItem('qa-upgrade-marker','keep');});
 await page.waitForFunction(()=>document.querySelector('#offline').textContent.includes('準備済み'),null,{timeout:90000});
 const oldCaches=await page.evaluate(()=>caches.keys());await input();const before=await convert(null,'legacy');
 console.log('PWA v0.3.45 cached with completed checkpoint');
 root=path.join(work,'web/dist');
 const updatedNavigation=page.waitForEvent('load',{timeout:90000});
 await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});
 const sw=await readFile(path.join(root,'sw.js'),'utf8'),expectedCache=sw.match(/const CACHE='([^']+)'/)[1];
 await updatedNavigation;
 await page.waitForFunction(async ({key,old})=>{const r=await navigator.serviceWorker.getRegistration(),keys=await caches.keys();return r?.active?.state==='activated'&&!r.installing&&!r.waiting&&navigator.serviceWorker.controller===r.active&&keys.includes(key)&&old.every(k=>!keys.includes(k));},{key:expectedCache,old:oldCaches},{timeout:90000});
 assert.match(await page.locator('header').innerText(),/0.3.46/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('qa-upgrade-marker')),'keep');
 await input();const after=await convert(null,'legacy');assert.equal(after.hash,before.hash);assert.equal(after.from,before.count);
 const newCaches=await page.evaluate(()=>caches.keys());assert(newCaches.includes(expectedCache));assert(oldCaches.every(k=>!newCaches.includes(k)));
 console.log('PWA upgraded to v0.3.46; old checkpoint and local data retained');
 await context.setOffline(true);await page.reload();assert.match(await page.locator('header').innerText(),/0.3.46/);await input();
 const rows=[];
 for(const [preset,mode] of [['portrait-3x4','legacy'],['landscape-4x3','artisan']]){
  await page.evaluate(async()=>await(await import('/tsl-checkpoint.js')).deleteCheckpoint());
  const result=await convert(preset,mode),expected=JSON.parse(await readFile(path.join(work,'qa/web',preset+'-'+mode+'.json'),'utf8')).summary;
  assert.equal(result.hash,expected.tslSHA256);rows.push({preset,mode,...result,onlineIdentical:true});console.log('PWA OFFLINE '+preset+' '+mode+' PASS');
 }
 await page.click('#tab-converter');await page.selectOption('#video-mode','landscape-4x3');await page.screenshot({path:path.join(work,'qa/pwa-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);await writeFile(path.join(work,'qa/pwa.json'),JSON.stringify({pass:true,before,after,oldCaches,newCaches,rows,errors,browserVersion:browser.version()},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
