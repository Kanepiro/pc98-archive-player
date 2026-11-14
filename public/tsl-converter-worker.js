import {rgbaToASCII} from './tsl-converter-core.js';
import {QualityConverter} from './tsl-quality.js';
import {ArtisanComposer} from './tsl-artisan-engine.js';
import {rgbaToHalftone} from './tsl-halftone.js';
import {NativeModeConverter} from './tsl-native-modes.js';
let quality=null,tones=null,gpuUnavailableReason='';
self.onmessage=async({data:d})=>{
 try{
  if(d.type==='init'){
   if(d.mode==='legacy'||d.mode==='halftone'){
    tones=null;gpuUnavailableReason='';
    try{tones=await NativeModeConverter.create(d.mode==='legacy'?1:2,d.sample,d.width,d.height);}catch(e){gpuUnavailableReason=String(e);}
   }else{
    quality=d.mode==='artisan'?new ArtisanComposer(d.atlas,d.sample):new QualityConverter(d.atlas,d.sample);
    quality.restore(d.state);
    // PC Boost: real Windows DirectCompute D3D11, NOT WebGPU.
    // Fall back to exact C++ CPU when the native GPU is unavailable.
    if(d.mode==='artisan')
     await quality.enablePCBoost(d.width,d.height);
    else await quality.enableNativeGPU(d.width,d.height);
    if(d.mode==='artisan'&&d.exactNative&&d.legacyLayout){quality.fullGpuLayout=null;quality.nativeContour=null;}
   }
   self.postMessage({ready:true,gpuAvailable:!!quality?.nativeMode||!!quality?.gpuMatcher||!!tones});return;
  }
  if(d.type==='snapshot'){
   if(!quality)throw Error('モード3が初期化されていません');
   self.postMessage({state:quality.snapshot()});return;
  }
  const pixels=new Uint8ClampedArray(d.pixels);
  let frame,acceleration='CPU';
  if(['artisan','quality'].includes(d.options.conversionMode)){
   frame=await quality.convertAccelerated(pixels,d.width,d.height,d.options);
   acceleration=quality.acceleration;
  }else{
   if(tones){
    try{
     frame=await tones.convert(pixels,d.options);
     acceleration=tones.acceleration;
    }catch(e){gpuUnavailableReason=String(e);tones.dispose();tones=null;}
   }
   if(frame===undefined)frame=d.options.conversionMode==='halftone'
    ?rgbaToHalftone(pixels,d.width,d.height,d.options)
    :rgbaToASCII(pixels,d.width,d.height,d.options);
  }
  self.postMessage({frame,acceleration,
   perf:quality?.lastPerf||tones?.lastPerf||null,
   adapterInfo:quality?.nativeGpuInfo||quality?.gpuMatcher?.adapterInfo||tones?.adapterInfo||null,
   gpuReason:quality?.gpuError||gpuUnavailableReason||''});
 }catch(e){self.postMessage({error:e.message});}
};
