import test from 'node:test';
import assert from 'node:assert/strict';
import {frameRequestTime,verifyDecodedFrame} from '../public/video-frame-timing.js';
test('reject a decoder stuck at the earlier picture even when requested time advances',()=>{
 assert.throws(()=>verifyDecodedFrame({timestamp:18.6,duration:1/24},60),/古い絵/);
 assert.throws(()=>verifyDecodedFrame({timestamp:57.56,duration:1/24},247),/古い絵/);
});
test('allow genuine long still frames, 24-to-30 sampling and audio-only tail',()=>{
 const frame={timestamp:18,duration:5};assert.equal(verifyDecodedFrame(frame,22.9),18);
 assert.equal(verifyDecodedFrame({timestamp:0,duration:1/24},1/30),0);
 const t=frameRequestTime(247.76,0,247.708333);
 assert.ok(t<247.708333);
 assert.equal(verifyDecodedFrame({timestamp:247.666666,duration:1/24},t),247.666666);
});
test('reject nonfinite, backwards, future and missing decoded frames',()=>{
 for(const f of [null,{timestamp:NaN,duration:1},{timestamp:2,duration:0},{timestamp:3,duration:1}])
  assert.throws(()=>verifyDecodedFrame(f,2));
 assert.throws(()=>verifyDecodedFrame({timestamp:1,duration:10},3,2));
 assert.throws(()=>frameRequestTime(0,0,NaN));
});
