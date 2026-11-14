import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-webgpu']});
try{
 const page=await browser.newPage();
 await page.route('**/tsl-artisan-vision.js',r=>r.fulfill({contentType:'text/javascript',body:`
  export async function createArtisanVision(){return {backend:'Test detections',detect(){return [{kind:'face',confidence:.99,x:.7,y:.1,w:.08,h:.1,importance:2.6,landmarks:[{x:.72,y:.13},{x:.76,y:.13},{x:.74,y:.15},{x:.74,y:.18}]}]},close(){}}}
 `}));
 await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39085/');
 const report=await page.evaluate(async()=>{
  const {NativeContour}=await import('/tsl-fullgpu-contour.js');
  const {buildArtisanTopology}=await import('/tsl-artisan-structure.js');
  const {guideArtisanFaces}=await import('/tsl-artisan-portrait.js');
  const w=96,h=64,target=new Float32Array(w*h);
  for(let y=3;y<h-3;y++)target[y*w+4]=.9;
  for(let x=3;x<w-3;x++)target[(h-5)*w+x]=.9;
  const semantic=[{kind:'face',confidence:.99,x:.65,y:.1,w:.15,h:.2,importance:2.6,landmarks:[]}];
  const native=new NativeContour(true);
  const actual=await native.run(4,w,h,target,{semantic});
  const expected=buildArtisanTopology({w,h,target},semantic);
  let maxError=0;for(let i=0;i<target.length;i++)maxError=Math.max(maxError,Math.abs(actual.target[i]-expected.source[i]));
  if(maxError>.0001||actual.target[20*w+4]<.8||actual.target[(h-5)*w+45]<.8)throw Error('Native contour erased source outside the face');
  const guided=await native.faces({w,h},actual,semantic);
  if(guided.faceGuides!==0||guided.target!==actual.target)throw Error('Native portrait synthesized/erased source strokes');
  const {convertVideo}=await import('/video-to-tsl.js');
  const {fitRect}=await import('/tsl-converter-core.js');
  const file=new File([await(await fetch('/__validation.mp4')).arrayBuffer()],'fidelity.mp4',{type:'video/mp4',lastModified:0});
  const calls=[],draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(source,...args){if(source instanceof HTMLVideoElement&&this.canvas.width===240&&this.canvas.height===80)calls.push(args);return draw.call(this,source,...args);};
  try{
   await convertVideo(file,{width:24,height:8,conversionMode:'artisan',fps:1,fit:'contain',exactNative:false});
  }finally{CanvasRenderingContext2D.prototype.drawImage=draw;}
  const rect=fitRect(640,360,240,80,.5,'contain',.5,.5);
  if(calls.length!==2||calls.some(a=>a.some((v,i)=>Math.abs(v-[rect.x,rect.y,rect.width,rect.height][i])>.001)))throw Error('Detected face altered selected crop '+JSON.stringify(calls));
  return {nativeContourMaxError:maxError,nativeOutsideFacePreserved:true,noInventedFace:true,frameRect:rect,capturedDraws:calls};
 });
 assert.equal(report.nativeOutsideFacePreserved,true);
 await mkdir('gpu-validation',{recursive:true});await writeFile('gpu-validation/source-fidelity.json',JSON.stringify(report,null,2));
 console.log('PASS original source framing, observed face/body/background contours, no invented portrait',JSON.stringify(report));
}finally{await browser.close();}
