import test from 'node:test';
import assert from 'node:assert/strict';
import {QUALITY_GLYPHS,QUALITY_CHARS,qualityColumns,encodeQualityFrame,QualityConverter} from '../public/tsl-quality.js';
import {optionsFor,makePlan,TSLWriter,tslName,rgbaToASCII} from '../public/tsl-converter-core.js';
import {parseTSL} from '../public/tsl.js';

function frame(w,h,sample,pixel){
 const data=new Uint8ClampedArray(w*h*sample*sample*4);
 for(let y=0;y<h*sample;y++)for(let x=0;x<w*sample;x++){
  const c=pixel(x/sample,y/sample),i=(y*w*sample+x)*4;
  data[i]=c[0];data[i+1]=c[1];data[i+2]=c[2];data[i+3]=255;
 }
 return data;
}
function tinyAtlas(sample){
 const all=(value,cols)=>new Float32Array(sample*sample*cols).fill(value);
 return [
  {char:' ',columns:1,mask:all(0,1)},
  {char:'#',columns:1,mask:all(1,1)},
  {char:'／',columns:2,mask:all(.35,2)}
 ];
}
test('Only mode 1 and mode 3 are available; mode 1 remains unchanged',()=>{
 assert.equal(optionsFor({}).conversionMode,'legacy');
 assert.deepEqual(optionsFor({conversionMode:'quality'}).conversionMode,'quality');
 assert.throws(()=>optionsFor({conversionMode:'outline'}),/変換方式/);
 assert.equal(tslName('猫.MP4'),'猫.TSL');
 assert.equal(tslName('猫.MP4','quality'),'猫_Mode3.TSL');
 assert.equal(rgbaToASCII(frame(8,8,4,()=>[255,255,255]),8,8).split('\r\n')[0],'$'.repeat(8));
});
test('CP932 glyph bank includes thin, dense and fullwidth shapes',()=>{
 assert.ok(QUALITY_CHARS.length>=40);
 for(const char of [' ','#','o','O','/','\\','|','─','│','／','＼','┌','┘','■','○']){
  assert.ok(QUALITY_GLYPHS[char],'Missing '+char);
  assert.equal(new TextDecoder('shift_jis').decode(Uint8Array.from(QUALITY_GLYPHS[char])),char);
 }
 assert.equal(qualityColumns('／.｜'),5);
 assert.throws(()=>qualityColumns('＠'),/利用できない/);
});
test('Mixed one and two column quality rows round trip in Shift-JIS',async()=>{
 const row='  ／#│.  ',width=qualityColumns(row);
 const p=makePlan(1.1,{conversionMode:'quality',width,height:6,fps:5});
 const writer=new TSLWriter(p);
 for(let i=0;i<p.count;i++)writer.append((row+'\r\n').repeat(p.height));
 const binary=new Uint8Array(await writer.finish().arrayBuffer());
 assert.ok(binary.some(b=>b>=128));
 const result=parseTSL(new TextDecoder('shift_jis').decode(binary));
 assert.equal(result.width,width);assert.equal(result.frames.length,p.count);
 assert.ok(result.frames[0].includes(row));
 assert.equal(encodeQualityFrame([row]).length,width+5);
});
test('Flat fields and changing foregrounds are handled by the stable converter',()=>{
 const sample=4,w=8,h=8,q=new QualityConverter(tinyAtlas(sample),sample);
 const black=frame(w,h,sample,()=>[0,0,0]);
 assert.ok(q.convert(black,w,h).split('\r\n').slice(0,h).every(row=>row===' '.repeat(w)));
 const white=frame(w,h,sample,()=>[255,255,255]);
 assert.ok(q.convert(white,w,h).split('\r\n').slice(0,h).every(row=>row===' '.repeat(w)));
 const solid=frame(w,h,sample,(x,y)=>x>=2&&x<6&&y>=2&&y<6?[255,255,255]:[0,0,0]);
 const a=q.convert(solid,w,h);
 assert.ok(a.replace(/[\s\r\n]/g,'').length>0,'foreground vanished');
 const b=q.convert(solid,w,h);
 assert.equal(a,b,'identical frames must not flicker');
});
