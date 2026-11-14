// End-to-end correctness: exact native acceleration MUST produce identical
// Unicode and CP932 glyphs to the ORIGINAL Mode 4 for the same source pixels.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39084/');
 const result=await page.evaluate(async()=>{
  const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');
  const {ArtisanComposer}=await import('/tsl-artisan-engine.js');
  const outputs=[];
  for(const [W,H,S,useReal,face] of [
   [32,9,10,false,false],
   [32,9,10,false,true],
   [240,67,6,true,false],
  ]){
   let pixels;
   {
    const canvas=document.createElement('canvas');canvas.width=W*S;canvas.height=H*S;
    const c=canvas.getContext('2d',{willReadFrequently:true});
    const grad=c.createLinearGradient(0,0,canvas.width,canvas.height);
    grad.addColorStop(0,'#333a42');grad.addColorStop(.5,'#f3f3f3');grad.addColorStop(1,'#1d315f');
    c.fillStyle=useReal?grad:'#f3f3f3';
    c.fillRect(0,0,canvas.width,canvas.height);
    c.fillStyle='#343434';c.beginPath();
    c.ellipse(canvas.width*.51,canvas.height*.52,canvas.width*.20,
     canvas.height*.36,0,0,Math.PI*2);c.fill();
    c.fillStyle='#e1e1e1';
    c.fillRect(canvas.width*.44,canvas.height*.43,canvas.width*.04,canvas.height*.05);
    c.fillRect(canvas.width*.55,canvas.height*.43,canvas.width*.04,canvas.height*.05);
    pixels=c.getImageData(0,0,canvas.width,canvas.height).data;
   }
   const atlas=await makeArtisanGlyphAtlas(S);
   const old=new ArtisanComposer(atlas,S),native=new ArtisanComposer(atlas,S);
   native.enableExactNative();
   const semantic=face?[{
    kind:'face',confidence:.9,importance:2.6,x:.28,y:.22,w:.44,h:.50,
    landmarks:[{x:.39,y:.46},{x:.59,y:.45},{x:.5,y:.57}]
   }]:[];
   const t0=performance.now();
   const expected=old.convert(pixels,W,H,{semantic});
   const refTime=performance.now()-t0;
   const t1=performance.now();
   const actual=await native.convertAccelerated(pixels,W,H,{semantic});
   const nativeTime=performance.now()-t1;
   let mismatches=0;
   for(let i=0;i<Math.max(actual.length,expected.length);i++)
    if(actual[i]!==expected[i])mismatches++;
   outputs.push({
    W,H,S,face,identical:actual===expected,
    mismatches,refMs:Math.round(refTime),nativeMs:Math.round(nativeTime),
    acceleration:native.acceleration,
    fallbackReason:native.gpuError||'',
    referenceChars:new Set([...expected]).size,
    resultChars:new Set([...actual]).size,
    head:actual.slice(0,70)
   });
  }
  return outputs;
 });
 for(const x of result){
  console.log('EXACT_PARITY',JSON.stringify(x));
  assert.equal(x.identical,true,'Original Mode 4 parity changed: '+JSON.stringify(x));
  assert.equal(x.acceleration,'PC Native Exact','Native scorer did not activate: '+x.fallbackReason);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS original Mode4 bytes unchanged by native scorer');
}finally{await browser.close();}
