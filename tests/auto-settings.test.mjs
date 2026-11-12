import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleLuminanceHistogram,suggestToneSettings} from '../public/tsl-auto-settings.js';

function fixture(width=48,height=24,sample=4,brightnessShift=0){
 const out=new Uint8ClampedArray(width*height*sample*sample*4);
 for(let y=0;y<height*sample;y++)for(let x=0;x<width*sample;x++){
  const n=(y*width*sample+x)*4;
  const lum=Math.max(0,Math.min(255,Math.round(255*x/(width*sample-1)+brightnessShift)));
  out[n]=out[n+1]=out[n+2]=lum;out[n+3]=255;
 }
 return out;
}
test('Offline video estimator histogram counts each full-width dot once',()=>{
 const width=48,height=24,sample=4;
 const hist=sampleLuminanceHistogram(fixture(width,height,sample),width,height,{sample});
 assert.equal(hist.reduce((sum,n)=>sum+n,0),width/2*height);
 assert.ok([...hist].filter(Boolean).length>=20);
 assert.throws(()=>sampleLuminanceHistogram(new Uint8ClampedArray(3),width,height,{sample}),/サイズ/);
});
test('Estimate is deterministic, bounded, and useful for three existing modes',()=>{
 const width=48,height=24,sample=4;
 const frames=[-20,0,20,40].map(x=>sampleLuminanceHistogram(fixture(width,height,sample,x),width,height,{sample}));
 for(const mode of ['legacy','halftone','quality']){
  const a=suggestToneSettings(frames,{mode}),b=suggestToneSettings(frames,{mode});
  assert.deepEqual(a,b);
  assert.equal(a.scenes,4);
  assert.equal(a.limited,false);
  assert.ok(a.brightness>=-25&&a.brightness<=40);
  assert.ok(a.contrast>=.7&&a.contrast<=1.8);
  assert.ok(a.gamma>=.6&&a.gamma<=1.3);
 }
 assert.throws(()=>suggestToneSettings(frames,{mode:'invalid'}),/変換方式/);
});
test('Uniform video does not give a misleading confident adjustment',()=>{
 const hist=new Uint32Array(64);hist[25]=1000;
 const result=suggestToneSettings([hist,hist],{mode:'halftone'});
 assert.deepEqual(result,{brightness:0,contrast:1,gamma:1,scenes:2,limited:true});
 assert.throws(()=>suggestToneSettings([]),/場面/);
});
