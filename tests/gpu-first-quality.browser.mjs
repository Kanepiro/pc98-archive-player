// GPU-first PC Boost regression with a SOFTWARE WebGPU adapter in CI.
// Software is injected ONLY in this test. Production always rejects SwiftShader.
// GPU glyph choices may differ from the original; structural quality must hold.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const chrome=process.platform==='win32'?undefined:'/usr/bin/google-chrome';
const browser=await chromium.launch({
 headless:true,...(chrome?{executablePath:chrome}:{channel:'chrome'}),
 args:['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader']
});
try{
 const page=await browser.newPage();
 await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39084/');
 const result=await page.evaluate(async()=>{
  const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');
  const {ArtisanComposer}=await import('/tsl-artisan-engine.js');
  const {Mode4GpuMatcher}=await import('/tsl-artisan-webgpu.js');
  const {MODE4_ALLOWED_CHARS}=await import('/mode4-allowed.js');
  const oldCreate=Mode4GpuMatcher.create;
  // Bypass hardware gate only to exercise the GPU shader in a software-only
  // CI runner. We never set this in product code.
  Mode4GpuMatcher.create=async function(atlas,S,w,h){
   const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
   if(!adapter)throw Error('No software WebGPU adapter available to test compute');
   const device=await adapter.requestDevice();
   const matcher=new Mode4GpuMatcher(device,atlas,S,w,h);
   await matcher.init();
   matcher.adapterInfo={name:'SwiftShader test only',software:true,identified:true};
   return matcher;
  };
  try{
   const W=32,H=9,S=10,atlas=await makeArtisanGlyphAtlas(S);
   const canvas=document.createElement('canvas');
   canvas.width=W*S;canvas.height=H*S;
   const c=canvas.getContext('2d',{willReadFrequently:true});
   c.fillStyle='#e4e7ea';c.fillRect(0,0,canvas.width,canvas.height);
   c.strokeStyle='#121212';c.lineWidth=5;
   c.beginPath();c.ellipse(165,45,63,32,0,0,Math.PI*2);c.stroke();
   c.beginPath();c.moveTo(122,39);c.lineTo(144,39);
   c.moveTo(183,39);c.lineTo(204,39);c.moveTo(148,59);c.lineTo(186,59);c.stroke();
   const pixels=c.getImageData(0,0,canvas.width,canvas.height).data;
   const reference=new ArtisanComposer(atlas,S);
   const cpu=reference.convert(pixels,W,H);
   const accelerated=new ArtisanComposer(atlas,S);
   await accelerated.enablePCBoost(W,H);
   const gpu=await accelerated.convertAccelerated(pixels,W,H);
   const referenceCritic=reference.lastDiagnostics.critique.after.total;
   const gpuCritic=accelerated.lastDiagnostics.critique.after.total;
   const allowed=new Set([...MODE4_ALLOWED_CHARS,' ','\r','\n']);
   const unique=(v)=>new Set([...v].filter(x=>x!==' '&&x!=='\r'&&x!=='\n')).size;
   // GPU is allowed to pick different glyphs, but may not produce nonsense:
   const shaderValid=accelerated.acceleration==='WebGPU'&&
    Math.abs(gpuCritic-referenceCritic)<Math.max(1,referenceCritic*.35)&&
    unique(gpu)>3&&[...gpu].every(x=>allowed.has(x));
   // Slight fp32 disturbances must not trigger strict CPU/GPU byte comparison.
   const mild=new ArtisanComposer(atlas,S);
   await mild.enablePCBoost(W,H);
   const originalCompute=mild.gpuMatcher.compute.bind(mild.gpuMatcher);
   mild.gpuMatcher.compute=async(...args)=>{
    const scores=await originalCompute(...args);
    for(let i=0;i<scores.length;i++){
     if(scores[i]<1e18&&i%13===0)scores[i]+=.025;
    }
    return scores;
   };
   const slightlyDifferent=await mild.convertAccelerated(pixels,W,H);
   const mildAccepted=mild.acceleration==='WebGPU';
   // Completely broken scores MUST fall back to the exact C++ native scorer.
   const corrupted=new ArtisanComposer(atlas,S);
   await corrupted.enablePCBoost(W,H);
   const underlying=corrupted.gpuMatcher;
   corrupted.gpuMatcher.compute=async()=>new Float32Array(W*H*atlas.length).fill(0);
   const repaired=await corrupted.convertAccelerated(pixels,W,H);
   const badRecovered=corrupted.acceleration==='PC Native Exact'&&repaired===cpu;
   accelerated.gpuMatcher?.dispose();
   mild.gpuMatcher?.dispose();
   underlying?.dispose();
   return {shaderValid,acceleration:accelerated.acceleration,
    referenceCritic,gpuCritic,same:gpu===cpu,mildAccepted,
    mildSame:slightlyDifferent===cpu,badRecovered,
    corruptError:corrupted.gpuError};
  }finally{Mode4GpuMatcher.create=oldCreate;}
 });
 console.log('GPU_FIRST_QUALITY',JSON.stringify(result));
 assert.equal(result.shaderValid,true,'GPU results diverged from original structural quality');
 assert.equal(result.mildAccepted,true,'Small GPU precision difference forced CPU fallback');
 assert.equal(result.badRecovered,true,'Bad GPU results must fall back to C++ and original AA');
 console.log('PASS GPU-first + relaxed output + original structural quality + native fallback');
}finally{await browser.close();}
