import test from 'node:test';
import assert from 'node:assert/strict';
import {guideArtisanFaces} from '../public/tsl-artisan-portrait.js';
import {rasterizeArtisanRows,criticizeArtisanRows} from '../public/tsl-artisan-critic.js';
import {makeArtisanGeometry} from '../public/tsl-artisan-engine.js';

test('Detected face removes photographic face texture and draws landmark-guided strokes',()=>{
 const w=100,h=80,n=w*h;
 const field={w,h,target:new Float32Array(n)};
 field.target.fill(.7);
 const structure={target:Float32Array.from(field.target),importance:new Float32Array(n).fill(2)};
 const face={kind:'face',confidence:.95,x:.28,y:.15,w:.45,h:.62,landmarks:[
  {x:.42,y:.38},{x:.60,y:.38},{x:.51,y:.49},{x:.51,y:.62},
  {x:.28,y:.49},{x:.72,y:.49}
 ]};
 const guided=guideArtisanFaces(field,structure,[face]);
 assert.equal(guided.faceGuides,1);
 const eye=Math.floor(.38*h)*w+Math.floor(.42*w);
 const interior=Math.floor(.47*h)*w+Math.floor(.47*w);
 assert.ok(guided.target[eye]>.68,'eye stroke lost');
 assert.ok(guided.target[interior]<.7,'no internal texture simplification');
 assert.ok(Math.abs(guided.target[0]-.7)<1e-6,'background unexpectedly modified');
 const absent=guideArtisanFaces(field,structure,[]);
 assert.equal(absent.faceGuides,0);
 assert.ok(Math.abs(absent.target[eye]-.7)<1e-6);
});
test('Exact restored glyph composition is rated in image space without changing width',()=>{
 const S=6,width=4,atlas=makeArtisanGeometry([
  {char:' ',columns:1,mask:new Float32Array(S*S)},
  {char:'─',columns:2,mask:Float32Array.from({length:2*S*S},(_,i)=>
   Math.floor(i/(2*S))===3?1:0)}
 ],S);
 const rows=[[{x:0,j:1},{x:2,j:1}],
  [{x:0,j:0},{x:1,j:0},{x:2,j:0},{x:3,j:0}]];
 const {ink,w,h}=rasterizeArtisanRows(rows,atlas,width,S);
 assert.equal(w,24);assert.equal(h,12);
 assert.ok(ink.some(v=>v>0));
 const field={w,h,target:Float32Array.from(ink),
  importance:new Float32Array(ink.length).fill(1),
  dist:new Float32Array(ink.length)};
 const critic=criticizeArtisanRows(rows,atlas,width,S,
  new Float32Array(2*width*atlas.length),
  {horiz:new Float32Array(2*(width+1)*S),vert:new Float32Array(3*width*S)},
  field,()=>({total:0}));
 assert.equal(critic.missing,0);
 assert.ok(critic.total>=0);
});
