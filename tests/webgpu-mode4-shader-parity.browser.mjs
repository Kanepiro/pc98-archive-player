// Shader-parity test on a software WebGPU adapter. Bypass the hardware gate
// ONLY in the test using the low-level matcher constructor. This is NOT a test
// of physical GPU utilization or the GTX 1050 Ti.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',
 args:['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader']});
try{
 const page=await browser.newPage();
 await page.goto(process.env.PLAYER_URL||'http://127.0.0.1:4487/');
 const findings=await page.evaluate(async()=>{
  const {ArtisanComposer}=await import('/tsl-artisan-engine.js');
  const {Mode4GpuMatcher}=await import('/tsl-artisan-webgpu.js');
  const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');
  const findings=[];
  for(const [w,h,S] of [[8,6,6],[32,9,10],[80,25,10]]){
   const atlas=await makeArtisanGlyphAtlas(S);
   const pixels=new Uint8ClampedArray(w*h*S*S*4);
   for(let i=0;i<pixels.length/4;i++){
    const x=i%(w*S),y=Math.floor(i/(w*S));
    const level=x>w*S*.3&&x<w*S*.7&&y>h*S*.15&&y<h*S*.85?32:208;
    pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=level;pixels[i*4+3]=255;
   }
   const cpu=new ArtisanComposer(atlas,S),gpu=new ArtisanComposer(atlas,S);
   const reference=cpu.convert(pixels,w,h);
   // Direct shader test only; product create() correctly refuses SwiftShader.
   const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
   if(!adapter)throw Error('Test adapter missing');
   const device=await adapter.requestDevice();
   gpu.gpuMatcher=new Mode4GpuMatcher(device,gpu.atlas,S,w,h);
   await gpu.gpuMatcher.init();
   const candidate=await gpu.convertAccelerated(pixels,w,h);
   findings.push({w,h,S,same:reference===candidate,acceleration:gpu.acceleration,
    cpuLoss:cpu.lastDiagnostics.final.total,
    gpuLoss:gpu.lastDiagnostics.final.total,
    gpuMs:Math.round(gpu.lastPerf.gpuMs)});
   gpu.gpuMatcher?.dispose();
  }
  return findings;
 });
 for(const v of findings){
  assert.equal(v.same,true,'GPU shader changed the AA composition');
  assert.equal(v.acceleration,'WebGPU');
  assert.ok(Math.abs(v.cpuLoss-v.gpuLoss)<.002);
  console.log('GPU_SHADER_PARITY',JSON.stringify(v));
 }
}finally{await browser.close();}
