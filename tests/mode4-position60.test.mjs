import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {makeMode4Atlas,selectMode4Glyphs,glyphScore,shapeDescriptor} from '../public/tsl-mode4-grid60.js';
import {MODE4_CHARS} from '../public/mode4-palette60.js';
import {GLYPH_BOUNDS,validateOffsets,encodeOffsets,decodeOffsets} from '../public/mode4-position60.js';
import {makePlan,TSLWriter} from '../public/tsl-converter-core.js';
import {parseTSL} from '../public/tsl.js';
test('all 2014 positions preserve the exact 170 glyphs and never clip ink',async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=async u=>new Response(await readFile(u));
 try{
  const atlas=await makeMode4Atlas(),masks=await readFile(new URL('../public/mode4-atlas60.bin',import.meta.url));
  assert.equal(atlas.length,2014);assert.equal(new Set(atlas.map(g=>g.char)).size,170);
  for(const g of atlas){
   validateOffsets([g.char],2,1,Uint8Array.of(g.dx+60,g.dy+60));
   for(let i=0;i<3600;i++)if(masks[g.glyph*3600+i]){
    const x=i%60+g.dx,y=(i/60|0)+g.dy;assert.ok(x>=0&&x<60&&y>=0&&y<60);
   }
  }
  const targets=[atlas[2].features,atlas[271].features,atlas[1711].features];
  const selected=selectMode4Glyphs(targets,atlas);
  for(let i=0;i<targets.length;i++){
   const exact=atlas.map(g=>glyphScore(targets[i],g.features));assert.ok(Math.abs(selected.scores[i]-Math.min(...exact))<1e-7);
  }
 }finally{globalThis.fetch=originalFetch;}
});
test('positioned TSL roundtrips and resumes with byte-identical text and offsets',async()=>{
 const plan=makePlan(1,{width:4,height:1,fps:2,conversionMode:'artisan',mode4Cell60:true});
 const line='・　\r\n',position=Uint8Array.of(70,50,60,60),writer=new TSLWriter(plan);
 const p=writer.append(line,position);writer.append(line,Uint8Array.of(50,70,60,60));
 const expected=new Uint8Array(await writer.finish().arrayBuffer());
 const data=parseTSL(new TextDecoder('shift_jis').decode(expected));
 assert.deepEqual(data.mode4Offsets[0],position);assert.equal(data.frames[0],'・　');
 const resumed=new TSLWriter(plan);resumed.resumeChunk({start:0,count:1,blob:new Blob([p]),mode4Offsets:[p.mode4Offsets]});
 resumed.append(line,Uint8Array.of(50,70,60,60));
 assert.deepEqual(new Uint8Array(await resumed.finish().arrayBuffer()),expected);
 const old=new TextDecoder('shift_jis').decode(expected).split('\n').filter(l=>!l.startsWith('# TASL_MODE4_OFFSETS ')).join('\n');
 assert.equal(parseTSL(old).mode4Offsets,null);
 assert.throws(()=>parseTSL(new TextDecoder('shift_jis').decode(expected).replace('# TASL_MODE4_OFFSETS 1','# TASL_MODE4_OFFSETS 0')));
});
test('invalid positions cannot overflow cells, move blanks, or truncate metadata',()=>{
 assert.throws(()=>validateOffsets(['｜'],2,1,Uint8Array.of(115,60)));
 assert.throws(()=>validateOffsets(['　'],2,1,Uint8Array.of(65,60)));
 assert.throws(()=>validateOffsets(['・'],2,1,Uint8Array.of(61,60)));
 assert.throws(()=>decodeOffsets('AA==',2));
 const bytes=Uint8Array.of(5,115,60,60);assert.deepEqual(decodeOffsets(encodeOffsets(bytes),4),bytes);
 assert.equal(GLYPH_BOUNDS.length,[...MODE4_CHARS].length);
});
