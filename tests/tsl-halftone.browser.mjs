// Mode 2 E2E: video -> TSL -> TSL viewer -> MP4, with strict palette check.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';

const url=process.env.PLAYER_URL||'http://127.0.0.1:4283/';
const out=process.env.MODE2_TEST_DIR||'/tmp/pc98-mode2-e2e-20261112';
await mkdir(out,{recursive:true});
const src=join(out,'mode2-test.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-nostdin',
 '-f','lavfi','-i','color=c=0x777777:s=640x360:r=10',
 '-vf',['00','40','80','bf','ff'].map((v,i)=>
   'drawbox=x='+Math.floor(640*i/5)+':y=0:w=128:h=360:color=0x'+v.repeat(3)+':t=fill').join(','),
 '-t','1.8','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',src]);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(url);
 await page.click('#tab-converter');
 const choices=await page.locator('#video-style option').evaluateAll(a=>a.map(x=>x.value));
 assert.deepEqual(choices,['legacy','halftone','quality']);
 await page.selectOption('#video-mode','landscape');
 await page.selectOption('#video-style','halftone');
 assert.equal(await page.locator('#tone-edge').isVisible(),false);
 await page.setInputFiles('#video-file',src);
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>/変換が完了しました|変換できません/.test(document.querySelector('#converter-status').textContent),null,{timeout:120000});
 assert.equal(await page.locator('#converter-status').textContent(),'変換が完了しました');
 const download=page.waitForEvent('download');await page.click('#tsl-download');const file=await download;
 assert.equal(file.suggestedFilename(),'mode2-test_Mode2.TSL');
 const bytes=await readFile(await file.path()),tsl=parseTSL(new TextDecoder('shift_jis').decode(bytes));
 assert.equal(tsl.width,128);assert.equal(tsl.height,36);assert.ok(tsl.frames.length>=17);
 const all=new Set([...tsl.frames.join('').replaceAll('\n','')]);
 assert.ok([...all].every(x=>['　','。','ｏ','○','◎'].includes(x)),`unexpected symbols: ${[...all].join(' ')}`);
 for(const char of ['　','。','ｏ','○','◎']) assert.ok(all.has(char),`expected 5-tone ${char}`);
 await page.click('#preview-tsl');
 await page.waitForFunction(()=>document.querySelector('#filename').textContent.endsWith('_Mode2.TSL'),null,{timeout:10000});
 const mp4Event=page.waitForEvent('download',{timeout:120000});await page.click('#export-mp4');const mp4=await mp4Event;
 const path=join(out,'mode2-final.mp4');await mp4.saveAs(path);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,width,height','-show_entries','format=duration','-of','json',path],{encoding:'utf8'}));
 assert.ok(probe.streams.some(s=>s.codec_name==='h264'));
 assert.ok(probe.format.duration>1.7);
 const stream=probe.streams.find(s=>s.codec_name==='h264');
 assert.equal(stream.width,1920);assert.equal(stream.height,1080);
 assert.deepEqual(errors,[]);
 console.log('MODE 2 E2E PASS',JSON.stringify({chars:[...all],tslBytes:bytes.length,frames:tsl.frames.length,mp4:stream,duration:probe.format.duration}));
}finally{await browser.close();}
