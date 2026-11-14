import {chromium} from 'playwright';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const tmp=mkdtempSync(join(tmpdir(),'tasl-faithful-e2e-'));
const movie=join(tmp,'movie.mp4');
const encode=spawnSync(process.env.FFMPEG_BIN||'ffmpeg',['-v','error','-f','lavfi','-i',
 'testsrc2=size=640x360:rate=10','-t','1',
 '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-y',movie],{encoding:'utf8'});
if(encode.status!==0)throw Error(encode.stderr);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 async function render(boost){
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1250,height:900}});
  try{
   const page=await context.newPage();
   page.on('pageerror',e=>console.error('JS_ERROR',e.message));
   await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39084/');
   await page.click('#tab-converter');
   if((await page.isVisible('#pc-boost-setting'))!==true)
    throw Error('PC Boost setting not visible on PC-local origin');
   await page.selectOption('#video-mode','landscape');
   await page.selectOption('#video-style','artisan');
   await page.selectOption('#video-fps','5');
   if(boost)await page.check('#video-pc-boost');
   else await page.uncheck('#video-pc-boost');
   await page.setInputFiles('#video-file',movie);
   await page.waitForFunction(()=>document.querySelector('#video-name').textContent.includes('640×360'),null,{timeout:20000});
   await page.click('#convert-tsl');
   await page.waitForFunction(()=>{
    const s=document.querySelector('#converter-status').textContent;
    return s.includes('変換が完了しました')||s.includes('変換できません');
   },null,{timeout:160000});
   const status=await page.locator('#converter-status').textContent();
   if(!status.includes('変換が完了しました'))throw Error('Convert failed: '+status);
   const promise=page.waitForEvent('download',{timeout:20000});
   await page.click('#tsl-download');
   const download=await promise,buf=readFileSync(await download.path());
   console.log('CONVERT',boost?'EXACT_NATIVE':'REFERENCE',status,
    'bytes',buf.length,'sha256',createHash('sha256').update(buf).digest('hex'));
   await page.click('#preview-tsl');
   if(await page.locator('#tab-player').getAttribute('aria-selected')!=='true')
    throw Error('Original TSL player did not open');
   return buf;
  }finally{await context.close();}
 }
 const a=await render(false);
 const b=await render(true);
 if(!a.equals(b)){
  console.error('Original and native TSL files differ at byte',a.findIndex((x,i)=>b[i]!==x));
  throw Error('Fidelity failure: video-to-TSL differed');
 }
 console.log('PASS ORIGINAL video-to-TSL byte-for-byte parity, including MediaPipe path');
}finally{await browser.close();rmSync(tmp,{recursive:true,force:true});}