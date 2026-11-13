import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const dir='/tmp/tasl-autotune-native16';await mkdir(dir,{recursive:true});
const source=join(dir,'source.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-nostdin','-f','lavfi','-i','testsrc2=size=640x360:rate=12:duration=2','-pix_fmt','yuv420p','-c:v','libx264','-preset','ultrafast',source]);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 page.on('pageerror',e=>console.log('PAGE_ERROR',e.message));
 await page.goto(process.env.PLAYER_URL||'http://127.0.0.1:4488/');
 await page.click('#tab-converter');
 await page.setInputFiles('#video-file',source);
 for(const type of ['landscape','portrait','screen','pc98']){
  await page.selectOption('#video-mode',type);
  await page.selectOption('#video-style','artisan');
  if(type!=='pc98')await page.selectOption('#video-font-render','native16');
  else{
   assert.equal(await page.locator('#video-font-render').inputValue(),'native16');
   assert.equal(await page.locator('#video-font-render').isDisabled(),true);
  }
  await page.click('#auto-tune');
  await page.waitForFunction(()=>/場面を解析|解析できませんでした|濃淡が少なく/.test(document.querySelector('#auto-tune-status').textContent),null,{timeout:120000});
  const status=await page.locator('#auto-tune-status').textContent();
  assert.match(status,/場面を解析/,type+': '+status);
  for(const id of ['video-brightness','video-contrast','video-gamma'])
   assert.ok(Number.isFinite(Number(await page.locator('#'+id).inputValue())),id);
  console.log('NATIVE16_AUTO_TUNE_PASS',JSON.stringify({
   type,mode:await page.locator('#video-mode').inputValue(),status}));
 }
}finally{await browser.close();}
