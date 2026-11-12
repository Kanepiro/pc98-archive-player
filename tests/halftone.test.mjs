import test from 'node:test';
import assert from 'node:assert/strict';
import {HALFTONE_GLYPHS,HALFTONE_TONES,HALFTONE_DITHER_STRENGTH,halftoneColumns,encodeHalftoneFrame,rgbaToHalftone} from '../public/tsl-halftone.js';
import {makePlan,optionsFor,tslName,TSLWriter} from '../public/tsl-converter-core.js';
import {parseTSL} from '../public/tsl.js';

function solid(width,height,value,sample=4){
 const pixels=new Uint8ClampedArray(width*height*sample*sample*4);
 for(let i=0;i<pixels.length;i+=4){
  pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255;
 }
 return pixels;
}
const rows=s=>s.split('\r\n').slice(0,-1);

test('Mode 2 offers only the user-selected period and round glyph five-tone palette',()=>{
 assert.equal(optionsFor({conversionMode:'halftone'}).conversionMode,'halftone');
 assert.equal(optionsFor({}).conversionMode,'legacy');
 assert.equal(optionsFor({conversionMode:'quality'}).conversionMode,'quality');
 assert.equal(tslName('test.mp4','halftone'),'test_Mode2.TSL');
 assert.deepEqual(HALFTONE_TONES,['　','。','ｏ','○','◎']);
 assert.deepEqual(HALFTONE_GLYPHS['。'],[0x81,0x42]); // Ideographic FULL STOP, NOT middle dot.
 assert.equal(HALFTONE_DITHER_STRENGTH,.08);
 for(const char of HALFTONE_TONES){
  assert.equal(halftoneColumns(char),2);
  assert.equal(new TextDecoder('shift_jis').decode(new Uint8Array(HALFTONE_GLYPHS[char])),char);
 }
 assert.equal(halftoneColumns('◎○ｏ。　 '),11);
 for(const char of ['・','●','〇','◯','０','Ｏ','＊','：','‥','∴','…','■','☆','a'])assert.throws(()=>halftoneColumns(char),/使用できない/);
});

test('Mode 2 maps all five levels including ideographic full stop',()=>{
 const w=8,h=4;
 for(const [gray,glyph] of [[255,'　'],[180,'。'],[128,'ｏ'],[76,'○'],[0,'◎']]){
  const result=rgbaToHalftone(solid(w,h,gray),w,h);
  assert.deepEqual(result.split('\r\n').slice(0,h),Array(h).fill(glyph.repeat(w/2)));
 }
});

test('Mode 2 is deterministic and spatial dithering stays inside selected five-tone palette',()=>{
 const w=160,h=12,pixels=new Uint8ClampedArray(w*h*4*4*4);
 for(let y=0;y<h*4;y++)for(let x=0;x<w*4;x++){
  const i=(y*w*4+x)*4,v=Math.round(255*x/(w*4-1));
  pixels[i]=pixels[i+1]=pixels[i+2]=v;pixels[i+3]=255;
 }
 const a=rgbaToHalftone(pixels,w,h,{brightness:0,contrast:1,gamma:1});
 const b=rgbaToHalftone(pixels,w,h,{brightness:0,contrast:1,gamma:1});
 assert.equal(a,b);
 assert.ok([...a].every(c=>['　','。','ｏ','○','◎','\r','\n'].includes(c)));
 for(const glyph of HALFTONE_TONES)assert.ok(a.includes(glyph),'missing '+glyph);
 assert.ok(rows(a).every(line=>halftoneColumns(line)===w));
 assert.notEqual(a,rgbaToHalftone(pixels,w,h,{brightness:15,contrast:1.6,gamma:.8}));
});

test('Mode 2 round trips TSL with standard CP932 and exact column count',async()=>{
 const width=10,height=6,p=makePlan(1.2,{width,height,fps:10,conversionMode:'halftone'});
 const writer=new TSLWriter(p),row='　。ｏ○◎';
 for(let i=0;i<p.count;i++)writer.append((row+'\r\n').repeat(height));
 const binary=new Uint8Array(await writer.finish().arrayBuffer());
 const decoded=new TextDecoder('shift_jis').decode(binary);
 const parsed=parseTSL(decoded);
 assert.equal(parsed.width,width);
 assert.equal(parsed.height,height);
 assert.equal(parsed.frames.length,p.count);
 assert.equal(parsed.frames[0].split('\n')[0],row);
 for(const glyph of HALFTONE_TONES)assert.ok(decoded.includes(glyph),'missing '+glyph);
 assert.equal(encodeHalftoneFrame([row]).length,width+5);
});

test('79-column PC-98 grids have only an invisible halfwidth padding column',async()=>{
 const w=79,h=25;
 const row=rgbaToHalftone(solid(w,h,0),w,h).split('\r\n')[0];
 assert.equal(row,'◎'.repeat(39)+' ');
 assert.equal(halftoneColumns(row),w);
 const p=makePlan(1,{width:w,height:h,fps:5,conversionMode:'halftone'}),wr=new TSLWriter(p);
 for(let i=0;i<p.count;i++)wr.append((row+'\r\n').repeat(h));
 const decoded=new TextDecoder('shift_jis').decode(await wr.finish().arrayBuffer());
 assert.equal(parseTSL(decoded).frames[0].split('\n')[0],row);
});

test('Mode 2 never accepts third-party symbols or malformed dimensions',()=>{
 const f=rgbaToHalftone(solid(4,4,0),4,4);
 assert.ok(f.includes('◎'));
 assert.throws(()=>rgbaToHalftone(new Uint8ClampedArray(3),4,4),/サイズ/);
 assert.throws(()=>encodeHalftoneFrame(['■']),/使用できない/);
 const p=makePlan(1,{width:8,height:4,fps:5,conversionMode:'halftone'}),wr=new TSLWriter(p);
 assert.throws(()=>wr.append(('■'.repeat(4)+'\r\n').repeat(4)),/使用できない/);
});
