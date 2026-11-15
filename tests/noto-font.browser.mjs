import assert from 'node:assert/strict';
import {chromium,webkit} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const url=process.env.PLAYER_URL||'http://127.0.0.1:4191/';
const out=process.env.NOTO_OUT||'noto-validation';
await mkdir(out,{recursive:true});
const isWebkit=process.env.NOTO_BROWSER==='webkit';
const browser=await (isWebkit?webkit:chromium).launch(isWebkit?{headless:true}:{channel:'chrome',headless:true,args:['--no-sandbox']});
const results={browser:isWebkit?'Linux WebKit (not physical iOS)':'Chrome (host OS recorded separately)',url};
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage(),fontRequests=[];
 page.on('response',r=>{if(r.url().includes('.otf'))fontRequests.push(r.url());});
 await page.goto(url);
 results.font=await page.evaluate(async()=>{
  const {ensureTaslFont,taslCanvasFont,assertTaslGlyphs}=await import('/tasl-font.js');
  const face=await ensureTaslFont();
  const {MODE4_ALLOWED_CHARS}=await import('/mode4-allowed.js');
  const {makeArtisanGlyphAtlas,cp932GlyphMap}=await import('/tsl-artisan.js');
  const {makeGlyphAtlas}=await import('/tsl-quality.js');
  const {drawTSL}=await import('/tsl.js');
  assertTaslGlyphs(MODE4_ALLOWED_CHARS);
  const atlas=await makeArtisanGlyphAtlas(6),quality=makeGlyphAtlas(6);
  const blank=atlas.filter(g=>g.char!==' '&&!g.mask.some(v=>v>0)).map(g=>g.char);
  const full=MODE4_ALLOWED_CHARS,canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const rows=[];for(let i=0;i<full.length;i+=16)rows.push([...full].slice(i,i+16).join(''));
  drawTSL(canvas,{width:32,height:rows.length,frames:[rows.join('\n')]},0,{foreground:'#ffffff',background:'#000000'});
  canvas.id='noto-sheet';document.body.replaceChildren(canvas);
  const metrics=[];
  for(const char of full){ctx.font=taslCanvasFont(20);ctx.textBaseline='top';const m=ctx.measureText(char);metrics.push({char,width:m.width,left:m.actualBoundingBoxLeft,right:m.actualBoundingBoxRight,top:-m.actualBoundingBoxAscent,bottom:m.actualBoundingBoxDescent});}
  const positions=[];
  const mock={width:0,height:0,getContext:()=>({fillRect(){},set fillStyle(v){},set textBaseline(v){},set font(v){positions.push({font:v});},fillText(...args){positions.push(args);}})};
  drawTSL(mock,{width:8,height:2,frames:['A人αФ\nｲ０B']},0);
  const unsupported=[];
  for(const char of cp932GlyphMap().keys()){try{assertTaslGlyphs(char);}catch{unsupported.push('U+'+char.codePointAt(0).toString(16));}}
  let rejected=false;try{assertTaslGlyphs('\uE000');}catch{rejected=true;}
  return {face:face.family,status:face.status,mode4:full.length,atlas:atlas.length,quality:quality.length,blank,metrics,positions,unsupportedCp932:unsupported,unsupportedRejected:rejected,width:canvas.width,height:canvas.height};
 });
 assert.equal(results.font.mode4,272);assert.equal(results.font.atlas,273);assert.deepEqual(results.font.blank,[]);
 assert.equal(results.font.status,'loaded');assert.equal(results.font.unsupportedRejected,true);
 assert.deepEqual(results.font.positions.filter(Array.isArray),[['A',0,0,12],['人',12,0,24],['α',36,0,24],['Ф',60,0,24],['ｲ',0,24,12],['０',12,24,24],['B',36,24,12]]);
 results.fontRequests=fontRequests;
 assert.ok(fontRequests.length>0,'bundled OTF must be fetched');
 const response=await context.request.get(new URL('/fonts/NotoSansMonoCJKjp-Regular.otf',url).href);
 results.fontHash=createHash('sha256').update(await response.body()).digest('hex');
 assert.equal(results.fontHash,'4d01725be822d144cf9a56ade981e6fb920cd7a610b8fc24cc601a920beea5b9');
 await page.locator('#noto-sheet').screenshot({path:out+'/mode4-272.png'});
 results.worker=await page.evaluate(async()=>new Promise((resolve,reject)=>{
  const src='import {ensureTaslFont,taslCanvasFont} from '+JSON.stringify(new URL('/tasl-font.js',location.href).href)+';await ensureTaslFont();const c=new OffscreenCanvas(48,24),x=c.getContext("2d");x.font=taslCanvasFont(20);x.fillText("人α",0,0);postMessage({font:x.font,status:"loaded"});';
  const u=URL.createObjectURL(new Blob([src],{type:'text/javascript'})),w=new Worker(u,{type:'module'});
  w.onmessage=e=>{resolve(e.data);w.terminate();URL.revokeObjectURL(u);};w.onerror=e=>reject(Error(e.message));
 }));
 assert.equal(results.worker.status,'loaded');
 await context.close();
 const failed=await browser.newContext();await failed.route('**/*.otf',r=>r.abort());
 const failedPage=await failed.newPage();await failedPage.goto(url);
 results.failure=await failedPage.evaluate(async()=>{
  const m=await import('/tasl-font.js');let load='',draw='';
  try{await m.ensureTaslFont();}catch(e){load=e.message;}
  try{m.taslCanvasFont(20);}catch(e){draw=e.message;}
  return {load,draw};
 });
 assert.ok(results.failure.load.includes('Noto'));assert.ok(results.failure.draw);
 await failed.close();
 if(process.env.NOTO_OFFLINE==='1'){
  const offline=await browser.newContext(),p=await offline.newPage();await p.goto(url);
  await p.evaluate(async()=>{await navigator.serviceWorker.ready;await (await import('/tasl-font.js')).ensureTaslFont();});
  await p.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:60000});
  await offline.setOffline(true);await p.reload();
  results.offline=await p.evaluate(async()=>{const f=await(await import('/tasl-font.js')).ensureTaslFont();const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');return {font:f.status,atlas:(await makeArtisanGlyphAtlas()).length};});
  assert.equal(results.offline.atlas,273);
  await offline.close();
 }
 console.log(JSON.stringify({mode4:results.font.mode4,blank:results.font.blank,metricsRange:{top:Math.min(...results.font.metrics.map(m=>m.top)),bottom:Math.max(...results.font.metrics.map(m=>m.bottom))},unsupportedCp932:results.font.unsupportedCp932.length,worker:results.worker,offline:results.offline}));
}finally{
 await writeFile(out+'/font-report.json',JSON.stringify(results,null,2));
 await browser.close();
}
