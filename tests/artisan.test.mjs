import test from 'node:test';
import assert from 'node:assert/strict';
import {cp932GlyphMap,artisanColumns,encodeArtisanFrame,acceptableArtisanMask} from '../public/tsl-artisan.js';
import {makePlan,optionsFor,TSLWriter,tslName} from '../public/tsl-converter-core.js';
import {parseTSL} from '../public/tsl.js';
test('Mode 4 scans broad CP932 including CJK and halfwidth with original byte values',()=>{
 const glyphs=cp932GlyphMap();
 assert.ok(glyphs.size>9000,'Only '+glyphs.size+' CP932 characters');
 for(const c of ['川','人','鬱','一','乃','彡','■','／','。','ｏ','ｱ','A',' ','　'])assert.ok(glyphs.has(c),'missing '+c);
 for(const [ch,bytes] of glyphs)assert.equal(new TextDecoder('shift_jis').decode(Uint8Array.from(bytes)),ch);
 assert.equal(artisanColumns('川Aｱ'),4);
 assert.equal(artisanColumns('　／'),4);
 assert.throws(()=>artisanColumns('😀'),/使えない/);
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
 const writer=new TSLWriter(p),line='川人ﾉ ／';
 assert.equal(artisanColumns(line),8);
 for(let i=0;i<p.count;i++)writer.append((line+'\r\n').repeat(p.height));
 const data=parseTSL(new TextDecoder('shift_jis').decode(await writer.finish().arrayBuffer()));
 assert.equal(data.width,8);assert.equal(data.frames.length,5);assert.equal(data.frames[0].split('\n')[0],line);
 assert.equal(encodeArtisanFrame([line]).length,8+5);
});
