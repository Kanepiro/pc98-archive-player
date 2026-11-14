import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
await mkdir('gpu-validation',{recursive:true});
try{
 const page=await browser.newPage();
 await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39085/');
 const report=await page.evaluate(async()=>{
  const {ArtisanComposer,makeCandidates,sourceSeams,measureArtisanLayout}=await import('/tsl-artisan-engine.js');
  const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');
  const {criticizeArtisanRows}=await import('/tsl-artisan-critic.js');
  const cases=[];
  for(const [W,H,S,face] of [[24,12,6,false],[31,9,6,false],[32,16,6,true],[240,67,6,true]]){
   const canvas=document.createElement('canvas');canvas.width=W*S;canvas.height=H*S;
   const c=canvas.getContext('2d');c.fillStyle='#eee';c.fillRect(0,0,canvas.width,canvas.height);
   c.strokeStyle='#222';c.lineWidth=3;c.beginPath();c.ellipse(W*S*.5,H*S*.5,W*S*.23,H*S*.38,0,0,Math.PI*2);c.stroke();
   c.beginPath();c.moveTo(4,4);c.lineTo(canvas.width-4,canvas.height-4);c.stroke();
   c.fillStyle='#222';c.fillRect(W*S*.4,H*S*.4,S,S*.4);c.fillRect(W*S*.56,H*S*.4,S,S*.4);
   const pixels=c.getImageData(0,0,canvas.width,canvas.height).data;
   const atlas=await makeArtisanGlyphAtlas(S);
   const semantic=face?[{kind:'face',confidence:.95,importance:2.6,x:.25,y:.12,w:.5,h:.76,
    landmarks:[{x:.41,y:.4},{x:.59,y:.4},{x:.5,y:.55},{x:.5,y:.68}]}]:[];
   const options={semantic},reference=new ArtisanComposer(atlas,S),gpu=new ArtisanComposer(atlas,S);
   let t=performance.now();const expected=reference.convert(pixels,W,H,options),cpuMs=performance.now()-t;
   const oldNative=new ArtisanComposer(atlas,S);await oldNative.enablePCBoost(W,H);
   oldNative.fullGpuLayout=null;oldNative.nativeContour=null;t=performance.now();
   const oldNativeText=await oldNative.convertAccelerated(pixels,W,H,options),oldNativeMs=performance.now()-t;
   await gpu.enablePCBoost(W,H);t=performance.now();
   const actual=await gpu.convertAccelerated(pixels,W,H,options),nativeMs=performance.now()-t;
   const check=new ArtisanComposer(atlas,S),prepared=check._prepare(pixels,W,H,options);
   const {unary,candidates}=makeCandidates(prepared.field,check.atlas,W,H,S,null,null);
   const seams=sourceSeams(prepared.field,W,H,S),lookup=new Map(check.atlas.map((g,j)=>[g.char,j]));
   const rows=actual.trimEnd().split('\r\n').map(line=>{
    let x=0;return [...line].map(char=>{const j=lookup.get(char),p={x,j};x+=check.atlas[j].columns;return p;});
   });
   // Keep trailing spaces: TSL frame rows have exact CP932 column widths.
   const exactRows=actual.split('\r\n').slice(0,H).map(line=>{
    let x=0;return [...line].map(char=>{const j=lookup.get(char),p={x,j};x+=check.atlas[j].columns;return p;});
   });
   const independent=criticizeArtisanRows(exactRows,check.atlas,W,S,unary,seams,prepared.field,measureArtisanLayout);
   cases.push({W,H,S,face,cpuMs,oldNativeMs,oldNativeBackend:oldNative.acceleration,oldNativePerf:oldNative.lastPerf,nativeMs,backend:gpu.acceleration,error:gpu.gpuError,
    perf:gpu.lastPerf,reference:reference.lastDiagnostics.critique.after,
    gpu:gpu.lastDiagnostics.critique,independent,
    cpuText:expected,gpuText:actual});
  }
  return cases;
 });
 await writeFile('gpu-validation/layout-report.json',JSON.stringify(report,null,2));
 for(const r of report){
  console.log('LAYOUT_VALIDATION',JSON.stringify({...r,cpuText:undefined,gpuText:undefined}));
  assert.match(r.backend,/DirectCompute Global|WARP Test Global/);
  const shader=r.gpu.after.total,exact=r.independent.total;
  assert.ok(Math.abs(shader-exact)<Math.max(.01,exact*.001),'GPU whole-frame energy must agree with independent original critic');
  assert.ok(exact<=r.reference.total*1.05+.01,'Global quality regression exceeds 5%');
  assert.ok(r.gpu.after.total<=r.gpu.before.total+.001,'Critic must improve or preserve quality');
 }
 console.log('PASS native GPU global layout and independent original pixel critic');
}finally{await browser.close();}
