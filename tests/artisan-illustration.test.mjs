import test from 'node:test';
import assert from 'node:assert/strict';
import {guideArtisanFaces,artisanFaceGpuCommands} from '../public/tsl-artisan-portrait.js';
import {rasterizeArtisanRows,criticizeArtisanRows} from '../public/tsl-artisan-critic.js';
import {makeArtisanGeometry} from '../public/tsl-artisan-engine.js';

test('Face recognition preserves every source contour and creates no template strokes',()=>{
 const w=100,h=80,n=w*h;
 const target=Float32Array.from({length:n},(_,i)=>i%13===0?.9:i%7===0?.3:0);
 const importance=new Float32Array(n).fill(2);
 const structure={target,importance};
 const face={kind:'face',confidence:.95,x:.28,y:.15,w:.45,h:.62,landmarks:[
  {x:.42,y:.38},{x:.60,y:.38},{x:.51,y:.49},{x:.51,y:.62}
 ]};
 const before=Float32Array.from(target);
 const guided=guideArtisanFaces({w,h,target},structure,[face]);
 assert.equal(guided.faceGuides,0);
 assert.deepEqual(guided.target,before);
 assert.deepEqual(target,before);
 assert.deepEqual(guided.importance,importance);
 const empty={target:new Float32Array(n),importance:new Float32Array(n)};
 assert.ok(guideArtisanFaces({w,h},empty,[face]).target.every(v=>v===0),'invented a face on blank pixels');
 assert.deepEqual(artisanFaceGpuCommands({w,h},structure,[face]),{commands:[],faceGuides:0});
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

import {parseArtisanStructure} from '../public/tsl-artisan-structure.js';
test('A detected face does not erase long body or background contours',()=>{
 const w=96,h=64,target=new Float32Array(w*h);
 for(let y=3;y<h-3;y++)target[y*w+4]=.9;
 for(let x=3;x<w-3;x++)target[(h-5)*w+x]=.9;
 const face={kind:'face',confidence:.99,x:.65,y:.1,w:.15,h:.2,importance:2.6,landmarks:[]};
 const result=parseArtisanStructure({w,h,target},[face]);
 assert.ok(result.target[20*w+4]>.8,'body/background contour erased');
 assert.ok(result.target[(h-5)*w+45]>.8,'moving arm/ground contour erased');
 assert.ok(result.importance[20*w+4]>=.7);
});
