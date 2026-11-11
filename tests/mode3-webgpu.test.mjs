import test from 'node:test';
import assert from 'node:assert/strict';
import {QualityConverter,qualityCpuDots} from '../public/tsl-quality.js';

const S=4,W=16,H=12;
const atlas=[
 {char:' ',columns:1,mask:new Float32Array(S*S)},
 {char:'#',columns:1,mask:new Float32Array(S*S).fill(1)},
 {char:'／',columns:2,mask:new Float32Array(S*S*2).fill(.35)}
];
function pixels(){
 const a=new Uint8ClampedArray(W*H*S*S*4);
 for(let y=0;y<H*S;y++)for(let x=0;x<W*S;x++){
  const p=(y*W*S+x)*4;
  a[p]=(x*7+y*11)%256;a[p+1]=(x*13)%256;
  a[p+2]=(y*17)%256;a[p+3]=255;
 }
 return a;
}
test('GPU dot result is accepted by the unchanged layout when numerically identical',async()=>{
 const cpu=new QualityConverter(atlas,S);
 const gpu=new QualityConverter(atlas,S);
 gpu.gpuMatcher={compute:async target=>new Float32Array(qualityCpuDots(target,W,H,S,gpu.atlas)),dispose:()=>{}};
 gpu.gpuBenchmarked=true;gpu.acceleration='WebGPU';
 const a=cpu.convert(pixels(),W,H),b=await gpu.convertAccelerated(pixels(),W,H);
 assert.equal(a,b);
 assert.equal(gpu.acceleration,'WebGPU');
});
test('GPU computation failure falls back to CPU without changing a frame',async()=>{
 const cpu=new QualityConverter(atlas,S),gpu=new QualityConverter(atlas,S);
 let disposed=false;
 gpu.gpuMatcher={compute:async()=>{throw Error('device lost')},dispose:()=>{disposed=true}};
 const a=cpu.convert(pixels(),W,H),b=await gpu.convertAccelerated(pixels(),W,H);
 assert.equal(a,b);
 assert.equal(gpu.acceleration,'CPU');
 assert.ok(disposed);
 assert.equal(gpu.gpuMatcher,null);
});
test('no GPU path retains existing synchronous rendering',async()=>{
 const cpu=new QualityConverter(atlas,S),auto=new QualityConverter(atlas,S);
 assert.equal(cpu.convert(pixels(),W,H),await auto.convertAccelerated(pixels(),W,H));
});
