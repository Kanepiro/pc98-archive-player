import test from'node:test';import assert from'node:assert/strict';import{gaussianFrame,gaussianHalfFrame}from'../public/tsl-mode4-grid60.js';
function reference(src,w,h,sigma){const b=gaussianFrame(src,w,h,sigma),out=new Float32Array(w*h/4);for(let y=0;y<h/2;y++)for(let x=0;x<w/2;x++){const i=y*2*w+x*2;out[y*w/2+x]=(b[i]+b[i+1]+b[i+w]+b[i+w+1])*.25;}return out;}
test('fused Gaussian retains source-pixel sigma and replicated boundaries',()=>{
let seed=73;
for(const[w,h]of[[2,2],[12,8],[60,120],[120,60]])for(const sigma of[0,.9,4,8,24])for(const pattern of['constant','random','corner']){
const src=Float32Array.from({length:w*h},(_,i)=>pattern==='constant'?.42:pattern==='corner'?(i===0?1:0):((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296));
const a=gaussianHalfFrame(src,w,h,sigma),b=reference(src,w,h,sigma);assert.equal(a.length,w*h/4);
for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<=1.2e-7,[w,h,sigma,pattern,i,a[i],b[i]].join(','));
}
assert.throws(()=>gaussianHalfFrame(new Float32Array(9),3,3,8));assert.throws(()=>gaussianHalfFrame(new Float32Array(4),2,2,Infinity));
});
