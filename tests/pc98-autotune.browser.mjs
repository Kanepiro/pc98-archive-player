// Reproduce the recommended tone-settings button under each PC-98 configuration.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const root='/tmp/tasl-pc98-autotune-repro';await mkdir(root,{recursive:true});
const src=join(root,'source.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-nostdin',
 '-f','lavfi','-i','testsrc2=size=640x360:rate=12:duration=2',
 '-pix_fmt','yuv420p','-c:v','libx264','-preset','ultrafast',src]);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.PLAYER_URL||'http://127.0.0.1:4488/');
 await page.click('#tab-converter');
 await page.setInputFiles('#video-file',src);
 for(const style of ['artisan','legacy','halftone','quality']){
  await page.selectOption('#video-style',style);
  await page.selectOption('#video-mode','pc98');
  assert.equal(await page.locator('#video-font-render').inputValue(),'native16');
  assert.equal(await page.locator('#video-font-render').isDisabled(),true);
  assert.equal(await page.locator('#video-size').count(),0);
  await page.waitForFunction(()=>document.getElementById('layout-hint').textContent.includes('全角40×22文字相当'),null,{timeout:30000});
  await page.click('#auto-tune');
  await page.waitForFunction(()=>/場面を解析|解析できませんでした|濃淡が少なく/.test(document.querySelector('#auto-tune-status').textContent),null,{timeout:120000});
  const status=await page.locator('#auto-tune-status').textContent();
  assert.match(status,/場面を解析/,'PC-98 '+style+': '+status);
  console.log('PC98_AUTO_TUNE_PASS',JSON.stringify({style,grid:'全角40×22',status}));
 }
 console.log('PAGE_ERRORS',JSON.stringify(errors));
}finally{await browser.close();}
