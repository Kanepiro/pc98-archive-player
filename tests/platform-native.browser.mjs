import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-webgpu']});
try{
 const page=await browser.newPage();
 await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39085/');
 assert.match(await page.locator('header').innerText(),/Windows ネイティブ版 · v0.3.39/);
 const results=await page.evaluate(async()=>{
  const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');
  const {makeGlyphAtlas}=await import('/tsl-quality.js');
  const {MODE4_ALLOWED_CHARS}=await import('/mode4-allowed.js');
  if(MODE4_ALLOWED_CHARS.length!==272)throw Error('Palette changed');
  const results=[];
  for(const mode of ['legacy','halftone','quality','artisan']){
   const width=12,height=8,sample=6;
   const atlas=mode==='artisan'?await makeArtisanGlyphAtlas(sample):mode==='quality'?await makeGlyphAtlas(sample):null;
   const worker=new Worker('/tsl-converter-worker.js',{type:'module'});
   const ask=d=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(mode+' timed out')),120000);worker.onmessage=e=>{clearTimeout(timer);e.data.error?reject(Error(e.data.error)):resolve(e.data);};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.postMessage(d);});
   try{
    await ask({type:'init',mode,width,height,sample,atlas,exactNative:true});
    const pixels=new Uint8ClampedArray(width*height*sample*sample*4);
    for(let y=0;y<height*sample;y++)for(let x=0;x<width*sample;x++){const i=(y*width*sample+x)*4;const v=(x>18&&x<50&&y>10&&y<40)?30:210;pixels[i]=pixels[i+1]=pixels[i+2]=v;pixels[i+3]=255;}
    const out=await ask({pixels:pixels.buffer,width,height,options:{conversionMode:mode,sample,ramp:' .:|/(%YVO8D@0#$',gamma:1,contrast:1,edge:.6}});
    if(!out.frame||out.acceleration==='WebGPU')throw Error('Native isolation failed '+mode);
    if(mode==='artisan')for(const ch of out.frame)if(![' ','\r','\n',...MODE4_ALLOWED_CHARS].includes(ch))throw Error('Invalid glyph '+ch);
    results.push({mode,backend:out.acceleration,reason:out.gpuReason,characters:out.frame.length});
   }finally{worker.terminate();}
  }
  return results;
 });
 await mkdir('gpu-validation',{recursive:true});await writeFile('gpu-validation/platform-isolation.json',JSON.stringify({environment:'Windows CI, WebGPU disabled; WARP software native test adapter',results},null,2));
 console.log('PASS native isolation and modes 1-4',JSON.stringify(results));
}finally{await browser.close();}
