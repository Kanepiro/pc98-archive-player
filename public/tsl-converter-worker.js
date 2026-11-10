import {rgbaToASCII} from './tsl-converter-core.js';
import {QualityConverter} from './tsl-quality.js';
let quality=null;
self.onmessage=({data:d})=>{
 try{
  if(d.type==='init'){
   quality=new QualityConverter(d.atlas,d.sample);
   quality.restore(d.state);
   self.postMessage({ready:true});return;
  }
  if(d.type==='snapshot'){
   if(!quality)throw Error('モード3が初期化されていません');
   self.postMessage({state:quality.snapshot()});return;
  }
  const pixels=new Uint8ClampedArray(d.pixels);
  const frame=d.options.conversionMode==='quality'
   ?quality.convert(pixels,d.width,d.height,d.options)
   :rgbaToASCII(pixels,d.width,d.height,d.options);
  self.postMessage({frame});
 }catch(e){self.postMessage({error:e.message});}
};
