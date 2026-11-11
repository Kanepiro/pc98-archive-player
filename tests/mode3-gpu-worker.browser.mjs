import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',
 args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan,WebGPUDeveloperFeatures','--use-angle=swiftshader']});
const page=await browser.newPage();
await page.goto(process.env.PLAYER_URL||'http://127.0.0.1:4190/');
try{
 const result=await page.evaluate(async()=>{
  const {makeGlyphAtlas}=await import('/tsl-quality.js');
  const W=32,H=16,S=6,atlas=makeGlyphAtlas(S);
  const worker=new Worker('/tsl-converter-worker.js',{type:'module'});
  const receive=()=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('worker reply timeout')),22000);
   worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};
   worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};
  });
  try{
   const ready=receive();
   worker.postMessage({type:'init',atlas,sample:S,width:W,height:H,state:null});
   const init=await ready;
   if(init.error)throw Error(init.error);
   const pixels=new Uint8ClampedArray(W*H*S*S*4);
   for(let i=0;i<pixels.length;i+=4){const q=(i/4)%255;pixels[i]=q;pixels[i+1]=255-q;pixels[i+2]=128;pixels[i+3]=255;}
   const frameReady=receive();
   worker.postMessage({pixels:pixels.buffer,width:W,height:H,options:{conversionMode:'quality'}},[pixels.buffer]);
   const frame=await frameReady;
   if(frame.error)throw Error(frame.error);
   const snapReady=receive();worker.postMessage({type:'snapshot'});const snap=await snapReady;
   return {webgpuBrowser:!!navigator.gpu,workerGpuAvailable:init.gpuAvailable,
    accelerator:frame.acceleration,width:W,height:H,frameLength:frame.frame?.length,
    forbidden:[...('○●□■◇◆')].filter(x=>frame.frame?.includes(x)),snapshot:!!snap.state};
  }finally{worker.terminate();}
 });
 assert.equal(result.workerGpuAvailable,true,'GPU must initialize in the dedicated worker');
 assert.equal(result.forbidden.length,0);
 assert.ok(result.frameLength>0);
 assert.ok(result.snapshot);
 console.log(JSON.stringify(result));
}finally{await browser.close();}
