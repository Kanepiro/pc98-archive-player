import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const out=process.env.NOTO_OUT||'noto-validation',url=process.env.PLAYER_URL||'http://127.0.0.1:4191/';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-webgpu']});
const results=[];
try{
 const page=await browser.newPage();await page.goto(url);
 for(const mode of ['legacy','halftone','quality','artisan']){
  const data=await page.evaluate(async({mode,native})=>{
   const {convertVideo}=await import('/video-to-tsl.js');
   const {deleteCheckpoint}=await import('/tsl-checkpoint.js');
   const {parseTSL,drawTSL}=await import('/tsl.js');
   const {exportTslInWorker}=await import('/tsl-export-controller.js');
   await deleteCheckpoint();
   const file=new File([await(await fetch('/__noto-test.mp4')).arrayBuffer()],'noto-test.mp4',{type:'video/mp4'});
   const result=await convertVideo(file,{conversionMode:mode,width:16,height:8,fps:2,exactNative:native});
   const bytes=await result.blob.arrayBuffer(),tsl=parseTSL(new TextDecoder('shift_jis').decode(bytes));
   const canvas=document.createElement('canvas');drawTSL(canvas,tsl,0);
   let resolved;
   const mp4=await exportTslInWorker({kind:'TSL',data:tsl,bytes},{onResolution:(w,h)=>{resolved={width:w,height:h};}});
   const resumed=await convertVideo(file,{conversionMode:mode,width:16,height:8,fps:2,exactNative:native});
   const same=Array.from(new Uint8Array(bytes)).join(',')===Array.from(new Uint8Array(await resumed.blob.arrayBuffer())).join(',');
   return {mode,frames:tsl.frames.length,width:tsl.width,height:tsl.height,mp4Bytes:mp4.size,resolution:resolved,resumeSame:same,tsl:Array.from(new Uint8Array(bytes)),mp4:Array.from(new Uint8Array(await mp4.arrayBuffer()))};
  },{mode,native:process.env.NOTO_NATIVE==='1'});
  assert.equal(data.frames,4);assert.equal(data.width,16);assert.equal(data.height,8);
  assert.ok(data.mp4Bytes>1000);assert.equal(data.resumeSame,true);
  await writeFile(out+'/'+mode+'.TSL',Buffer.from(data.tsl));await writeFile(out+'/'+mode+'.mp4',Buffer.from(data.mp4));
  delete data.tsl;delete data.mp4;results.push(data);console.log(JSON.stringify(data));
 }
}finally{await writeFile(out+'/modes-report.json',JSON.stringify(results,null,2));await browser.close();}
