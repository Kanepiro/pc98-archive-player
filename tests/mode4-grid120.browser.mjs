import assert from 'node:assert/strict';
import {chromium,webkit} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const root=process.env.OUT||'validation',url=process.env.PLAYER_URL||'http://127.0.0.1:4197/';
await mkdir(root,{recursive:true});
const engine=process.env.ENGINE||'chromium';
const browser=await (engine==='webkit'?webkit:chromium).launch(engine==='webkit'?{headless:true,executablePath:'/home/kanepiro74/WorkTasks/tasl_noto_tools/webkit-run.sh'}:{channel:'chrome',headless:true,args:['--no-sandbox','--disable-webgpu']});
try{
 const page=await browser.newPage();page.on('console',m=>console.log(m.text()));await page.goto(url);
 const file=process.env.VIDEO||'__motion.mp4',fps=Number(process.env.FPS||24);
 const result=await page.evaluate(async({file,fps,doExport,native,partial})=>{
  const {convertVideo}=await import('/video-to-tsl.js'),{deleteCheckpoint}=await import('/tsl-checkpoint.js');
  const {parseTSL,drawTSL}=await import('/tsl.js'),{GRID120_CHARS}=await import('/mode4-palette.js');
  const source=new File([await(await fetch('/'+file)).arrayBuffer()],file,{type:'video/mp4'}),progress=[],issues=[];
  await deleteCheckpoint();
  const options={conversionMode:'artisan',fps,exactNative:native,onCheckpointIssue:e=>issues.push(e.message),onProgress:p=>{if(p.phase==='converting'){progress.push({done:p.done,backend:p.acceleration});if(p.done%16===0)console.log('frame '+p.done+'/'+p.total);}}};
  // Deliberately request wrong UI dimensions/PC98 cropping: mode4 must override.
  const result=await convertVideo(source,{...options,width:120,height:67,native16:true,sourceGrid:true,fit:'cover'});
  const bytes=await result.blob.arrayBuffer(),data=parseTSL(new TextDecoder('shift_jis').decode(bytes));
  const canvas=document.createElement('canvas');drawTSL(canvas,data,0);
  const preview=canvas.toDataURL();
  const unique=new Set(data.frames),allowed=new Set([...GRID120_CHARS]);
  const invalid=data.frames.some(f=>f.split('\n').some(row=>[...row].length!==data.width/2||[...row].some(c=>!allowed.has(c))));
  const again=await convertVideo(source,{...options,width:120,height:67,native16:true,sourceGrid:true,fit:'cover'});
  const same=await again.blob.text()===await result.blob.text();
  let partialResume=null;
  if(partial){
   await deleteCheckpoint();
   const stop=new AbortController();
   let aborted=false;
   try{await convertVideo(source,{...options,signal:stop.signal,onProgress:p=>{if(p.phase==='converting'&&p.done===17)stop.abort();}});}
   catch(e){if(e.name!=='AbortError')throw e;aborted=true;}
   let resumedAt=null;
   const resumed=await convertVideo(source,{...options,onProgress:p=>{if(p.phase==='resumed')resumedAt=p.done;}});
   const equal=await resumed.blob.text()===await result.blob.text();
   partialResume={aborted,resumedAt,equal};
   if(!aborted||resumedAt!==16||!equal)throw Error('Partial resume failed: '+JSON.stringify(partialResume));
  }
  let mp4=null;
  if(doExport){
   const {exportTslInWorker}=await import('/tsl-export-controller.js');
   const b=await exportTslInWorker({kind:'TSL',data,bytes});mp4=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(b);});
  }
  return {frames:data.frames.length,width:data.width,height:data.height,mode4Cell120:data.mode4Cell120,pixels:[canvas.width,canvas.height],duration:data.duration,unique:unique.size,invalid,resumeSame:same,issues,progress,partialResume,preview,tsl:Array.from(new Uint8Array(bytes)),mp4,elapsed:result.elapsed,plan:result.plan};
 },{file,fps,doExport:process.env.NO_EXPORT!=='1',native:process.env.NATIVE==='1',partial:process.env.PARTIAL==='1'});
 assert.equal(result.mode4Cell120,true);assert.equal(result.invalid,false);assert.equal(result.resumeSame,true);assert.deepEqual(result.issues,[]);
 assert.equal(result.frames,result.plan.count);assert.equal(result.progress.filter(p=>p.done===result.frames).length,1);
 assert.ok(result.unique>result.frames*.5,'Video stopped changing');
 await writeFile(root+'/grid120.TSL',Buffer.from(result.tsl));
 await writeFile(root+'/grid120-first.png',Buffer.from(result.preview.split(',')[1],'base64'));
 if(result.mp4)await writeFile(root+'/grid120.mp4',Buffer.from(result.mp4,'base64'));
 delete result.tsl;delete result.mp4;delete result.preview;
 await writeFile(root+'/grid120-report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
