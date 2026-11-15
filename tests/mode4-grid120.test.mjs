import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mode4Grid,validateGridFrame,shapeDescriptor,selectMode4Glyphs,gaussianFrame,prepareMode4Targets} from '../public/tsl-mode4-grid.js';
import {GRID120_CHARS,GRID120_MASK_SHA256} from '../public/mode4-palette.js';
import {makePlan,TSLWriter} from '../public/tsl-converter-core.js';
import {parseTSL,tslFrameAt} from '../public/tsl.js';
test('exact original CP932 palette, no normalization, no spaces added',async()=>{
 const raw=await readFile(new URL('../public/mode4-palette.txt',import.meta.url));
 assert.equal(createHash('sha256').update(raw).digest('hex'),'b764b8f920d047cfed428f6550ca6d03b7cdd78ba25d7505d7e5e2b5352458d1');
 assert.equal(new TextDecoder('shift_jis').decode(raw).replace(/[\r\n]/g,''),GRID120_CHARS);
 assert.equal([...GRID120_CHARS].length,170);assert.equal(new Set(GRID120_CHARS).size,170);
 const masks=await readFile(new URL('../public/mode4-atlas.bin',import.meta.url));
 assert.equal(createHash('sha256').update(masks).digest('hex'),GRID120_MASK_SHA256);
 for(let g=0;g<170;g++){
  const b=masks.subarray(g*14400,(g+1)*14400);assert.ok(b.some(x=>x>0));
  for(let p=0;p<120;p++)assert.equal(b[p]+b[14280+p]+b[p*120]+b[p*120+119],0,'glyph touches a clipping edge');
 }
});
test('120px cells cover all original pixels without crop or size reduction',()=>{
 for(const [w,h,c,r,pw,ph] of [[1920,1080,16,9,1920,1080],[1080,1920,9,16,1080,1920],[1919,1079,16,9,1920,1080],[1201,721,11,7,1320,840],[100,100,1,1,120,120]]){
  const g=mode4Grid(w,h);assert.deepEqual([g.columns,g.height,g.pixelWidth,g.pixelHeight],[c,r,pw,ph]);
 }
});
test('same mean and density but opposite stroke directions select different shapes',()=>{
 const slash=new Float32Array(576),back=new Float32Array(576);
 for(let y=2;y<22;y++)for(let d=-1;d<=1;d++){slash[y*24+23-y+d]=1;back[y*24+y+d]=1;}
 const atlas=[{features:shapeDescriptor(slash)},{features:shapeDescriptor(back)}];
 assert.deepEqual(selectMode4Glyphs([shapeDescriptor(slash),shapeDescriptor(back)],atlas),[0,1]);
});
test('blur preserves constant regions and does not restart at cell boundaries',()=>{
 const a=new Float32Array(240*120).fill(.4),b=gaussianFrame(a,240,120);
 assert.ok(b.every(x=>Math.abs(x-.4)<1e-5));
 a.fill(0);for(let y=0;y<120;y++)a[y*240+119]=1;
 const c=gaussianFrame(a,240,120);assert.ok(c[60*240+120]>0);
});
test('24fps samples every original frame and TSL roundtrip keeps exact timing',async()=>{
 const plan=makePlan(2,{...mode4Grid(1920,1080),conversionMode:'artisan',fps:24});
 assert.equal(plan.count,48);for(let i=0;i<48;i++)assert.equal(plan.steps[i].time,i/24);
 const w=new TSLWriter(plan);
 for(let i=0;i<48;i++)w.append(Array(9).fill([...GRID120_CHARS][i].repeat(16)).join('\r\n')+'\r\n');
 const data=parseTSL(new TextDecoder('shift_jis').decode(await w.finish().arrayBuffer()));
 assert.equal(data.mode4Fps,24);assert.equal(data.duration,2);assert.equal(data.frames.length,48);
 for(let i=0;i<48;i++)assert.equal(tslFrameAt(data,i/24+1e-7),i);
 assert.throws(()=>validateGridFrame([' '.repeat(16)],32,1));
 assert.throws(()=>makePlan(500,{...mode4Grid(1920,1080),conversionMode:'artisan',fps:30}),/上限/);
});

test('flat bright and dark backgrounds have no invented contours',()=>{
 const make=value=>{const rgba=new Uint8ClampedArray(120*120*4);for(let p=0;p<rgba.length;p+=4){rgba[p]=rgba[p+1]=rgba[p+2]=value;rgba[p+3]=255;}return prepareMode4Targets(rgba,2,1)[0];};
 for(const v of [0,80,160,255])assert.ok(make(v).every(x=>Math.abs(x)<1e-6));
});
