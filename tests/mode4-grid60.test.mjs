import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mode4Grid,MODE4_SPACE,prepareMode4Targets,selectMode4Glyphs,judgeMode4,shapeDescriptor,gaussianFrame,validateGridFrame,Grid60Converter} from '../public/tsl-mode4-grid60.js';
import {MODE4_CHARS,MODE4_MASK_SHA256} from '../public/mode4-palette60.js';
import {makePlan,TSLWriter} from '../public/tsl-converter-core.js';
import {parseTSL,tslFrameAt} from '../public/tsl.js';
test('60px padded geometry never discards source pixels',()=>{
 for(const [w,h,c,r,pw,ph] of [[1920,1080,32,18,1920,1080],[1080,1920,18,32,1080,1920],[1919,1079,32,18,1920,1080],[1201,721,21,13,1260,780],[31,29,1,1,60,60]]){
  const g=mode4Grid(w,h);assert.deepEqual([g.columns,g.height,g.pixelWidth,g.pixelHeight],[c,r,pw,ph]);
 }
});
test('palette is exact original, every 60px glyph is present and bounded',async()=>{
 const raw=await readFile(new URL('../public/mode4-palette.txt',import.meta.url));
 assert.equal(createHash('sha256').update(raw).digest('hex'),'b764b8f920d047cfed428f6550ca6d03b7cdd78ba25d7505d7e5e2b5352458d1');
 assert.equal(new TextDecoder('shift_jis').decode(raw).replace(/[\r\n]/g,''),MODE4_CHARS);
 assert.equal(new Set(MODE4_CHARS).size,170);
 const masks=await readFile(new URL('../public/mode4-atlas60.bin',import.meta.url));
 assert.equal(createHash('sha256').update(masks).digest('hex'),MODE4_MASK_SHA256);
 assert.equal(masks.length,170*3600);for(let i=0;i<170;i++)assert.ok(masks.subarray(i*3600,i*3600+3600).some(x=>x>0));
 const meta=JSON.parse(await readFile(new URL('../public/mode4-atlas60.json',import.meta.url)));
 assert.equal(meta.fontSize,60);for(const g of meta.glyphs)assert.ok(g.bbox[0]>=0&&g.bbox[1]>=0&&g.bbox[2]<=60&&g.bbox[3]<=60);
});
test('mixed and all-blank rows retain exact full-cell width in CP932 TSL',async()=>{
 const plan=makePlan(2,{...mode4Grid(1920,1080),conversionMode:'artisan',fps:24}),writer=new TSLWriter(plan);
 for(let f=0;f<48;f++){const rows=Array.from({length:18},(_,y)=>Array.from({length:32},(_,x)=>(f+y+x)%5===0?'川':MODE4_SPACE).join(''));writer.append(rows.join('\r\n')+'\r\n');}
 const data=parseTSL(new TextDecoder('shift_jis').decode(await writer.finish().arrayBuffer()));
 assert.equal(data.mode4Cell60,true);assert.equal(data.mode4Cell120,false);assert.equal(data.frames.length,48);
 for(let f=0;f<48;f++){validateGridFrame(data.frames[f].split('\n'),64,18);assert.equal(tslFrameAt(data,f/24+1e-7),f);}
 validateGridFrame([MODE4_SPACE.repeat(32)],64,1);
 assert.throws(()=>validateGridFrame([' '.repeat(32)],64,1));
 assert.throws(()=>validateGridFrame(['Ａ'.repeat(32)],64,1));
});
test('flat gray/white/black and low contrast texture are blank, even if best score wins',()=>{
 const glyph=new Float32Array(576);for(let y=0;y<24;y++)glyph[y*24+12]=1;
 const atlas=[{char:'｜',features:shapeDescriptor(glyph)}];
 for(const value of [0,80,160,255]){
  const pixels=new Uint8ClampedArray(60*60*4);for(let p=0;p<pixels.length;p+=4){pixels[p]=pixels[p+1]=pixels[p+2]=value;pixels[p+3]=255;}
  const targets=prepareMode4Targets(pixels,2,1);assert.equal(targets.edgeCounts[0],0);
  assert.equal(judgeMode4(targets,selectMode4Glyphs(targets,atlas),atlas)[0].output,MODE4_SPACE);
 }
});
test('score gate rejects above limit and admits at boundary; GPU rejection cannot revive',async()=>{
 const atlas=[{char:'｜',features:shapeDescriptor(new Float32Array(576).fill(1))}],targets=[atlas[0].features];targets.edgeCounts=[20];
 assert.equal(judgeMode4(targets,{indices:[0],scores:[.22]},atlas)[0].accepted,true);
 assert.equal(judgeMode4(targets,{indices:[0],scores:[.2201]},atlas)[0].accepted,false);
 const converter=new Grid60Converter(atlas);converter.native={adapterInfo:{software:false},match:async()=>({indices:[0],scores:[.99]})};
 const pixels=new Uint8ClampedArray(60*60*4);for(let y=0;y<60;y++)for(let x=0;x<60;x++){const p=(y*60+x)*4;pixels[p]=pixels[p+1]=pixels[p+2]=x>30?255:0;pixels[p+3]=255;}
 assert.equal(await converter.convertAccelerated(pixels,2,1,{mode4Diagnostics:true}),MODE4_SPACE+'\r\n');
 assert.equal(converter.lastAudit[0].accepted,false);
});
test('chamfer favors matching stroke and penalizes extra strokes',()=>{
 const one=new Float32Array(576),two=new Float32Array(576);for(let y=0;y<24;y++){one[y*24+6]=1;two[y*24+6]=two[y*24+18]=1;}
 const t=shapeDescriptor(one),atlas=[{features:shapeDescriptor(two)},{features:t}];
 assert.equal(selectMode4Glyphs([t],atlas).indices[0],1);
});
test('Gaussian sigma8 is symmetric and preserves constant regions',()=>{
 const a=new Float32Array(61*61);a[30*61+30]=1;const b=gaussianFrame(a,61,61,8);
 assert.ok(Math.abs(b[30*61+22]-b[30*61+38])<1e-8);
 assert.ok(gaussianFrame(new Float32Array(61*61).fill(.4),61,61,8).every(x=>Math.abs(x-.4)<1e-6));
});
