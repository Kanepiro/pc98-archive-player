// Optional calibration reproduction. Ordinary builds use the committed masks.
import {chromium} from '@playwright/test';import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),pub=path.join(root,'public'),write=process.argv.includes('--write');
const server=http.createServer(async(req,res)=>{try{const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html',f=path.resolve(pub,relative);if(!f.startsWith(pub+path.sep))throw Error('Path');const data=await fs.readFile(f);res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.otf')?'font/otf':f.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({serviceWorkers:'block'});await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const results=await page.evaluate(async()=>{
  const {drawTSL}=await import('/tsl.js'),{ensureTaslFont}=await import('/tasl-font.js');await ensureTaslFont();
  const rows=[];for(const cell of [24,16])for(const char of ['　','。','ｏ','Ｏ','◎']){
   const c=document.createElement('canvas');drawTSL(c,{width:2,height:1,native16:cell===16,frames:[char]},0,{foreground:'#ffffff',background:'#000000'});
   const pixels=c.getContext('2d').getImageData(0,0,cell,cell).data,mask=Array.from({length:cell*cell},(_,i)=>pixels[i*4]);
   rows.push({cell,char,mask,area:mask.reduce((a,b)=>a+b,0)/255});
  }return rows;
 });
 const profiles={};for(const cell of [24,16]){
  const rows=results.filter(r=>r.cell===cell),mask=Buffer.from(rows.flatMap(r=>r.mask)),levels=rows.map(r=>r.area/rows.at(-1).area),filename=path.join(pub,'halftone-atlas'+cell+'.bin');
  if(write)await fs.writeFile(filename,mask);else assert.deepEqual(mask,await fs.readFile(filename),'Browser calibration changed; inspect before updating committed masks');
  profiles[cell]={cell,hash:createHash('sha256').update(mask).digest('hex'),levels,thresholds:levels.slice(0,-1).map((v,i)=>(v+levels[i+1])/2)};
 }
 if(write)await fs.writeFile(path.join(pub,'halftone-profiles.js'),'export const HALFTONE_PROFILES='+JSON.stringify(profiles)+';\n');
 console.log(JSON.stringify({browser:browser.version(),verified:!write,profiles}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
