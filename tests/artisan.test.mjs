import test from 'node:test';
import assert from 'node:assert/strict';
import {cp932GlyphMap,allowedArtisanGlyphMap,artisanColumns,encodeArtisanFrame,acceptableArtisanMask} from '../public/tsl-artisan.js';
import {MODE4_ALLOWED_CHARS,MODE4_ALLOWED_SET} from '../public/mode4-allowed.js';
import {makePlan,optionsFor,TSLWriter,tslName} from '../public/tsl-converter-core.js';
import {parseTSL} from '../public/tsl.js';
test('Mode 4 allows precisely the 802 characters supplied by the user plus invisible space',()=>{
 const allCp932=cp932GlyphMap();
 const allowed=allowedArtisanGlyphMap();
 assert.ok(allCp932.size>9000);
 assert.equal(MODE4_ALLOWED_CHARS.length,802);
 assert.equal(new Set([...MODE4_ALLOWED_CHARS]).size,802);
 assert.equal(MODE4_ALLOWED_SET.size,802);
 assert.equal(allowed.size,803);
 for(const ch of MODE4_ALLOWED_CHARS) {
  assert.ok(allowed.has(ch),'missing '+ch);
  assert.deepEqual(allowed.get(ch),allCp932.get(ch));
 }
 for(const ch of allowed.keys())assert.ok(ch===' '||MODE4_ALLOWED_SET.has(ch),'extra '+ch);
 for(const ch of ['川','人','一','彡','／','＃','○','◎','ノ',''])assert.ok(allowed.has(ch),'missing '+ch);
 for(const ch of ['鬱','森','A','#','ｱ','■','漢','川']) {
  if(ch==='川')continue;
  assert.equal(allowed.has(ch),false,'forbidden '+ch);
  assert.throws(()=>artisanColumns(ch),/使えない/);
 }
 assert.equal(artisanColumns('川／'),4);
 assert.equal(artisanColumns('川 '),3);
});
test('Mode 4 filters solid tangled glyph masks but allows clean strokes',()=>{
 assert.equal(acceptableArtisanMask(Float32Array.from({length:24*24},()=>1),2,24,24),false);
 const sparse=new Float32Array(24*24);
 for(let y=0;y<24;y++)sparse[y*24+12]=1;
 assert.equal(acceptableArtisanMask(sparse,2,24,24),true);
});
test('Mode 4 CP932 encoding, exact two-column CJK placement, TSL playback',async()=>{
 assert.equal(optionsFor({conversionMode:'artisan'}).conversionMode,'artisan');
 assert.equal(tslName('video.mp4','artisan'),'video_Mode4.TSL');
 const p=makePlan(1,{width:8,height:4,fps:5,conversionMode:'artisan'});
 const writer=new TSLWriter(p),line='川人ノ／';
 assert.equal(artisanColumns(line),8);
 for(let i=0;i<p.count;i++)writer.append((line+'\r\n').repeat(p.height));
 const data=parseTSL(new TextDecoder('shift_jis').decode(await writer.finish().arrayBuffer()));
 assert.equal(data.width,8);assert.equal(data.frames.length,5);assert.equal(data.frames[0].split('\n')[0],line);
 assert.equal(encodeArtisanFrame([line]).length,8+5);
});
