import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,join,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
const out=resolve(process.env.FREEZE_TEST_DIR||'freeze-validation');await mkdir(out,{recursive:true});
const fixture=join(out,'moving-65s.mp4');
execFileSync(process.env.FFMPEG||'ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=256x144:rate=30:duration=65','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',fixture]);
const root=resolve('dist');
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 try{
  if(path==='/stale-sw.js'){
   res.setHeader('Content-Type','text/javascript');res.end(`self.addEventListener('install',e=>e.waitUntil(caches.open('pc98-stale-fixture').then(c=>c.put('/converter-ui.js',new Response('globalThis.staleConverter=true;export function setupConverter(){}',{headers:{'Content-Type':'text/javascript'}}))).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith(caches.open('pc98-stale-fixture').then(async c=>await c.match(e.request,{ignoreSearch:true})||fetch(e.request)));});`);return;
  }
  if(path==='/cache-test'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Cache regression</title>');return;}
  if(path==='/__fixture.mp4'){res.setHeader('Content-Type','video/mp4');res.end(await readFile(fixture));return;}
  if(path==='/health'||path.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"CPU test only"}');return;}
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(root+sep))throw Error('path');
  const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm'};
  res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();page.on('console',m=>{if(m.type()==='log')console.log(m.text());});
 await page.goto(base+'/cache-test');
 await page.evaluate(async()=>{await navigator.serviceWorker.register('/stale-sw.js');await navigator.serviceWorker.ready;});
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await page.evaluate(()=>import('/converter-ui.js'));assert.equal(await page.evaluate(()=>!!globalThis.staleConverter),true);
 await page.route('**/tsl-artisan-vision.js',r=>r.fulfill({contentType:'text/javascript',body:'export async function createArtisanVision(){return {detect(){return []},close(){}}}'}));
 await page.goto(base);
 assert.equal(await page.evaluate(()=>!!globalThis.staleConverter),false);
 const script=await page.locator('script[type=module]').getAttribute('src');assert.match(script,/native-assets\/[a-f0-9]+\/app.js/);
 await page.waitForFunction(()=>document.querySelector('#offline').textContent==='Windows同梱プログラム');
 const cacheBypassed=await page.evaluate(async()=>!(await navigator.serviceWorker.getRegistration('/')));assert.equal(cacheBypassed,true);
 console.log('PASS stale service worker reproduces old imports; native path bypasses it');
 const report=await page.evaluate(async script=>{
  const dir=script.slice(0,script.lastIndexOf('/')+1);
  const {createVideoFrameReader}=await import(dir+'video-frame-reader.js');
  const file=new File([await(await fetch('/__fixture.mp4')).blob()],'moving.mp4',{type:'video/mp4',lastModified:0});
  const times=Array.from({length:1950},(_,i)=>i/30),reader=await createVideoFrameReader(file,times);
  const c=document.createElement('canvas');c.width=64;c.height=36;const ctx=c.getContext('2d',{willReadFrequently:true});
  let changed=0,last=null;const checks=[];
  try{for(let i=0;i<times.length;i++){
   const f=await reader.read();ctx.drawImage(f.image,0,0,64,36);const p=ctx.getImageData(0,0,64,36).data;
   let hash=2166136261;for(let k=0;k<p.length;k++)hash=Math.imul(hash^p[k],16777619)>>>0;
   if(hash!==last)changed++;last=hash;
   if(i%300===0||i===1949)checks.push({i,time:times[i],decoded:f.timestamp,hash});
  }}finally{await reader.close();}
  if(changed<1900)throw Error('Moving decoder output stopped: '+changed);
  const {convertVideo}=await import(dir+'video-to-tsl.js');
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
   if(image instanceof HTMLVideoElement)throw Error('Mode 4 captured an unverified HTML video surface');
   return draw.call(this,image,...args);
  };
  let converted;
  try{converted=await convertVideo(file,{width:16,height:8,fps:1,conversionMode:'artisan',exactNative:false,
   onProgress:p=>{if(p.phase==='converting'&&p.done%10===0)console.log('MODE4',p.done,p.total);}});}
  finally{CanvasRenderingContext2D.prototype.drawImage=draw;}
  const {parseTSL}=await import(dir+'tsl.js');
  const data=parseTSL(new TextDecoder('shift_jis').decode(await converted.blob.arrayBuffer()));
  if(new Set(data.frames.slice(18)).size<30)throw Error('Mode 4 frames froze beyond 18 seconds');
  if(data.frames[58]===data.frames[64])throw Error('Mode 4 tail froze beyond 57 seconds');
  return {cacheBypassed:true,decoderFrames:1950,changed,checks,mode4Frames:data.frames.length,uniqueMode4:new Set(data.frames).size,duration:data.duration};
 },script);
 assert.equal(report.mode4Frames,65);
 await writeFile(join(out,'browser-report.json'),JSON.stringify(report,null,2));
 console.log('PASS',JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));}
