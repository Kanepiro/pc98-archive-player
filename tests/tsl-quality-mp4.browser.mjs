// End-to-end test for mode-3 XDoG glyph matching and independent MP4 export.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';

const url=process.env.PLAYER_URL||'http://127.0.0.1:4197/';
const out=process.env.QUALITY_TEST_DIR||'/tmp/pc98-v0312-quality';
await mkdir(out,{recursive:true});
const src=join(out,'thin-contours.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-nostdin',
 '-f','lavfi','-i','color=c=0x888888:s=640x360:r=10',
 '-vf','drawbox=x=100:y=65:w=190:h=230:color=0x666666:t=fill,'
    +'drawbox=x=350:y=80:w=180:h=220:color=0x444444:t=fill,'
    +'drawbox=x=350:y=150:w=180:h=8:color=0xeeeeee:t=fill',
 '-t','2','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',src]);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(url);await page.click('#tab-converter');
 await page.selectOption('#video-mode','landscape');
 await page.selectOption('#video-style','quality');
 await page.setInputFiles('#video-file',src);
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>/変換が完了しました|変換できません/.test(document.querySelector('#converter-status').textContent),null,{timeout:60000});
 assert.equal(await page.locator('#converter-status').textContent(),'変換が完了しました');
 const event=page.waitForEvent('download');await page.click('#tsl-download');const item=await event;
 const bytes=await readFile(await item.path()),data=parseTSL(new TextDecoder('shift_jis').decode(bytes));
 assert.equal(data.width,128);assert.equal(data.height,36);
 const active=new Set([...data.frames.join('')].filter(x=>x!==' '&&x!=='\n'&&x!=='\r'));
 assert.ok(active.size>=4,'few contour shapes: '+[...active].join(''));
 const bgCount=[...data.frames.join('')].filter(x=>x===' ').length;
 assert.ok(bgCount>0,'expected a mix of empty and filled cells');
 await page.click('#preview-tsl');
 await page.waitForFunction(()=>document.querySelector('#filename').textContent.endsWith('_Mode3.TSL'));
 const mp4event=page.waitForEvent('download',{timeout:90000});await page.click('#export-mp4');const mp4=await mp4event;
 const path=join(out,'mode3.mp4');await mp4.saveAs(path);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,width,height','-show_entries','format=duration','-of','json',path],{encoding:'utf8'}));
 assert.equal(probe.streams[0].codec_name,'h264');
 assert.equal(probe.streams[0].width,1920);
 assert.equal(probe.streams[0].height,1080);
 assert.ok(+probe.format.duration>=1.9);
 assert.deepEqual(errors,[]);
 console.log('MODE3 VIDEO->TSL->MP4 PASS',JSON.stringify({activeGlyphs:[...active],frames:data.frames.length,mp4:probe.streams[0],duration:probe.format.duration}));
}finally{await browser.close();}
