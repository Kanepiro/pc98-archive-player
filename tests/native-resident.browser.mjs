import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await mkdir('gpu-validation',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39085/');
 const ring=await page.evaluate(async()=>{
  const {FullGpuNativeLayout}=await import('/tsl-fullgpu-native.js');
  const {ArtisanComposer}=await import('/tsl-artisan-engine.js');
  const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');
  const composer=new ArtisanComposer(await makeArtisanGlyphAtlas(6),6),atlas=composer.atlas;
  const canvas=document.createElement('canvas');canvas.width=144;canvas.height=72;
  const ctx=canvas.getContext('2d'),inputs=[],baseline=[],resident=[];
  const old=new FullGpuNativeLayout(true,false);
  for(let i=0;i<23;i++){
   ctx.fillStyle='#fff';ctx.fillRect(0,0,144,72);ctx.fillStyle='#111';
   ctx.fillRect(4+i*3,7+i%8,19,50);ctx.strokeStyle='#333';ctx.beginPath();ctx.moveTo(0,20);ctx.lineTo(144,67-i);ctx.stroke();
   const p=composer._prepare(ctx.getImageData(0,0,144,72).data,24,12,{semantic:[]});
   if(p.cached)throw Error('Unexpected cached test frame');
   inputs.push(p);const r=await old.compose(p,atlas);baseline.push(r);
   composer.previousGray=p.field.gray;composer.previousChars=r.chars;
  }
  const next=new FullGpuNativeLayout(true);
  for(const p of inputs){
   const prepared={...p,oldChars:resident.length?resident.at(-1).chars:p.oldChars};
   resident.push(await next.compose(prepared,atlas));
  }
  // Interleaving a second job must cause safe reinitialization, never stale input.
  const other=new FullGpuNativeLayout(true);await other.compose(inputs[0],[...atlas]);
  const resumed=await next.compose(inputs[5],atlas);
  const {NativeLayoutTransfer}=await import('/tsl-fullgpu-resident.js');
  const fixture=Array.from(new NativeLayoutTransfer().pack(inputs[0],atlas).buffer);
  return {baseline,resident,resumed,expected:baseline[5].frame,fixture};
 });
 await writeFile('gpu-validation/resident-input.bin',Buffer.from(ring.fixture));delete ring.fixture;
 for(let i=0;i<ring.baseline.length;i++){
  assert.equal(ring.resident[i].frame,ring.baseline[i].frame,'Exact glyph output frame '+i);
  assert.deepEqual(ring.resident[i].diagnostics,ring.baseline[i].diagnostics);
  const t=ring.resident[i].perf.transfer;
  assert.equal(t.residentEnabled,1);
  assert.equal(t.ringSlot,i%10);
  assert.ok(t.residentBytes<=256*1024*1024);
  if(i){assert.equal(t.bufferAllocations,0);assert.equal(t.bufferReleases,0);assert.equal(t.staticUploads,0);}
 }
 assert.equal(ring.resumed.frame,ring.expected);
 const reports=[];
 for(const resident of [false,true]){
  await page.reload();
  reports.push(await page.evaluate(async resident=>{
   const {FullGpuNativeLayout}=await import('/tsl-fullgpu-native.js');
   const original=FullGpuNativeLayout.prototype.compose;
   FullGpuNativeLayout.prototype.compose=function(...args){this.transfer.enabled=resident;return original.apply(this,args);};
   const {convertVideo}=await import('/video-to-tsl.js');
   const source=await(await fetch('/__validation.mp4')).arrayBuffer();
   const file=new File([source],'resident-comparison.mp4',{type:'video/mp4',lastModified:0});
   const progress=[],start=performance.now();
   const result=await convertVideo(file,{sourceGrid:true,width:80,height:22,conversionMode:'artisan',native16:true,
    exactNative:true,fps:4,brightness:0,contrast:1,gamma:1,edge:0,
    onProgress:p=>{if(p.phase==='converting')progress.push({frame:p.done,backend:p.acceleration,perf:p.perf,error:p.gpuReason});}});
   return {resident,wallMs:performance.now()-start,plan:result.plan,progress,tsl:Array.from(new Uint8Array(await result.blob.arrayBuffer()))};
  },resident));
 }
 assert.deepEqual(reports[0].tsl,reports[1].tsl,'Complete video TSL bytes');
 for(const r of reports){
  assert.ok(r.progress.every(p=>p.backend==='WARP Test Global'));
  await writeFile('gpu-validation/resident-'+(r.resident?'after':'before')+'.TSL',Buffer.from(r.tsl));
  delete r.tsl;
 }
 const source=await readFile('dist/__validation.mp4');
 const report={adapter:'WARP software, not GTX 1050 Ti hardware',sourceSha256:createHash('sha256').update(source).digest('hex'),
  exactText:true,exactVideoTsl:true,ring,video:reports};
 await writeFile('gpu-validation/resident-report.json',JSON.stringify(report,null,2));
 console.log('RESIDENT_VALIDATION',JSON.stringify({exactText:true,exactVideoTsl:true,frames:ring.resident.length,video:reports.map(r=>({resident:r.resident,wallMs:r.wallMs}))}));
}finally{await browser.close();}
