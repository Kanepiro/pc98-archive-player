import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {mode4Grid,mode4Engine,makeMode4Atlas,validateOffsets} from '../public/tsl-mode4.js';
import {TSLWriter,makePlan} from '../public/tsl-converter-core.js';
import {parseTSL} from '../public/tsl.js';
import {halftoneIndex,halftoneLevels} from '../public/tsl-halftone.js';
import {formatSeconds} from '../public/tsl-time.js';
test('display rounding never changes input precision',()=>{
 for(const t of [0,.999,1,65.99,150,7200]){assert.equal(formatSeconds(t),Math.floor(t)+'秒');assert.equal(formatSeconds(t,'remaining'),Math.ceil(t)+'秒');assert.equal(formatSeconds(t,'total'),Math.ceil(t)+'秒');}
 assert.equal(formatSeconds(-1),'0秒');assert.equal(formatSeconds(Infinity),'—秒');
});
test('independent mode4 sizes, masks and CP932 offset round trip',async()=>{
 const saved=globalThis.fetch;globalThis.fetch=async url=>{const bytes=await fs.readFile(url);return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};};
 try{
  for(const [cell,columns,rows,positions] of [[60,32,18,2014],[40,48,27,1527],[30,64,36,1541]]){
   const grid=mode4Grid(1920,1080,cell);assert.equal(grid.columns,columns);assert.equal(grid.height,rows);
   assert.equal(mode4Engine(cell),cell===60?6005:cell*100+1);
   const atlas=await makeMode4Atlas(cell);assert.equal(atlas.length,positions);assert.equal(new Set(atlas.map(a=>a.char)).size,170);
   for(const a of atlas)validateOffsets([a.char],2,1,Uint8Array.of(a.dx+60,a.dy+60),cell);
   const p=makePlan(.2,{...mode4Grid(cell*2,cell,cell),conversionMode:'artisan',fps:10}),writer=new TSLWriter(p);
   const a=atlas.find(a=>a.dx||a.dy),frame=a.char+'　\r\n',offset=Uint8Array.of(a.dx+60,a.dy+60,60,60);
   writer.append(frame,offset);writer.append(frame,offset);
   const text=new TextDecoder('shift_jis').decode(await writer.finish().arrayBuffer()),parsed=parseTSL(text);
   assert.equal(parsed.mode4CellSize,cell);assert.deepEqual(parsed.mode4Offsets,[offset,offset]);assert.equal(parsed.duration,.2);
   assert.throws(()=>parseTSL(text.replace('# TASL_MODE4_CELL'+cell,'# TASL_MODE4_CELL'+cell+'\r\n# TASL_MODE4_CELL30')),/重複/);
   const bad=Uint8Array.of(255,60,60,60);assert.throws(()=>validateOffsets([a.char+'　'],4,1,bad,cell));
  }
 }finally{globalThis.fetch=saved;}
});
test('tone quantization is monotone and every measured tone reproduces itself at every Bayer position',()=>{
 for(const native16 of [false,true]){
  const levels=halftoneLevels(native16);
  for(let y=0;y<4;y++)for(let x=0;x<4;x++){
   for(let i=0;i<levels.length;i++)assert.equal(halftoneIndex(levels[i],x,y,native16),i);
   let previous=0;for(let k=0;k<=4096;k++){const current=halftoneIndex(k/4096,x,y,native16);assert.ok(current>=previous);previous=current;}
  }
 }
});
test('historical untagged Mode2 characters are not rewritten',async()=>{
 const p=makePlan(.1,{width:10,height:4,fps:10,conversionMode:'halftone'}),writer=new TSLWriter(p),row='　。ｏ○◎';
 writer.append((row+'\r\n').repeat(4));const text=new TextDecoder('shift_jis').decode(await writer.finish().arrayBuffer());
 assert.equal(parseTSL(text).halftoneProfile,2001);
 const legacy=parseTSL(text.replace('# TASL_HALFTONE_PROFILE 2001\r\n',''));assert.equal(legacy.halftoneProfile,0);assert.equal(legacy.frames[0],Array(4).fill(row).join('\n'));
});
