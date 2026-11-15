import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.env.BOOST_URL||'http://127.0.0.1:39086/';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-webgpu']});
try{
 const page=await browser.newPage({acceptDownloads:true});page.on('console',m=>{if(m.type()==='log')console.log(m.text());});
 await page.goto(base);const entry=await page.locator('script[type=module]').getAttribute('src');
 const download=page.waitForEvent('download',{timeout:600000});
 const report=await page.evaluate(async entry=>{
  const dir=entry.slice(0,entry.lastIndexOf('/')+1);
  const {convertVideo}=await import(dir+'video-to-tsl.js');
  const {exportFaithfulNativeMp4}=await import(dir+'pc-boost.js');
  const file=new File([await(await fetch('/__freeze.mp4')).blob()],'freeze-test.mp4',{type:'video/mp4',lastModified:0});
  const progress=[];
  const result=await convertVideo(file,{width:16,height:8,fps:1,conversionMode:'artisan',exactNative:true,
   onProgress:p=>{if(p.phase==='converting'){progress.push({done:p.done,backend:p.acceleration});if(p.done%10===0)console.log('NATIVE_MODE4',p.done,p.total);}}});
  const {parseTSL}=await import(dir+'tsl.js');const data=parseTSL(new TextDecoder('shift_jis').decode(await result.blob.arrayBuffer()));
  if(data.frames.length!==65||new Set(data.frames.slice(18)).size<30||data.frames[58]===data.frames[64])throw Error('Native mode 4 froze');
  if(!progress.every(p=>p.backend==='WARP Test Global'))throw Error('Native GPU layout path was not exercised: '+JSON.stringify(progress));
  const exported=await exportFaithfulNativeMp4({file,tslBlob:result.blob,plan:result.plan,source:result.source});
  const response=await fetch(exported.url),blob=await response.blob();
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='native-freeze-65s.mp4';a.click();
  return {frames:data.frames.length,uniqueFrames:new Set(data.frames).size,duration:data.duration,progress,exported};
 },entry);
 await mkdir('freeze-validation',{recursive:true});
 await(await download).saveAs(resolve('freeze-validation/native-freeze-65s.mp4'));
 assert.equal(report.frames,65);await writeFile('freeze-validation/packaged-browser-report.json',JSON.stringify(report,null,2));
 console.log('PASS packaged native decode, recognition, GPU layout and native MP4',JSON.stringify(report));
}finally{await browser.close();}
