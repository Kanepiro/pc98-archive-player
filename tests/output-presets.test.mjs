import test from 'node:test';
import assert from 'node:assert/strict';
import {outputPreset,presetGrid,validateOutputSize} from '../public/tsl-output-presets.js';
import {makePlan,TSLWriter,fitRect,portraitGridForPixels,landscapeGridForPixels,native16PortraitGrid,native16LandscapeGrid} from '../public/tsl-converter-core.js';
import {mode4Grid} from '../public/tsl-mode4-grid60.js';
import {parseTSL} from '../public/tsl.js';

test('4:3 presets preserve exact cell aspect for every supported font size',()=>{
 for(const mode of ['portrait-3x4','landscape-4x3'])for(const native16 of [false,true])for(let px=16;px<=256;px++){
  const g=presetGrid(mode,px,native16),p=outputPreset(mode);
  assert.equal(g.width*.5/g.height,p.outputWidth/p.outputHeight);
  assert.ok(g.width>=4&&g.width<=(native16?480:160)&&g.height>=4&&g.height<=(native16?240:100));
  const rect=fitRect(p.outputWidth,p.outputHeight,g.width*4,g.height*4,.5,'contain');
  assert.ok(Math.abs(rect.x)<1e-10&&Math.abs(rect.y)<1e-10,'matching source has no added letterbox');
 }
});
test('mode 4 presets are complete 60px cells and contain does not crop',()=>{
 for(const mode of ['portrait-3x4','landscape-4x3']){
  const p=outputPreset(mode),g=mode4Grid(p.outputWidth,p.outputHeight);
  assert.equal(g.pixelWidth,p.outputWidth);assert.equal(g.pixelHeight,p.outputHeight);
  assert.equal(g.columns*g.height,432);
  const rect=fitRect(1920,1080,g.pixelWidth,g.pixelHeight,1,'contain');
  assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=g.pixelWidth&&rect.y+rect.height<=g.pixelHeight);
  assert.equal(rect.width/rect.height,1920/1080);
 }
});
test('ordinary TSL comments roundtrip output geometry without changing timing or characters',async()=>{
 for(const mode of ['portrait-3x4','landscape-4x3']){
  const g=presetGrid(mode),plan=makePlan(1.037,{...g,fps:24});
  const old=makePlan(1.037,{width:g.width,height:g.height,fps:24});
  assert.deepEqual(plan.steps,old.steps);assert.equal(plan.count,old.count);
  const writer=new TSLWriter(plan),legacyWriter=new TSLWriter(old),frame=('#'.repeat(g.width)+'\r\n').repeat(g.height);
  for(let i=0;i<plan.count;i++){writer.append(frame);legacyWriter.append(frame);}
  const text=new TextDecoder('shift_jis').decode(await writer.finish().arrayBuffer());
  const parsed=parseTSL(text),legacy=parseTSL(new TextDecoder('shift_jis').decode(await legacyWriter.finish().arrayBuffer()));
  assert.equal(parsed.outputWidth,g.outputWidth);assert.equal(parsed.outputHeight,g.outputHeight);
  assert.deepEqual(parsed.schedule,legacy.schedule);assert.deepEqual(parsed.frames,legacy.frames);
  assert.deepEqual(parseTSL(text.replace(/^# TASL_OUTPUT_SIZE.*\r\n/m,'')),legacy,'old players can ignore the optional comment');
 }
});
test('unsupported requested resolution is rejected, and legacy preset geometry is unchanged',()=>{
 assert.throws(()=>validateOutputSize(720,960));assert.throws(()=>validateOutputSize(1440,1440));
 assert.throws(()=>makePlan(1,{outputWidth:1080,outputHeight:1920}));
 assert.equal(outputPreset('portrait'),null);
 assert.deepEqual(portraitGridForPixels(),{width:75,height:67,targetAspect:9/16});
 assert.deepEqual(landscapeGridForPixels(),{width:128,height:36,targetAspect:16/9});
 assert.deepEqual(native16PortraitGrid(),{width:135,height:120,targetAspect:9/16});
 assert.deepEqual(native16LandscapeGrid(),{width:240,height:67,targetAspect:16/9});
});

test('fixed-resolution presets reject excessive frame counts instead of lowering fps',()=>{
 for(const preset of ['portrait-3x4','landscape-4x3']) assert.throws(()=>makePlan(600,{...presetGrid(preset),fps:30}),/指定fps/);
});
