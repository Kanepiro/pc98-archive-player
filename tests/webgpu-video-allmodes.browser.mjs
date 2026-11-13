import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';
const url=process.env.PLAYER_URL||'http://127.0.0.1:4485/';
const out='/tmp/tasl-gpu-all-e2e';
await mkdir(out,{recursive:true});
const src=join(out,'allmodes.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-nostdin',
 '-f','lavfi','-i','color=c=0xd0d0d0:s=640x360:r=5',
 '-vf','drawbox=x=220:y=25:w=155:h=285:color=0x222222:t=7,'+
 'drawbox=x=251:y=93:w=22:h=12:color=0xeeeeee:t=fill,'+
 'drawbox=x=310:y=95:w=22:h=12:color=0xeeeeee:t=fill',
 '-t','1.0','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',src]);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',
 args:['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader']});
try{
 for(const mode of ['legacy','halftone','quality','artisan']){
  const page=await browser.newPage({acceptDownloads:true,viewport:{width:420,height:880}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url,{waitUntil:'load'});
  await page.click('#tab-converter');
  await page.selectOption('#video-mode','landscape');
  await page.selectOption('#video-style',mode);
  await page.setInputFiles('#video-file',src);
  const tracker=[];
  await page.exposeFunction('gpuTrack',s=>tracker.push(s));
  await page.evaluate(()=>{
   const el=document.querySelector('#converter-detail');
   new MutationObserver(()=>window.gpuTrack(el.textContent)).observe(el,{childList:true,subtree:true,characterData:true});
  });
  await page.click('#convert-tsl');
  await page.waitForFunction(()=>/変換が完了しました|変換できません/.test(document.querySelector('#converter-status').textContent),
   null,{timeout:180000});
  const status=await page.locator('#converter-status').textContent();
  assert.equal(status,'変換が完了しました',mode+' conversion: '+status);
  const saved=page.waitForEvent('download');await page.click('#tsl-download');const file=await saved;
  const bytes=await readFile(await file.path());
  const data=parseTSL(new TextDecoder('shift_jis').decode(bytes));
  assert.ok(data.frames.length>=5);
  assert.deepEqual(errors,[]);
  const gpu=tracker.some(s=>s.includes('WebGPU使用'));
  const cpu=tracker.some(s=>s.includes('CPU処理'));
  assert.ok(gpu,mode+' should use WebGPU when a tested GPU adapter is available');
  console.log('GPU_ALL_E2E',JSON.stringify({mode,gpu,cpu,grid:[data.width,data.height],
   frames:data.frames.length,status,preview:data.frames[0].split('\n').slice(0,2)}));
  await page.close();
 }
}finally{await browser.close();}
