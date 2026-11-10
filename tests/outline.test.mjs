import test from 'node:test';
import assert from 'node:assert/strict';
import {rgbaToOutline,displayColumns,encodeOutlineFrame,OUTLINE_GLYPH_SET,OUTLINE_GLYPHS,OUTLINE_GLYPH_COUNT} from '../public/tsl-outline.js';
import {makePlan,optionsFor,rgbaToASCII,TSLWriter,tslName} from '../public/tsl-converter-core.js';
import {parseTSL} from '../public/tsl.js';

function image(width,height,pixel,sample=4){
 const arr=new Uint8ClampedArray(width*height*sample*sample*4);
 for(let y=0;y<height*sample;y++)for(let x=0;x<width*sample;x++){
  const rgb=pixel(x/sample,y/sample);
  const p=(y*width*sample+x)*4;
  arr[p]=rgb[0];arr[p+1]=rgb[1];arr[p+2]=rgb[2];arr[p+3]=255;
 }
 return arr;
}
function glyphs(text){return [...text].filter(c=>c!==' '&&c!=='\r'&&c!=='\n');}

test('mode 1 keeps the original 16-character grayscale mapping',()=>{
 const pixels=image(12,8,(x)=>x<6?[0,0,0]:[255,255,255]);
 const legacy=rgbaToASCII(pixels,12,8);
 assert.equal(legacy.split('\r\n')[0],' '.repeat(6)+'$'.repeat(6));
 assert.equal(optionsFor({}).conversionMode,'legacy');
 assert.equal(tslName('a.mp4'),'a.TSL');
 assert.equal(tslName('a.mp4','outline'),'a_Mode2.TSL');
});
test('mode 2 turns flat dark and bright fills into pure spaces',()=>{
 for(const value of [0,55,128,215,255]){
  const pixels=image(20,12,()=>[value,value,value]);
  const result=rgbaToOutline(pixels,20,12);
  assert.ok(result.split('\r\n').slice(0,12).every(row=>row===' '.repeat(20)),'flat '+value);
 }
});
test('mode 2 preserves object boundaries, leaving at least 80% blank',()=>{
 const pixels=image(40,24,(x,y)=>(x>=12&&x<30&&y>=6&&y<19)?[30,30,30]:[240,240,240]);
 const result=rgbaToOutline(pixels,40,24);
 const ch=glyphs(result);
 assert.ok(ch.length>6,'only '+ch.length+' contour symbols');
 assert.ok(ch.length<40*24*.2,'too many filled symbols: '+ch.length);
 assert.ok(ch.every(x=>OUTLINE_GLYPH_SET.has(x)));
 for(const row of result.split('\r\n').slice(0,24))assert.equal(displayColumns(row,'outline'),40);
});
test('mode 2 distinguishes colors of similar brightness',()=>{
 const pixels=image(40,22,(x)=>x<20?[255,0,0]:[0,76,0]);
 const result=rgbaToOutline(pixels,40,22,{outlineThreshold:25});
 assert.ok(glyphs(result).length>=10,'separating edge should remain visible');
});
test('mode 2 handles odd-width rows as exact half-width cell counts',()=>{
 const res=rgbaToOutline(image(15,9,(x)=>x<8?[0,0,0]:[255,255,255]),15,9);
 for(const row of res.split('\r\n').slice(0,9)){
  assert.equal(displayColumns(row,'outline'),15);
  assert.ok(row.endsWith(' '),'odd final column must be blank');
 }
});
test('mode 2 Shift-JIS TSL round trip through the existing player parser',async()=>{
 const p=makePlan(1.2,{width:16,height:8,fps:10,conversionMode:'outline'});
 const writer=new TSLWriter(p);
 const row='  │／＼─┃━  ';
 assert.equal(displayColumns(row,'outline'),16);
 const frame=(row+'\r\n').repeat(p.height);
 for(let i=0;i<p.count;i++)writer.append(frame);
 const bytes=new Uint8Array(await writer.finish().arrayBuffer());
 assert.ok(bytes.some(c=>c>=128),'double-byte characters required');
 const parsed=parseTSL(new TextDecoder('shift_jis').decode(bytes));
 assert.equal(parsed.frames.length,p.count);
 assert.equal(parsed.width,16);assert.equal(parsed.height,8);
 assert.ok(parsed.frames[0].includes('│／＼─┃━'));
 const direct=encodeOutlineFrame([row]);
 assert.equal(direct.length,16+2+3);
 assert.deepEqual([...direct.slice(2,4)],[0x84,0xa0]);
});
test('invalid outline options and glyphs cannot corrupt output',()=>{
 assert.throws(()=>optionsFor({conversionMode:'unknown'}));
 for(const outlineThreshold of [0,4,141,Infinity,NaN])assert.throws(()=>optionsFor({outlineThreshold}));
 const plan=makePlan(.1,{width:16,height:8,conversionMode:'outline'});
 assert.throws(()=>new TSLWriter(plan).append(('雪'.repeat(8)+'\r\n').repeat(8)),/未対応/);
 assert.throws(()=>new TSLWriter(plan).append(('│'.repeat(7)+'\r\n').repeat(8)),/画面データ/);
 const legacyPlan=makePlan(.1,{width:16,height:8});
 assert.throws(()=>new TSLWriter(legacyPlan).append(('│'.repeat(8)+'\r\n').repeat(8)),/画面データ/);
});

test('expanded contour palette includes full-width corners, curves, dots, and half-width accents',()=>{
 assert.ok(OUTLINE_GLYPH_COUNT>=50);
 for(const c of ['┌','┐','└','┘','┼','╋','（','）','〈','〉','・','。','○','＿','￣','|','-','/','\\','.']){
  assert.ok(OUTLINE_GLYPH_SET.has(c),'missing glyph: '+c);
  assert.equal(new TextDecoder('shift_jis').decode(Uint8Array.from(OUTLINE_GLYPHS[c])),c,'CP932 error '+c);
 }
 const row='┌|○.┘ /';
 assert.equal(displayColumns(row,'outline'),10);
 const encoded=encodeOutlineFrame([row]);
 assert.equal(encoded.length,10+2+3);
 assert.equal(new TextDecoder('shift_jis').decode(encoded),row+'\r\n\f\r\n');
});
test('composite scenes use more than the old six glyphs',()=>{
 const w=128,h=36, pixels=image(w,h,(x,y)=>{
  const box=x>=12&&x<45&&y>=6&&y<29;
  const ring=Math.abs(Math.hypot(x-78,y-17)-13)<2;
  const slant=Math.abs(y-.5*x+46)<1.4;
  return box||ring||slant?[12,26,42]:[245,245,240];
 });
 const frame=rgbaToOutline(pixels,w,h,{outlineThreshold:20});
 const used=new Set(glyphs(frame));
 assert.ok(used.size>6,'outlines unexpectedly collapsed to '+[...used].join(''));
 for(const line of frame.split('\r\n').slice(0,h))assert.equal(displayColumns(line,'outline'),w);
});

test('faint outlines and one-column details survive the expanded half-width pass',()=>{
 const w=80,h=42;
 // Difference of just 28 RGB levels was previously lost at threshold 40.
 const faint=image(w,h,(x,y)=>x>=16&&x<52&&y>=12&&y<32?[105,110,115]:[133,138,143]);
 const faintResult=rgbaToOutline(faint,w,h);
 assert.ok(glyphs(faintResult).length>=15,'faint foreground contours disappeared');
 const narrow=image(w,h,(x,y)=>Math.abs(x-34)<.5&&y>=5&&y<36?[15,15,15]:[235,235,235]);
 const thinResult=rgbaToOutline(narrow,w,h);
 assert.ok(glyphs(thinResult).length>=10,'one-column contour was erased');
 assert.ok([...glyphs(thinResult)].some(c=>'|-/\\'.includes(c)),'expected halfwidth strokes for thin detail');
});
