import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const base=process.env.PLAYER_URL||'http://127.0.0.1:4173/';
const out=process.env.QUALITY_TEST_DIR||'/tmp/pc98-tsl-mp4-qc';
await mkdir(out,{recursive:true});

function fixture(width,height) {
  const alphabet=' .:|/(%YVO8D@0#$';
  const frame=(offset)=>Array.from({length:height},(_,y)=>
    Array.from({length:width},(_,x)=>alphabet[(x+y+offset)%alphabet.length]).join('')
  ).join('\n');
  return Buffer.from(['1','2',String(width),String(height),'0','0','TSL MP4 quality test'].join('\n')
    +'\n\f\n1 30\n2 30\n0 0\n\f\n'+frame(0)+'\n\f\n'+frame(5)+'\n\f\n','utf8');
}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  for(const [width,height,expectedW,expectedH] of [[90,80,1080,1920],[79,27,948,648]]) {
    const name='test-'+width+'x'+height+'.tsl';
    await page.setInputFiles('#file',{name,mimeType:'application/octet-stream',buffer:fixture(width,height)});
    await page.waitForFunction(name=>document.querySelector('#filename').textContent===name,name);
    const [download]=await Promise.all([
      page.waitForEvent('download',{timeout:90000}),
      page.click('#export-mp4')
    ]);
    const path=join(out,'test-'+width+'x'+height+'.mp4');
    await download.saveAs(path);
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,codec_name,level,profile','-of','json',path],{encoding:'utf8'}));
    const video=probe.streams[0],status=await page.locator('#status').textContent();
    assert.equal(video.width,expectedW);
    assert.equal(video.height,expectedH);
    assert.equal(video.codec_name,'h264');
    assert.ok(status.includes(expectedW+'×'+expectedH),status);
    console.log(JSON.stringify({source:name,video,status}));
  }
  // Emulate devices without Full HD H.264 support: stay portrait at 720x1280.
  const fallbackPage=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
  fallbackPage.on('pageerror',error=>errors.push(error.message));
  await fallbackPage.addInitScript(()=>{
    const native=VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported=config=>config.width===1080&&config.height===1920
      ? Promise.resolve({supported:false,config}) : native(config);
  });
  await fallbackPage.goto(base);
  await fallbackPage.setInputFiles('#file',{name:'forced-fallback.tsl',mimeType:'application/octet-stream',buffer:fixture(90,80)});
  await fallbackPage.waitForFunction(()=>document.querySelector('#filename').textContent==='forced-fallback.tsl');
  const [fallbackDownload]=await Promise.all([
    fallbackPage.waitForEvent('download',{timeout:90000}),fallbackPage.click('#export-mp4')
  ]);
  const fallbackPath=join(out,'forced-fallback.mp4');
  await fallbackDownload.saveAs(fallbackPath);
  const fallbackProbe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,codec_name','-of','json',fallbackPath],{encoding:'utf8'}));
  assert.equal(fallbackProbe.streams[0].width,720);
  assert.equal(fallbackProbe.streams[0].height,1280);
  console.log(JSON.stringify({fallback: fallbackProbe.streams[0],status:await fallbackPage.locator('#status').textContent()}));
  await fallbackPage.close();
  assert.deepEqual(errors,[]);
  console.log('TSL browser MP4 export quality tests: PASS');
} finally {await browser.close();}
