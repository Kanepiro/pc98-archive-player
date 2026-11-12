import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTSL,tslFrameAt} from '../public/tsl.js';
import {makePlan,optionsFor,portraitGrid,portraitGridForPixels,landscapeGridForPixels,native16PortraitGrid,native16LandscapeGrid,fitRect,rgbaToASCII,densityRamp,TSLWriter,tslName,CANDIDATE_RAMP,MAX_OUTPUT_BYTES} from '../public/tsl-converter-core.js';

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

test('Portrait font pixel control computes a full-HD-equivalent character grid',()=>{
 assert.deepEqual(portraitGridForPixels(),portraitGrid(9/16,75));
 assert.deepEqual(portraitGridForPixels(9/16,24),portraitGrid(9/16,75));
 assert.deepEqual(portraitGridForPixels(9/16,20),portraitGrid(9/16,90));
 assert.deepEqual(portraitGridForPixels(9/16,40),portraitGrid(9/16,45));
 assert.deepEqual(portraitGridForPixels(9/16,64),portraitGrid(9/16,28));
 assert.deepEqual(portraitGridForPixels(9/16,128),portraitGrid(9/16,14));
 assert.deepEqual(portraitGridForPixels(9/16,192),portraitGrid(9/16,9));
 assert.deepEqual(portraitGridForPixels(9/16,256),portraitGrid(9/16,7));
 for(const aspect of [9/16,390/844,9/20,9/21,.25,1]){
  let prev=Infinity;
  for(const px of [16,20,24,32,40,48,64,96,128,192,256]){
   const g=portraitGridForPixels(aspect,px);
   assert.ok(g.width<=prev,'Larger glyphs should reduce columns');
   assert.ok(g.width<=160&&g.height<=100&&g.width>=4&&g.height>=4);
   assert.ok(Math.abs(g.width*.5/g.height-aspect)/aspect<.15);
   prev=g.width;
  }
 }
 for(const px of [0,15,257,Infinity,32.5,NaN])assert.throws(()=>portraitGridForPixels(9/16,px));
});

test('landscape 16:9 font grids keep characters upright at approximately Full-HD cell size',async()=>{
 const expected={width:128,height:36,targetAspect:16/9};
 assert.deepEqual(landscapeGridForPixels(24),expected);
 const values=[16,20,24,28,32,40,48,64,96,128,192,256];
 let last=Infinity;
 for(const px of values){
  const grid=landscapeGridForPixels(px);
  assert.ok(grid.width>=4&&grid.width<=160);
  assert.ok(grid.height>=4&&grid.height<=100);
  assert.ok(grid.width<=last,'larger font size cannot increase grid columns');
  assert.ok(Math.abs(grid.width*.5/grid.height/(16/9)-1)<.02,'cell aspect remains within 2% of 16:9');
  last=grid.width;
 }
 for(const px of [0,15,257,NaN,Infinity,24.1])assert.throws(()=>landscapeGridForPixels(px));
 const plan=makePlan(1.25,{...expected,fps:24}),writer=new TSLWriter(plan);
 const row='Y'.repeat(plan.width)+'\r\n';
 for(let i=0;i<plan.count;i++)writer.append(row.repeat(plan.height));
 const decoded=parseTSL(await writer.finish().text());
 assert.equal(decoded.width,128);
 assert.equal(decoded.height,36);
 assert.equal(decoded.frames.length,plan.count);
 const rect=fitRect(1920,1080,128*4,36*4,.5,'cover');
 assert.ok(Math.abs(rect.width-512)<1e-9);
 assert.ok(Math.abs(rect.height-144)<1e-9);
});

test('gamma lifts dark details without clipping endpoints',()=>{
 const width=4,height=4,sample=4,pixels=new Uint8ClampedArray(width*height*sample*sample*4);
 for(let y=0;y<height*sample;y++)for(let x=0;x<width*sample;x++){
  const i=(y*width*sample+x)*4,v=[0,20,45,255][Math.floor(x/sample)];
  pixels[i]=pixels[i+1]=pixels[i+2]=v;pixels[i+3]=255;
 }
 const base=rgbaToASCII(pixels,width,height,{gamma:1,edge:0}).split('\r\n')[0];
 const lifted=rgbaToASCII(pixels,width,height,{gamma:.7,edge:0}).split('\r\n')[0];
 assert.equal(lifted[0],' ');assert.equal(lifted[3],'$');
 assert.ok(CANDIDATE_RAMP.indexOf(lifted[1])>CANDIDATE_RAMP.indexOf(base[1]));
 assert.ok(CANDIDATE_RAMP.indexOf(lifted[2])>CANDIDATE_RAMP.indexOf(base[2]));
});
test('color edge aid separates red and green with nearly identical luminance',()=>{
 const width=4,height=4,sample=4,pixels=new Uint8ClampedArray(width*height*sample*sample*4);
 for(let y=0;y<height*sample;y++)for(let x=0;x<width*sample;x++){
  const i=(y*width*sample+x)*4,green=Math.floor(x/sample)%2===1;
  pixels[i]=green?0:255;pixels[i+1]=green?76:0;pixels[i+2]=0;pixels[i+3]=255;
 }
 const base=rgbaToASCII(pixels,width,height,{gamma:1,edge:0}).split('\r\n')[0];
 const outlined=rgbaToASCII(pixels,width,height,{gamma:1,edge:1}).split('\r\n')[0];
 assert.equal(base[0],base[1],'the two colors have the same perceptual luminance');
 assert.notEqual(outlined[0],outlined[1],'a color boundary becomes visibly distinguishable');
});
test('gamma and edge inputs validate their limits',()=>{
 for(const v of [-1,0,.39,2.51,NaN,Infinity])assert.throws(()=>optionsFor({gamma:v}));
 for(const v of [-.1,1.1,NaN,Infinity])assert.throws(()=>optionsFor({edge:v}));
 const pixels=new Uint8ClampedArray(4*4*4*4);
 assert.throws(()=>rgbaToASCII(pixels,4,4,{gamma:0}));
});

test('color edges are darkened instead of lost in a bright background',()=>{
 const width=4,height=4,sample=4,pixels=new Uint8ClampedArray(width*height*sample*sample*4);
 for(let y=0;y<height*sample;y++)for(let x=0;x<width*sample;x++){
  const i=(y*width*sample+x)*4,alternate=Math.floor(x/sample)%2===1;
  const color=alternate?[150,255,180]:[255,230,120];
  pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];pixels[i+3]=255;
 }
 const base=rgbaToASCII(pixels,width,height,{gamma:1,edge:0}).split('\r\n')[0];
 const outlined=rgbaToASCII(pixels,width,height,{gamma:1,edge:1}).split('\r\n')[0];
 assert.equal(base[0],base[1],'bright colors with near-equal luminance must match without contour');
 assert.notEqual(outlined[0],outlined[1],'the colored shape must remain visible on bright background');
 assert.ok(CANDIDATE_RAMP.indexOf(outlined[1])<CANDIDATE_RAMP.indexOf(base[1]),'edge is darkened, not whitened');
});


test('Dedicated PC-98 16x16 menu adds native pixel cells without altering legacy 16px layout',async()=>{
 assert.deepEqual(landscapeGridForPixels(16),{width:160,height:45,targetAspect:16/9});
 assert.deepEqual(portraitGridForPixels(9/16,16),portraitGrid(9/16,113));
 assert.deepEqual(native16LandscapeGrid(),{width:240,height:67,targetAspect:16/9});
 assert.deepEqual(native16PortraitGrid(),{width:135,height:120,targetAspect:9/16});
 assert.deepEqual(native16PortraitGrid(.5),{width:120,height:120,targetAspect:.5});
 assert.throws(()=>native16PortraitGrid(3),/比率/);
 assert.throws(()=>makePlan(1,{width:240,height:67,fps:24}),/範囲外/);
 assert.throws(()=>makePlan(1,{width:135,height:120,fps:24}),/範囲外/);
 const plan=makePlan(1,{width:240,height:67,fps:24,native16:true,conversionMode:'halftone'});
 const wr=new TSLWriter(plan);
 const row='◎'.repeat(120)+'\r\n';
 for(let i=0;i<plan.count;i++)wr.append(row.repeat(plan.height));
 const decoded=new TextDecoder('shift_jis').decode(await wr.finish().arrayBuffer());
 assert.ok(decoded.includes('# PC98_FONT_16X16'));
 const data=parseTSL(decoded);
 assert.equal(data.native16,true);
 assert.equal(data.width,240);
 assert.equal(data.height,67);
 const standard=makePlan(1,{width:160,height:45,fps:10,conversionMode:'halftone'}),classic=new TSLWriter(standard);
 for(let i=0;i<standard.count;i++)classic.append(('◎'.repeat(80)+'\r\n').repeat(45));
 const old=parseTSL(new TextDecoder('shift_jis').decode(await classic.finish().arrayBuffer()));
 assert.equal(old.native16,false);
 assert.equal(old.width,160);
});
