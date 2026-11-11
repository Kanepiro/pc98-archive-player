import {rgbaToASCII} from './tsl-converter-core.js';
import {QualityConverter} from './tsl-quality.js';
let quality=null;
self.onmessage=async({data:d})=>{
 try{
  if(d.type==='init'){
   quality=new QualityConverter(d.atlas,d.sample);
   quality.restore(d.state);
   await quality.enableWebGPU(d.width,d.height);
   self.postMessage({ready:true,gpuAvailable:!!quality.gpuMatcher});return;
  }
  if(d.type==='snapshot'){
   if(!quality)throw Error('モード3が初期化されていません');
   self.postMessage({state:quality.snapshot()});return;
  }
  const pixels=new Uint8ClampedArray(d.pixels);
  const frame=d.options.conversionMode==='quality'
   ?await quality.convertAccelerated(pixels,d.width,d.height,d.options)
   :rgbaToASCII(pixels,d.width,d.height,d.options);
  self.postMessage({frame,acceleration:d.options.conversionMode==='quality'?quality.acceleration:'CPU'});
 }catch(e){self.postMessage({error:e.message});}
};
