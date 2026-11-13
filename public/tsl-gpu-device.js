// Browser WebGPU can silently select a software renderer (SwiftShader/WARP).
// A WebGPU API being present does NOT prove dedicated GPU compute.
export function inspectGpuAdapter(adapter){
 const info=adapter?.info||{};
 const parts=[info.vendor,info.architecture,info.device].filter(Boolean);
 const details=[...parts,info.description].filter(Boolean).join(' / ');
 const software=adapter?.isFallbackAdapter===true||
  /swiftshader|llvmpipe|softpipe|software raster|microsoft basic render|\bwarp\b/i.test(details);
 return {
  name:parts.join(' / ')||'機種未識別',
  vendor:info.vendor||'',
  architecture:info.architecture||'',
  software,identified:parts.length>0,
  description:info.description||''
 };
}
export function requireHardwareAdapter(adapter){
 const info=inspectGpuAdapter(adapter);
 if(info.software)throw Error('ソフトウェアWebGPU（'+info.name+'）は使用せずCPUで処理します');
 return info;
}
