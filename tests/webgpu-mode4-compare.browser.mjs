import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',
 args:['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader']});
const page=await browser.newPage();
try{
 await page.goto('http://127.0.0.1:4485/');
 const result=await page.evaluate(async()=>{
  const {ArtisanComposer}=await import('/tsl-artisan-engine.js');
  const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');
  const samples=[];
  for(const [w,h,S] of [[8,6,6],[32,9,10],[48,30,10]]){
   const atlas=await makeArtisanGlyphAtlas(S),canvas=document.createElement('canvas');
   canvas.width=w*S;canvas.height=h*S;const ctx=canvas.getContext('2d',{willReadFrequently:true});
   ctx.fillStyle='#ececec';ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.fillStyle='#171717';ctx.fillRect(canvas.width*.36,canvas.height*.1,canvas.width*.28,canvas.height*.8);
   ctx.fillStyle='#fafafa';ctx.fillRect(canvas.width*.43,canvas.height*.37,canvas.width*.04,canvas.height*.08);
   ctx.fillRect(canvas.width*.53,canvas.height*.37,canvas.width*.04,canvas.height*.08);
   const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   const ref=new ArtisanComposer(atlas,S),gpu=new ArtisanComposer(atlas,S);
   const t0=performance.now(),a=ref.convert(pixels,w,h),cpuMs=performance.now()-t0;
   await gpu.enableWebGPU(w,h);
   const available=!!gpu.gpuMatcher;
   const t1=performance.now(),b=await gpu.convertAccelerated(pixels,w,h),gpuMs=performance.now()-t1;
   samples.push({w,h,S,available,acceleration:gpu.acceleration,same:a===b,
    cpuMs:Math.round(cpuMs),gpuMs:Math.round(gpuMs),
    cpuLoss:ref.lastDiagnostics.final.total,gpuLoss:gpu.lastDiagnostics.final.total,
    gpuError:gpu.gpuError||null,previewCpu:a.split('\r\n').slice(0,3),
    previewGpu:b.split('\r\n').slice(0,3)});
   gpu.gpuMatcher?.dispose();
  }
  return samples;
 });
 for(const v of result){
  assert.equal(v.available,true,'GPU unavailable');
  assert.equal(v.acceleration,'WebGPU');
  assert.equal(v.same,true,'GPU output differs from CPU at '+v.w+'x'+v.h);
  assert.ok(Math.abs(v.cpuLoss-v.gpuLoss)<.002);
  console.log('GPU_CPU_MODE4_COMPARE',JSON.stringify(v));
 }
}finally{await browser.close();}
