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
test('Mode 3 glyph palette bans large circle, square and diamond symbols',()=>{
 assert.equal(QUALITY_CHARS.length,50);
 for(const char of [' ','#','o','O','/','\\','|','─','│','／','＼','┌','┘']){
  assert.ok(QUALITY_GLYPHS[char],'Missing '+char);
  assert.equal(new TextDecoder('shift_jis').decode(Uint8Array.from(QUALITY_GLYPHS[char])),char);
 }
 for(const char of ['○','●','□','■','◇','◆']){
  assert.equal(QUALITY_GLYPHS[char],undefined);
  assert.ok(!QUALITY_CHARS.includes(char));
  assert.throws(()=>qualityColumns(char),/利用できない/);
  assert.throws(()=>encodeQualityFrame([char]),/利用できない/);
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

test('Solid coloured backgrounds never generate glyphs, even after a detailed moving frame',()=>{
 const sample=4,w=24,h=16,q=new QualityConverter(tinyAtlas(sample),sample);
 const scene=frame(w,h,sample,(x,y)=>x>6&&x<18&&y>4&&y<13?[255,240,0]:[28,61,234]);
 q.convert(scene,w,h);
 for(const color of [[240,0,150],[255,215,0],[0,225,155],[235,235,235],[0,0,0]]){
  const f=frame(w,h,sample,()=>color);
  const result=q.convert(f,w,h);
  const lines=result.split('\r\n').slice(0,h);
  assert.ok(lines.every(line=>line===' '.repeat(w)), 'flat fill emitted character for '+color);
 }
});
test('A hard colour boundary remains while the flat interior stays blank',()=>{
 const sample=4,w=20,h=14,q=new QualityConverter(tinyAtlas(sample),sample);
 const scene=frame(w,h,sample,(x,y)=>x>=5&&x<15&&y>=3&&y<11?[240,200,40]:[30,80,220]);
 const lines=q.convert(scene,w,h).split('\r\n').slice(0,h);
 assert.equal(lines[7][10],' ','centre of a solid coloured rectangle should be blank');
 assert.equal(lines[1][10],' ','solid background away from the rectangle should be blank');
 assert.ok(lines.some(row=>row.trim().length>0),'the shape outline disappeared');
});

test('Moving object leaves no ghost glyphs in vacated pixels',()=>{
 const S=4,w=28,h=16,q=new QualityConverter(tinyAtlas(S),S);
 const coloredRect=left=>frame(w,h,S,(x,y)=>
  x>=left&&x<left+6&&y>=4&&y<12?[242,211,18]:[36,42,231]);
 const before=q.convert(coloredRect(2),w,h);
 assert.ok(before.replace(/[\s\r\n]/g,'').length>0,'original shape vanished');
 const after=q.convert(coloredRect(17),w,h).split('\r\n').slice(0,h);
 for(let y=3;y<13;y++)for(let x=0;x<10;x++)
  assert.equal(after[y][x],' ', 'vacated region retained glyph at '+x+','+y);
 const stationary=q.convert(coloredRect(17),w,h);
 assert.equal(stationary,after.join('\r\n')+'\r\n');
});
