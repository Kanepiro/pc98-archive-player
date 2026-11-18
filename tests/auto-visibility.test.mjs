import test from 'node:test';
import assert from 'node:assert/strict';
import {detectActiveBounds,shortlist,selectScenes,chooseResult,scoreContour,scoreTones,AUTO_LIMITS,activeMask} from '../public/tsl-auto-visibility.js';
import {analysisGeometry} from '../public/tsl-auto-settings.js';
import {fitRect,pc98GridFromPixels,pc98SourceDrawRect} from '../public/tsl-converter-core.js';
function image(w=64,h=40,shift=0){
 const gray=Float32Array.from({length:w*h},(_,i)=>Math.max(0,Math.min(1,.12+.65*(i%w)/(w-1)+shift+.08*Math.sin((i/w|0)/3))));
 return {gray,w,h};
}
test('Persistent bars are excluded, changing image edges are retained',()=>{
 const frames=[image(),image(64,40,.08),image(64,40,-.07)];
 for(const f of frames)for(let y=0;y<5;y++)for(let x=0;x<64;x++)f.gray[y*64+x]=f.gray[(39-y)*64+x]=0;
 assert.deepEqual(detectActiveBounds(frames,64,40),{left:0,top:.125,right:1,bottom:.875});
 frames[1].gray[0]=.8;assert.equal(detectActiveBounds(frames,64,40).top,0);
});
test('Analysis stays bounded and retains dark, bright, and neutral options',()=>{
 const frames=[-.1,0,.1,.18,-.17,.04,.07,-.02].map(s=>image(64,40,s)),bounds=detectActiveBounds(frames,64,40);
 const a=shortlist(frames,'artisan',bounds),b=shortlist(frames,'artisan',bounds);
 assert.deepEqual(a,b);assert.ok(a.primaryCount<=AUTO_LIMITS.primary);assert.ok(a.candidates.length<=6);
 assert.deepEqual(a.candidates[0].settings,{brightness:0,contrast:1,gamma:1});
 const scenes=selectScenes(frames,bounds);assert.equal(scenes.length,5);assert.ok(scenes.includes(3)&&scenes.includes(4));
});
test('One damaged scene vetoes average improvement',()=>{
 const neutral={settings:{brightness:0,contrast:1,gamma:1},metrics:[.5,.5,.5,.5,.5].map(score=>({score}))};
 const risky={settings:{brightness:10,contrast:1.7,gamma:1},metrics:[.95,.95,.95,.95,.40].map(score=>({score}))};
 assert.deepEqual(chooseResult([neutral,risky]).settings,neutral.settings);
 const useful={settings:{brightness:0,contrast:1.1,gamma:1},metrics:[.56,.55,.53,.56,.55].map(score=>({score}))};
 assert.deepEqual(chooseResult([neutral,useful]).settings,useful.settings);
});
test('Contour metric rejects empty, cluttered, displaced and broken shapes',()=>{
 const w=60,h=40,edges=new Uint8Array(w*h),chain=[];
 for(let x=8;x<52;x++){edges[20*w+x]=1;chain.push(20*w+x);}
 const ref={w,h,edges,chains:[chain],valid:new Uint8Array(w*h).fill(1)};
 const intact=Float32Array.from(edges),blank=new Float32Array(w*h),clutter=new Float32Array(w*h).fill(1),shifted=new Float32Array(w*h),broken=Float32Array.from(edges,(v,i)=>i%5<2?v:0);
 for(const i of chain)shifted[i+6*w]=1;
 const good=scoreContour(ref,intact,.1).score;
 for(const candidate of [blank,clutter,shifted,broken])assert.ok(good>scoreContour(ref,candidate,.1).score);
});
test('Mode 2 evaluates real light-to-dark ordering, without inversion',()=>{
 const f=image(50,20),ref={...f,valid:activeMask(50,20)},levels=Array.from(f.gray,v=>Math.round(v*4)/4);
 assert.ok(scoreTones(ref,levels,5).score>scoreTones(ref,levels.map(v=>1-v),5).score);
});
test('Geometry exactly follows converter framing for four aspect presets and PC98',()=>{
 for(const [ow,oh] of [[1080,1920],[1440,1920],[1920,1080],[1440,1080]]){
  const g=analysisGeometry(1080,1920,{mode:'artisan',width:36,height:32,outputWidth:ow,outputHeight:oh,fit:'contain',positionX:.2,positionY:.7});
  assert.equal(g.pw,ow);assert.equal(g.ph,oh);assert.deepEqual(g.rect,fitRect(1080,1920,ow,oh,1,'contain',.2,.7));
 }
 const grid=pc98GridFromPixels(1920,1080),g=analysisGeometry(1920,1080,{mode:'quality',width:80,height:45,sourceGrid:true,positionX:.2,positionY:.7});
 assert.equal(g.width,grid.width);assert.equal(g.height,grid.height);assert.deepEqual(g.rect,pc98SourceDrawRect(1920,1080,g.pw,g.ph,.2,.7));
 const m4=analysisGeometry(1081,1919,{mode:'artisan',width:36,height:32});
 assert.equal(m4.pw,1140);assert.equal(m4.ph,1920);assert.equal(m4.rect.width,1081);
});

test('Pale scenes retain a strong tone candidate for actual glyph evaluation',()=>{
 const f={w:64,h:40,gray:Float32Array.from({length:2560},(_,i)=>.86+.13*(i%64)/63)};
 const result=shortlist([f],'artisan');
 assert.ok(result.candidates.some(c=>c.settings.brightness<=-20));
 assert.equal(result.histogramCandidates,2520);
});
