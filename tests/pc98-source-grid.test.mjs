import test from 'node:test';
import assert from 'node:assert/strict';
import {pc98GridFromPixels,pc98SourceDrawRect,makePlan,TSLWriter} from '../public/tsl-converter-core.js';
import {parseTSL} from '../public/tsl.js';

test('PC-98 source-sized grid uses 16-dot fullwidth / 8-dot halfwidth exactly',()=>{
 const examples=[
  [640,400,40,25,80,0,0],
  [1280,720,80,45,160,0,0],
  [1920,1080,120,67,240,0,8],
  [1080,1920,67,120,134,8,0],
  [3840,2160,240,135,480,0,0],
  [2160,3840,135,240,270,0,0],
  [640,480,40,30,80,0,0]
 ];
 for(const [w,h,fullwidth,rows,columns,extraX,extraY] of examples){
  const grid=pc98GridFromPixels(w,h);
  assert.deepEqual([grid.fullwidth,grid.height,grid.width,
   grid.remainingWidth,grid.remainingHeight],[fullwidth,rows,columns,extraX,extraY],
   w+'x'+h);
  assert.equal(grid.width*8,grid.usedWidth);
  assert.equal(grid.height*16,grid.usedHeight);
 }
});
test('Native video-grid TSL headers are halfwidth columns, not fullwidth characters',async()=>{
 for(const [w,h] of [[640,400],[1920,1080],[3840,2160]]){
  const grid=pc98GridFromPixels(w,h);
  const p=makePlan(.1,{width:grid.width,height:grid.height,native16:true,fps:5,
   conversionMode:'halftone'}),writer=new TSLWriter(p);
  const line='　'.repeat(grid.fullwidth);
  writer.append((line+'\r\n').repeat(grid.height));
  const tsl=parseTSL(new TextDecoder('shift_jis').decode(await writer.finish().arrayBuffer()));
  assert.deepEqual([tsl.width,tsl.height,tsl.native16],[grid.width,grid.height,true]);
 }
});
test('Unsupported tiny images and out-of-4K source dimensions fail rather than shrink without asking',()=>{
 for(const [w,h] of [[0,480],[31,400],[1920,63],[3841,2160],[1920,4000],
  [1920.5,1080],[NaN,1080]]){
  assert.throws(()=>pc98GridFromPixels(w,h),/解像度|文字数/);
 }
});


test('PC-98 rendering crops only non-16-dot edge fragments at native pixel geometry',()=>{
 const hd=pc98SourceDrawRect(1920,1080,2400,670);
 assert.equal(hd.x,0);assert.equal(hd.width,2400);
 assert.ok(Math.abs(hd.y+2.5)<1e-10);
 assert.ok(Math.abs(hd.height-675)<1e-10);
 const native=pc98SourceDrawRect(640,400,800,250);
 assert.deepEqual(native,{x:0,y:0,width:800,height:250});
 const off=pc98SourceDrawRect(1080,1920,1340,1200);
 assert.equal(off.y,0);assert.ok(off.x<0);
 assert.throws(()=>pc98SourceDrawRect(1920,1080,2400,670,2,.5),/位置/);
});
