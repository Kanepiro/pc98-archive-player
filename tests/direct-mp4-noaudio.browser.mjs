import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const source='/tmp/pc98-direct-mp4-noaudio.mp4';
execFileSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=10','-t','1','-an','-c:v','libx264','-preset','ultrafast',source]);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4188/');
 await page.click('#tab-converter');
 assert.equal(await page.locator('#video-direct-mp4').isChecked(),false);
 assert.equal(await page.locator('#direct-mp4-download').isVisible(),false);
 await page.check('#video-direct-mp4');
 await page.selectOption('#video-fps','5');
 await page.setInputFiles('#video-file',source);
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>/MP4作成に失敗/.test(document.querySelector('#converter-status').textContent),null,{timeout:120000});
 const status=await page.locator('#converter-status').textContent();
 assert.match(status,/音声トラックがありません/);
 assert.equal(await page.locator('#tsl-download').isVisible(),true);
 assert.equal(await page.locator('#direct-mp4-download').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status,tslVisible:true,mp4Visible:false,errors}));
}finally{await browser.close();}
