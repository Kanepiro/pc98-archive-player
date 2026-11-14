import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeLayoutTransfer,residentBytes,RESIDENT_LIMIT} from '../public/tsl-fullgpu-resident.js';
import {packNativeMode4} from '../public/tsl-mode4-native-exact.js';
const atlas=Array.from({length:2},(_,i)=>({char:i?'A':' ',columns:1,shapeSymbol:false,detailPenalty:0,
 orientation:new Float32Array(4),mask:new Float32Array(32),expanded:new Float32Array(32)}));
function input(){
 const n=4*4*4*4,a=()=>Float32Array.from({length:n},(_,i)=>(i%13)/13);
 return {width:4,height:4,S:4,field:{target:a(),importance:a(),dist:a(),gray:a(),faces:[],cut:false},oldGray:a(),oldChars:Array(16).fill('A')};
}
test('resident deltas preserve every original input bit, order and faces across ring wrap',()=>{
 const t=new NativeLayoutTransfer(),p=input();
 for(let f=0;f<24;f++){
  p.field.faces=f%3?[{x:.1,y:.2,w:.4,h:.5}]:[];
  p.field.gray[f]=f/25;p.field.cut=f===14;p.oldGray=f===7?null:input().oldGray;
  const packet=t.pack(p,atlas),u=new Uint32Array(packet.buffer.buffer,0,8);
  assert.equal(u[2],f?2:1);assert.equal(u[4],f);
  const legacy=packNativeMode4(p.field,atlas,4,4,4,p.oldChars,p.oldGray,new Float32Array(16*8));
  const bytes=new Uint8Array(legacy.buffer),n=256;
  if(!f){assert.deepEqual(packet.buffer.subarray(32),bytes);continue;}
  assert.deepEqual(packet.buffer.subarray(32,32+20*n),bytes.subarray(36,36+20*n));
  assert.deepEqual(packet.buffer.subarray(32+20*n),bytes.subarray(36+20*n+16*8*4,36+20*n+16*8*4+16*4+p.field.faces.length*16));
 }
});
test('session restarts for new atlas and explicit job reacquisition',()=>{
 const t=new NativeLayoutTransfer(),p=input();
 assert.equal(t.pack(p,atlas).op,1);assert.equal(t.pack(p,atlas).op,2);
 assert.equal(t.pack(p,[...atlas]).op,1);
 assert.equal(t.pack(p,atlas,true).sequence,0);
});
test('fixed budget uses all ten slots or the same-quality legacy path',()=>{
 assert.ok(residentBytes(240,67,6)<=RESIDENT_LIMIT);
 assert.ok(residentBytes(480,135,6)>RESIDENT_LIMIT);
 const t=new NativeLayoutTransfer(false),p=input();
 assert.equal(t.pack(p,atlas).op,3);assert.equal(t.pack(p,atlas).op,3);
});

test('previous GPU state is reused only with the exact acknowledged frame references',()=>{
 const t=new NativeLayoutTransfer(),p=input();t.pack(p,atlas);
 const chars=Array(16).fill('A');t.record(p,chars,true);
 const next={...input(),oldGray:p.field.gray,oldChars:chars};
 assert.equal(t.pack(next,atlas).op,4);
 assert.equal(t.pack({...next,oldChars:[...chars]},atlas).op,2);
 t.record(p,chars,false);assert.equal(t.pack(next,atlas).op,2);
});
