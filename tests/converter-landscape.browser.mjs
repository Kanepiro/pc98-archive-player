// Browser end-to-end: an unrotated 16:9 MP4 -> landscape TSL -> Full HD MP4.
// The sample has a bright stripe on the LEFT to catch accidental 90-degree rotation.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';

const url=process.env.PLAYER_URL||'http://127.0.0.1:4189/';
const out=process.env.QUALITY_TEST_DIR||'/tmp/pc98-landscape-16x9-qc';
await mkdir(out,{recursive:true});
const source=join(out,'landscape-pattern.mp4');
execFileSync('ffmpeg',['-y','-nostdin','-hide_banner','-loglevel','error',
 '-f','lavfi','-i','color=c=black:s=640x360:r=24',
 '-vf','drawbox=x=0:y=0:w=220:h=360:color=white:t=fill',
 '-t','1.25','-an','-c:v','libx264','-preset','ultrafast',
 '-pix_fmt','yuv420p',source]);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
 const errors=[],uploads=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))uploads.push({method:r.method(),url:r.url()});});
 await page.goto(url);await page.click('#tab-converter');
 await page.selectOption('#video-mode','landscape');
 assert.match(await page.locator('#layout-hint').textContent(),/128列 × 36行/);
 assert.match(await page.locator('#layout-hint').textContent(),/文字は回転しません/);
 assert.equal(await page.locator('#video-font-px').inputValue(),'24');
 await page.selectOption('#video-fps','24');
 await page.setInputFiles('#video-file',source);
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>/変換が完了しました|変換できません/.test(document.querySelector('#converter-status').textContent),null,{timeout:120000});
 assert.equal(await page.locator('#converter-status').textContent(),'変換が完了しました');
 assert.match(await page.locator('#converter-detail').textContent(),/128 × 36文字/);
 const [tslDownload]=await Promise.all([page.waitForEvent('download'),page.click('#tsl-download')]);
 const bytes=await readFile(await tslDownload.path());
 const decoded=parseTSL(new TextDecoder('shift_jis').decode(bytes));
 assert.deepEqual({width:decoded.width,height:decoded.height},{width:128,height:36});
 assert.ok(decoded.frames.length>=25);
 const middle=decoded.frames[0].split('\n')[18];
 assert.notEqual(middle[10],' ','bright LEFT stripe must be visible in the left columns');
 assert.equal(middle[110],' ','dark RIGHT side must remain dark and on the right');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.click('#preview-tsl');
 await page.waitForFunction(()=>document.querySelector('#filename').textContent==='landscape-pattern.TSL');
 const dimensions=await page.locator('#screen').evaluate(c=>({width:c.width,height:c.height}));
 assert.deepEqual(dimensions,{width:1536,height:864},'TSL preview glyphs must be unrotated landscape 16:9');
 const [mp4Download]=await Promise.all([page.waitForEvent('download',{timeout:90000}),page.click('#export-mp4')]);
 const mp4=join(out,'landscape-reexport.mp4');
 await mp4Download.saveAs(mp4);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0',
  '-show_entries','stream=codec_name,width,height','-of','json',mp4],{encoding:'utf8'}));
 assert.deepEqual({width:probe.streams[0].width,height:probe.streams[0].height,codec:probe.streams[0].codec_name},
  {width:1920,height:1080,codec:'h264'});
 assert.match(await page.locator('#status').textContent(),/1920×1080/);
 // A completed resume checkpoint must restore the new mode and its settings.
 await page.reload();await page.click('#tab-converter');
 await page.setInputFiles('#video-file',source);
 await page.waitForFunction(()=>document.querySelector('#convert-tsl').textContent==='結果を復元',null,{timeout:12000});
 assert.equal(await page.locator('#video-mode').inputValue(),'landscape');
 assert.equal(await page.locator('#video-fps').inputValue(),'24');
 assert.deepEqual(errors,[]);assert.deepEqual(uploads,[]);
 console.log(JSON.stringify({status:'pass',tsl:{width:decoded.width,height:decoded.height,frames:decoded.frames.length},
  preview:dimensions,mp4:probe.streams[0],checkpoint:'restored landscape settings',out},null,2));
} finally{await browser.close();}
