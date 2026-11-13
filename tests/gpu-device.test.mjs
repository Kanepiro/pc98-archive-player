import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectGpuAdapter,requireHardwareAdapter} from '../public/tsl-gpu-device.js';

test('Real GPU vendors are identified without treating WebGPU alone as proof',()=>{
 const intel=inspectGpuAdapter({info:{vendor:'intel',architecture:'gen-12',device:'Intel Graphics'}});
 assert.equal(intel.identified,true);
 assert.equal(intel.software,false);
 assert.equal(intel.vendor,'intel');
 const nvidia=requireHardwareAdapter({info:{vendor:'nvidia',architecture:'turing',device:'GeForce GTX'}});
 assert.equal(nvidia.software,false);
 assert.equal(nvidia.identified,true);
});
test('Software renderers never masquerade as a real GPU',()=>{
 for(const item of [
  {info:{vendor:'google',architecture:'swiftshader'}},
  {info:{vendor:'microsoft',architecture:'WARP'}},
  {info:{vendor:'mesa',description:'llvmpipe rasterizer'}},
  {isFallbackAdapter:true,info:{vendor:'unknown'}}
 ]){
  const result=inspectGpuAdapter(item);
  assert.equal(result.software,true);
  assert.throws(()=>requireHardwareAdapter(item),/ソフトウェアWebGPU/);
 }
});
test('Unknown adapters remain identified as unknown, not as NVIDIA',()=>{
 const result=requireHardwareAdapter({info:{}});
 assert.equal(result.software,false);
 assert.equal(result.identified,false);
 assert.equal(result.name,'機種未識別');
});
