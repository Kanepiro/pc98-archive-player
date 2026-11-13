import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',
 args:['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader']});
const page=await browser.newPage();
page.on('console',m=>{if(['warning','error'].includes(m.type()))console.log('WEBGPU_CONSOLE',m.text().slice(0,400));});
try{
 await page.goto('http://127.0.0.1:4485/');
 const data=await page.evaluate(async()=>{
  const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
  const results={navigatorGpu:!!navigator.gpu,adapter:!!adapter};
  if(!adapter)return results;
  const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');
  const {ArtisanComposer}=await import('/tsl-artisan-engine.js');
  const {GpuToneConverter}=await import('/tsl-tone-webgpu.js');
  const width=8,height=6,sample=6;
  const pixels=new Uint8ClampedArray(width*height*sample*sample*4);
  for(let y=0;y<height*sample;y++)for(let x=0;x<width*sample;x++){
   const i=(y*width*sample+x)*4,light=(x>12&&x<35&&y>10&&y<32)?30:210;
   pixels[i]=pixels[i+1]=pixels[i+2]=light;pixels[i+3]=255;
  }
  for(const mode of ['legacy','halftone']){
   try{
    const gpu=await GpuToneConverter.create(mode,sample,width,height);
    if(!gpu){results[mode]='null';continue;}
    const txt=await gpu.convert(pixels,{sample,gamma:1,contrast:1,edge:.6});
    results[mode]={acceleration:gpu.acceleration,chars:[...new Set([...txt])].slice(0,14)};
    gpu.dispose();
   }catch(e){results[mode]={error:String(e)};}
  }
  try{
   const atlas=await makeArtisanGlyphAtlas(sample);
   const reference=new ArtisanComposer(atlas,sample);
   const first=performance.now(),ref=reference.convert(pixels,width,height),cpuMs=performance.now()-first;
   const engine=new ArtisanComposer(atlas,sample);
   await engine.enableWebGPU(width,height);
   const before=!!engine.gpuMatcher;
   const start=performance.now(),now=await engine.convertAccelerated(pixels,width,height),gpuMs=performance.now()-start;
   results.artisan={before,acceleration:engine.acceleration,matched:now===ref,
    cpuMs:Math.round(cpuMs),gpuMs:Math.round(gpuMs),error:engine.gpuError||null};
   engine.gpuMatcher?.dispose();
  }catch(e){results.artisan={error:String(e)};}
  return results;
 });
 console.log('GPU_SMOKE',JSON.stringify(data));
}finally{await browser.close();}
