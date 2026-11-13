// Manual end-to-end check: start node scripts/serve.mjs and python3 native-boost/bridge.py
// before running this script. It exercises the actual UI, loopback HTTP and C++ converter.
import {chromium} from 'playwright';
import {resolve} from 'node:path';
const browser=await chromium.launch({
 executablePath:process.env.CHROME||'/usr/bin/google-chrome',
 headless:true,args:['--no-sandbox']
});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('console',m=>{if(m.type()==='error')console.error('BROWSER:',m.text());});
 await page.goto('http://127.0.0.1:4173/');
 await page.click('#tab-converter');
 await page.setInputFiles('#video-file',resolve('native-boost/smoke.mp4'));
 await page.selectOption('#video-style','artisan');
 await page.selectOption('#video-mode','pc98');
 await page.waitForFunction(()=>document.querySelector('#video-name').textContent.includes('320×240'),{timeout:10000});
 await page.check('#video-pc-boost');
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>{
  const text=document.querySelector('#converter-status')?.textContent||'';
  return text.includes('変換が完了しました')||text.includes('変換できません');
 },null,{timeout:45000});
 const result=await page.evaluate(()=>({
  status:document.getElementById('converter-status').textContent,
  detail:document.getElementById('converter-detail').textContent
 }));
 const downloadPromise=page.waitForEvent('download');
 await page.click('#tsl-download');
 const download=await downloadPromise;
 const stream=await download.createReadStream();
 const chunks=[];
 for await (const chunk of stream)chunks.push(chunk);
 const bytes=Buffer.concat(chunks);
 result.bytes=bytes.length;
 result.head=Array.from(bytes.subarray(0,6));
 console.log(result);
 if(!result.status.includes('変換が完了しました')||result.bytes<100||result.head.join(',')!=='49,46,48,56,13,10')
  throw Error('PC Native UI end-to-end check failed');
 console.log('PASS: native C++ TSL -> browser download');
}finally{await browser.close();}
