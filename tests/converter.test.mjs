import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTSL,tslFrameAt} from '../public/tsl.js';
import {makePlan,optionsFor,portraitGrid,fitRect,rgbaToASCII,densityRamp,TSLWriter,tslName,CANDIDATE_RAMP,MAX_OUTPUT_BYTES} from '../public/tsl-converter-core.js';

test('60 Hz schedule preserves duration within half a tick and has no cumulative drift',()=>{
 for(const duration of [.001,.1,1,10.01,60.123,600,7200])for(const fps of [5,10,15,24,29.97,30]){
  const p=makePlan(duration,{fps});
  assert.equal(p.steps.reduce((n,s)=>n+s.ticks,0),p.totalTicks);
  assert.ok(Math.abs(p.duration-duration)<=1/60);
  assert.ok(p.steps.every(s=>Number.isInteger(s.ticks)&&s.ticks>=1));
  assert.ok(p.count<=10000);assert.ok(p.estimatedBytes<=MAX_OUTPUT_BYTES);
 }
});
test('long and high-resolution plans reduce FPS within player and memory limits',()=>{
 const p=makePlan(7200,{width:160,height:50,fps:30});
 assert.ok(p.reduced);assert.ok(p.count<10000);assert.equal(p.steps.at(-1).time+p.steps.at(-1).ticks/60,7200);
});
test('aspect fit uses the player cell ratio and contains landscape and portrait video',()=>{
 for(const [w,h]of [[1920,1080],[1080,1920],[640,480]]){
  const r=fitRect(w,h,316,108);
  assert.ok(r.x>=0&&r.y>=0);assert.ok(r.width<=316&&r.height<=108);
  assert.ok(Math.abs(r.width*.5/r.height-w/h)<1e-12);
 }
});
test('luminance averages each cell and maps black to space and white to densest glyph',()=>{
 const pixels=new Uint8ClampedArray(20*10*4*4*4);pixels.fill(255);
 assert.equal(rgbaToASCII(pixels,20,10).split('\r\n')[0],'$'.repeat(20));
 pixels.fill(0);assert.equal(rgbaToASCII(pixels,20,10).split('\r\n')[0],' '.repeat(20));
 for(let i=0;i<pixels.length;i+=4){pixels[i]=pixels[i+1]=pixels[i+2]=128;pixels[i+3]=255;}
 assert.equal(rgbaToASCII(pixels,20,10).split('\r\n')[0],CANDIDATE_RAMP[8].repeat(20));
 assert.equal(rgbaToASCII(pixels,20,10,{brightness:-100}).split('\r\n')[0],' '.repeat(20));
});
test('ramp is ordered by measured glyph density and preserves the original 16 characters',()=>{
 const sorted=densityRamp(c=>-CANDIDATE_RAMP.indexOf(c));
 assert.equal(sorted,[...CANDIDATE_RAMP].reverse().join(''));
});
test('TSL round trip exceeds 300 screens; # at column zero and spaces survive',async()=>{
 const p=makePlan(35.025,{fps:10}),writer=new TSLWriter(p);
 const frame=('#'.repeat(p.width)+'\r\n'+(' '.repeat(p.width)+'\r\n').repeat(p.height-1));
 for(let i=0;i<p.count;i++)writer.append(frame);
 const blob=writer.finish(),bytes=new Uint8Array(await blob.arrayBuffer());
 assert.ok(bytes.every(x=>x<128));assert.equal(bytes.at(-1),26);
 const text=new TextDecoder('shift_jis').decode(bytes),d=parseTSL(text);
 assert.equal(d.version,'1.08');assert.equal(d.frames.length,p.count);assert.ok(p.count>300);
 assert.equal(d.frames[0].split('\n')[0],'#'.repeat(p.width));assert.equal(d.frames[0].split('\n')[1],' '.repeat(p.width));
 assert.ok(Math.abs(d.duration-p.duration)<1e-9);
 for(let i=0;i<p.count;i++)assert.equal(tslFrameAt(d,(p.steps[i].time+(p.steps[i].ticks/120))),i);
});
test('invalid options, duration, pixels and incomplete output fail explicitly',()=>{
 for(const value of [NaN,Infinity,0,-1,7201])assert.throws(()=>makePlan(value));
 for(const input of [{width:0},{height:27.5},{fps:60},{brightness:Infinity},{contrast:0}])assert.throws(()=>optionsFor(input));
 assert.throws(()=>rgbaToASCII(new Uint8ClampedArray(4),79,27));
 assert.throws(()=>new TSLWriter(makePlan(1)).finish(),/不足/);
});
test('download preserves Japanese video name without unsafe path characters',()=>{
 assert.equal(tslName('猫の動画.MP4'),'猫の動画.TSL');
 assert.equal(tslName('a/b.webm'),'a_b.TSL');
});

test('portrait grids use real cell aspect and respect the existing player 100-row limit',()=>{
 assert.deepEqual(portraitGrid(),{width:90,height:80,targetAspect:9/16});
 for(const aspect of [9/16,390/844,9/20,9/21])for(const columns of [60,90,120]){
  const g=portraitGrid(aspect,columns);assert.ok(g.height<=100);
  assert.ok(Math.abs(g.width*.5/g.height-aspect)/aspect<.02);
 }
});
test('cover crop fills portrait output and offers horizontal composition without stretching',()=>{
 const a=fitRect(1920,1080,360,320,.5,'cover',0,.5);
 const b=fitRect(1920,1080,360,320,.5,'cover',1,.5);
 assert.ok(a.width>360);assert.equal(a.height,320);assert.ok(a.x===0);assert.equal(b.x,360-b.width);
 assert.ok(Math.abs(a.width*.5/a.height-1920/1080)<1e-12);
});
test('tall smartphone TSL round trips through the unchanged player',async()=>{
 const grid=portraitGrid(390/844),p=makePlan(1,grid),w=new TSLWriter(p);
 for(let i=0;i<p.count;i++)w.append(('Y'.repeat(p.width)+'\r\n').repeat(p.height));
 const d=parseTSL(await w.finish().text());assert.equal(d.width,grid.width);assert.equal(d.height,grid.height);
});
