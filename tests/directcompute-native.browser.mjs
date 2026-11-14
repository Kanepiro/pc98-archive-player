// Windows PC Boost: Direct3D 11 native compute, no WebGPU in PC mode.
// On CI without a physical GPU, verify exact CPU fallback and the lack of
// silent software-renderer masquerading as a GPU.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();
 await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39084/');
 const result=await page.evaluate(async()=>{
  const status=await(await fetch('/health')).json();
  const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');
  const {ArtisanComposer}=await import('/tsl-artisan-engine.js');
  const W=32,H=9,S=10;
  const atlas=await makeArtisanGlyphAtlas(S);
  const canvas=document.createElement('canvas');
  canvas.width=W*S;canvas.height=H*S;
  const c=canvas.getContext('2d',{willReadFrequently:true});
  c.fillStyle='#eee';c.fillRect(0,0,canvas.width,canvas.height);
  c.fillStyle='#171717';c.beginPath();c.ellipse(160,45,78,36,0,0,Math.PI*2);c.fill();
  c.fillStyle='#ddd';c.fillRect(136,35,12,8);c.fillRect(173,35,12,8);
  const pixels=c.getImageData(0,0,canvas.width,canvas.height).data;
  const ref=new ArtisanComposer(atlas,S),candidate=new ArtisanComposer(atlas,S);
  const original=ref.convert(pixels,W,H);
  await candidate.enablePCBoost(W,H);
  const before={
   gpuMatcher:!!candidate.gpuMatcher,
   nativeGpuName:candidate.nativeGpuInfo?.name||'',
   directCompute:!!candidate.directComputeMatcher,
   exactCPU:!!candidate.exactMatcher
  };
  const text=await candidate.convertAccelerated(pixels,W,H);
  return {
   status:{nativeGpu:status.nativeGpu,gpuName:status.gpuName,
     gpuEngine:status.gpuEngine,gpuReason:status.gpuReason},
   before,
   acceleration:candidate.acceleration,
   same:text===original,
   scoreRef:ref.lastDiagnostics.critique.after.total,
   scoreActual:candidate.lastDiagnostics.critique.after.total,
   gpuError:candidate.gpuError||'',
   perf:candidate.lastPerf
  };
 });
 console.log('WINDOWS_NATIVE_DIRECTCOMPUTE',JSON.stringify(result));
 assert.equal(result.before.gpuMatcher,false,
  'PC Boost unexpectedly used WebGPU');
 if(result.status.nativeGpu){
  assert.equal(result.before.directCompute,true);
  assert.equal(result.acceleration,'DirectCompute',
   'Native GPU exists but was not used: '+result.gpuError);
  assert.ok(result.before.nativeGpuName.length>0);
  assert.ok(Math.abs(result.scoreRef-result.scoreActual)<
   Math.max(1,result.scoreRef*.35),
   'GPU native candidate scoring changed original structural quality too much');
 }else{
  assert.equal(result.before.directCompute,false);
  assert.equal(result.before.exactCPU,true);
  assert.equal(result.acceleration,'PC Native Exact');
  assert.equal(result.same,true,'CPU fallback did not match original Mode 4');
 }
 console.log('PASS: PC Boost uses native D3D11 GPU or truthful exact C++ fallback, never WebGPU');
}finally{await browser.close();}
