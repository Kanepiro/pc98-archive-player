import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile,readFile} from 'node:fs/promises';
import crypto from 'node:crypto';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
const reports=[];
try{
 for(const legacyLayout of [true,false]){
  const page=await browser.newPage();
  await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39085/');
  const result=await page.evaluate(async legacyLayout=>{
   const {convertVideo}=await import('/video-to-tsl.js');
   const bytes=await(await fetch('/__validation.mp4')).arrayBuffer();
   const file=new File([bytes],'comparison.mp4',{type:'video/mp4',lastModified:0});
   const progress=[];const start=performance.now();
   const converted=await convertVideo(file,{sourceGrid:true,width:80,height:22,conversionMode:'artisan',native16:true,
    exactNative:true,legacyLayout,fps:4,brightness:0,contrast:1,gamma:1,edge:0,
    onProgress:p=>{if(p.phase==='converting')progress.push({frame:p.done,backend:p.acceleration,perf:p.perf,error:p.gpuReason});}});
   return {legacyLayout,wallMs:performance.now()-start,plan:converted.plan,progress,
    tsl:Array.from(new Uint8Array(await converted.blob.arrayBuffer()))};
  },legacyLayout);
  const {tsl,...report}=result;
  await writeFile('gpu-validation/'+(legacyLayout?'legacy':'fullgpu')+'-video.TSL',Buffer.from(tsl));
  reports.push(report);await page.close();
 }
 const source=await readFile('dist/__validation.mp4');
 const report={sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),
  adapter:'Explicit WARP software validation; hardware speed is unverified',runs:reports};
 await writeFile('gpu-validation/video-report.json',JSON.stringify(report,null,2));
 assert.equal(reports[0].plan.count,reports[1].plan.count);
 assert.ok(reports[1].progress.every(p=>p.backend==='WARP Test Global'),JSON.stringify(reports[1].progress));
 console.log('VIDEO_COMPARISON',JSON.stringify(report));
}finally{await browser.close();}
