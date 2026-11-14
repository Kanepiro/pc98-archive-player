import {rgbaToASCII} from './tsl-converter-core.js';
import {QualityConverter} from './tsl-quality.js';
import {ArtisanComposer} from './tsl-artisan-engine.js';
import {rgbaToHalftone} from './tsl-halftone.js';
let quality=null,tones=null,gpuUnavailableReason='';
self.onmessage=async({data:d})=>{
 try{
  if(d.type==='init'){
   if(d.mode==='legacy'||d.mode==='halftone'){
    tones=null;gpuUnavailableReason='Windowsネイティブ版: モード1・2の専用GPU計算は未実装のためCPU処理';
   }else{
    quality=d.mode==='artisan'?new ArtisanComposer(d.atlas,d.sample):new QualityConverter(d.atlas,d.sample);
    quality.restore(d.state);
    // PC Boost: real Windows DirectCompute D3D11, NOT WebGPU.
    // Fall back to exact C++ CPU when the native GPU is unavailable.
    if(d.mode==='artisan')
     await quality.enablePCBoost(d.width,d.height);
    else quality.gpuError='Windowsネイティブ版: モード3の専用GPU計算は未実装のためCPU処理';
    if(d.mode==='artisan'&&d.exactNative&&d.legacyLayout){quality.fullGpuLayout=null;quality.nativeContour=null;}
   }
   self.postMessage({ready:true,gpuAvailable:!!quality?.gpuMatcher||!!tones});return;
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
    }catch{tones.dispose();tones=null;}
   }
   if(frame===undefined)frame=d.options.conversionMode==='halftone'
    ?rgbaToHalftone(pixels,d.width,d.height,d.options)
    :rgbaToASCII(pixels,d.width,d.height,d.options);
  }
  self.postMessage({frame,acceleration,
   perf:d.options.conversionMode==='artisan'?quality.lastPerf:null,
   adapterInfo:quality?.nativeGpuInfo||quality?.gpuMatcher?.adapterInfo||tones?.adapterInfo||null,
   gpuReason:quality?.gpuError||gpuUnavailableReason||''});
 }catch(e){self.postMessage({error:e.message});}
};
