// Real Chrome end-to-end: bundled local UI -> native C++ -> TSL download.
import {chromium} from 'playwright';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const tmp=mkdtempSync(join(tmpdir(),'tasl-boost-ui-'));
const input=join(tmp,'video.mp4');
const ffmpeg=process.env.FFMPEG_BIN||'ffmpeg';
const encode=spawnSync(ffmpeg,['-v','error','-f','lavfi','-i',
 'testsrc2=size=320x240:rate=15','-t','2','-pix_fmt','yuv420p',
 '-c:v','libx264','-preset','ultrafast','-y',input],{encoding:'utf8'});
if(encode.status!==0)throw Error('Fixture FFmpeg failed: '+encode.stderr);
const browser=await chromium.launch({
 channel:'chrome',headless:true,args:['--no-sandbox']
});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},acceptDownloads:true});
 page.on('pageerror',e=>console.error('BROWSER SCRIPT ERROR',e.message));
 await page.goto(process.env.BOOST_UI_URL||'http://127.0.0.1:39083/',{waitUntil:'domcontentloaded'});
 await page.click('#tab-converter');
 if(!(await page.isChecked('#video-pc-boost')))throw Error('Local PC Boost must be enabled by default');
 await page.setInputFiles('#video-file',input);
 await page.selectOption('#video-style','artisan');
 await page.selectOption('#video-mode','pc98');
 await page.waitForFunction(()=>document.querySelector('#video-name').textContent.includes('320×240'),null,{timeout:10000});
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>{
  const text=document.querySelector('#converter-status')?.textContent||'';
  return text.includes('変換が完了しました')||text.includes('変換できません');
 },null,{timeout:60000});
 const result=await page.evaluate(()=>({
  status:document.getElementById('converter-status').textContent,
  detail:document.getElementById('converter-detail').textContent
 }));
 if(!result.status.includes('変換が完了しました'))throw Error('UI convert failed: '+JSON.stringify(result));
 const downloadPromise=page.waitForEvent('download');
 await page.click('#tsl-download');
 const download=await downloadPromise;
 const stream=await download.createReadStream();
 const chunks=[];
 for await(const chunk of stream)chunks.push(chunk);
 const bytes=Buffer.concat(chunks);
 if(!bytes.subarray(0,6).equals(Buffer.from('1.08\r\n'))||
    !bytes.subarray(bytes.length-1).equals(Buffer.from([26])))
  throw Error('Invalid downloaded TSL header or end marker');
 const decoded=new TextDecoder('shift_jis').decode(bytes);
 if(!decoded.includes('# PC98_FONT_16X16'))throw Error('Missing PC-98 16-dot setting');
 console.log('Native local UI passed',result.status,result.detail,'bytes',bytes.length);
 const preview=page.locator('#preview-tsl');
 await preview.click();
 await page.waitForTimeout(250);
 if((await page.locator('#tab-player').getAttribute('aria-selected'))!=='true')
  throw Error('TSL preview did not switch to player');
 console.log('PASS: one-click local app -> native TSL -> preview');
}finally{
 await browser.close();
 rmSync(tmp,{recursive:true,force:true});
}
