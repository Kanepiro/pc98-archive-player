import assert from 'node:assert/strict';
import {chromium,webkit} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const out=process.env.OUT||'validation/video',engine=process.env.ENGINE||'chromium';
await mkdir(out,{recursive:true});
const browser=await (engine==='webkit'?webkit:chromium).launch(engine==='webkit'?{headless:true,executablePath:'/home/kanepiro74/WorkTasks/tasl_noto_tools/webkit-run.sh'}:{channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();page.on('console',m=>console.log(m.text()));await page.goto(process.env.PLAYER_URL||'http://127.0.0.1:4198/');
 const result=await page.evaluate(async({file,fps,native,doExport,partial})=>{
  const {convertVideo}=await import('/video-to-tsl.js'),{deleteCheckpoint}=await import('/tsl-checkpoint.js');
  const {parseTSL,drawTSL}=await import('/tsl.js'),m=await import('/tsl-mode4-grid60.js'),{MODE4_CHARS}=await import('/mode4-palette60.js');
  const source=new File([await(await fetch('/'+file)).arrayBuffer()],file,{type:file.endsWith('webm')?'video/webm':'video/mp4'});
  const progress=[],audits=[],issues=[];await deleteCheckpoint();
  const options={conversionMode:'artisan',fps,exactNative:native,mode4Diagnostics:true,onCheckpointIssue:e=>issues.push(e.message),
   onProgress:p=>{if(p.phase==='converting'){progress.push({done:p.done,backend:p.acceleration,perf:p.perf});audits.push(p.audit);if(p.done%24===0)console.log('frame '+p.done+'/'+p.total);}}};
  const converted=await convertVideo(source,{...options,width:120,height:67,native16:true,sourceGrid:true,fit:'cover'});
  const bytes=await converted.blob.arrayBuffer(),data=parseTSL(new TextDecoder('shift_jis').decode(bytes));
  if(!data.mode4Cell60)throw Error('Missing 60px marker');
  const allowed=new Set([...MODE4_CHARS,m.MODE4_SPACE]);let violations=0,accepted=0,blank=0,lines=['frame,cell,row,column,best_char,best_score,edge_pixels,limit,accepted,output,reason,best_x,best_y,x,y'];
  if(audits.length!==data.frames.length)throw Error('Missing audit frames');
  for(let f=0;f<data.frames.length;f++){
   const rows=data.frames[f].split('\n');m.validateGridFrame(rows,data.width,data.height);
   const flat=rows.flatMap(row=>[...row]);if(flat.length!==audits[f].length)throw Error('Audit size');
   for(let i=0;i<flat.length;i++){const d=audits[f][i],pos=data.mode4Offsets?.[f];if(!pos||pos[i*2]-60!==d.x||pos[i*2+1]-60!==d.y)violations++;if(d.output!==flat[i]||!allowed.has(flat[i])||d.accepted&&(d.bestScore>d.limit||d.edgePixels<m.MODE4_MIN_EDGE))violations++;
    if(d.accepted)accepted++;else blank++;
    lines.push([f,i,Math.floor(i/(data.width/2)),i%(data.width/2),d.bestChar,d.bestScore,d.edgePixels,d.limit,d.accepted,d.output,d.reason,d.bestX,d.bestY,d.x,d.y].join(','));
   }
  }
  const again=await convertVideo(source,{...options,onProgress:()=>{},width:120,height:67,native16:true,sourceGrid:true,fit:'cover'});
  const resumeSame=await again.blob.text()===await converted.blob.text();
  let partialResume=null;
  if(partial){
   await deleteCheckpoint();const stop=new AbortController();let aborted=false,resumedAt=null;
   try{await convertVideo(source,{...options,signal:stop.signal,onProgress:p=>{if(p.phase==='converting'&&p.done===17)stop.abort();}});}catch(e){if(e.name!=='AbortError')throw e;aborted=true;}
   const resumed=await convertVideo(source,{...options,onProgress:p=>{if(p.phase==='resumed')resumedAt=p.done;}});
   partialResume={aborted,resumedAt,equal:await resumed.blob.text()===await converted.blob.text()};
   if(!aborted||resumedAt!==16||!partialResume.equal)throw Error('Partial resume failed '+JSON.stringify(partialResume));
  }
  const previews=[];for(const sec of [0,1,3,5,8]){const f=Math.min(data.frames.length-1,Math.round(sec*fps)),c=document.createElement('canvas');drawTSL(c,data,f);previews.push({f,sec,png:c.toDataURL()});}
  let mp4=null;if(doExport){console.log('export starting');const {exportTslInWorker}=await import('/tsl-export-controller.js');
   const b=await exportTslInWorker({kind:'TSL',data,bytes},{sourceAudioFile:source});mp4=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(b);});}
  const summary={frames:data.frames.length,width:data.width,height:data.height,pixels:[data.width*30,data.height*60],duration:data.duration,unique:new Set(data.frames.map((f,i)=>f+Array.from(data.mode4Offsets?.[i]??[]).join(','))).size,violations,accepted,blank,placementRate:accepted/(accepted+blank),resumeSame,partialResume,issues,progress,elapsed:converted.elapsed};
  return {summary,tsl:Array.from(new Uint8Array(bytes)),csv:lines.join('\n')+'\n',previews,mp4};
 },{file:process.env.VIDEO||'__inmu10.mp4',fps:Number(process.env.FPS||24),native:process.env.NATIVE==='1',doExport:process.env.NO_EXPORT!=='1',partial:process.env.PARTIAL==='1'});
 await writeFile(out+'/grid60.TSL',Buffer.from(result.tsl));await writeFile(out+'/scores.csv',result.csv);
 for(const p of result.previews)await writeFile(out+'/preview-'+p.sec+'.png',Buffer.from(p.png.split(',')[1],'base64'));
 if(result.mp4)await writeFile(out+'/grid60.mp4',Buffer.from(result.mp4,'base64'));
 await writeFile(out+'/report.json',JSON.stringify(result.summary,null,2));console.log(JSON.stringify(result.summary));
 assert.equal(result.summary.violations,0);assert.equal(result.summary.resumeSame,true);assert.deepEqual(result.summary.issues,[]);
 assert.ok(result.summary.unique>result.summary.frames*.5);
 if(process.env.NATIVE==='1')assert.ok(result.summary.progress.every(p=>p.backend.startsWith('DirectCompute')),'GPU fallback happened');
}finally{await browser.close();}
