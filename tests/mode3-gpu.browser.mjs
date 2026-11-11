// GPU arithmetic must preserve Mode3 contour quality; default mode auto-falls back.
// Browser must be launched with WebGPU/SwiftShader flags on Linux CI.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const flags=['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan,WebGPUDeveloperFeatures','--use-angle=swiftshader'];
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:flags});
const page=await browser.newPage();
page.on('console',m=>{if(m.type()==='error')console.log('PAGE CONSOLE',m.text())});
await page.goto(process.env.PLAYER_URL||'http://127.0.0.1:4190/');
try{
 const results=await page.evaluate(async()=>{
  const {QualityConverter,makeGlyphAtlas}=await import('/tsl-quality.js');
  const S=6,W=64,H=26,atlas=makeGlyphAtlas(S);
  const gpu=new QualityConverter(atlas,S),cpu=new QualityConverter(atlas,S);
  await gpu.enableWebGPU(W,H);
  if(!gpu.gpuMatcher)return {supported:false};
  // Validate raw GPU path rather than measuring the automatic SwiftShader fallback.
  gpu.gpuBenchmarked=true;gpu.acceleration='WebGPU';
  const cases=[];
  for(let step=0;step<6;step++){
   const pixels=new Uint8ClampedArray(W*H*S*S*4);
   for(let y=0;y<H*S;y++)for(let x=0;x<W*S;x++){
    const j=(y*W*S+x)*4;
    const inside=x>=10*S+step*4&&x<38*S+step*4&&y>=6*S&&y<20*S;
    const flat=step===3;
    const v=flat?0:(inside?230:15);
    pixels[j]=flat?215:(v+Math.floor(x/5))%256;
    pixels[j+1]=flat?65:(inside?30:180);
    pixels[j+2]=flat?140:(inside?200:70);
    pixels[j+3]=255;
   }
   const a=cpu.convert(pixels.slice(),W,H);
   const b=await gpu.convertAccelerated(pixels.slice(),W,H);
   const different=[...a].filter((c,i)=>c!==b[i]).length,meaningful=[...b].filter(c=>![' ','\r','\n'].includes(c)).length;
   cases.push({step,chars:a.length,different,ratio:different/a.length,meaningful,mode:gpu.acceleration});
  }
  gpu.gpuMatcher?.dispose();
  return {supported:true,cases};
 });
 assert.ok(results.supported,'WebGPU adapter unavailable');
 for(const x of results.cases){
  assert.ok(x.ratio<=0.015,'Mismatch too large: '+JSON.stringify(x));
  if(x.step===3)assert.equal(x.meaningful,0,'flat field must be blank');
  assert.equal(x.mode,'WebGPU');
 }
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
