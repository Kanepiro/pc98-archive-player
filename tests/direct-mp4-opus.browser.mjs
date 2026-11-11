// One-click source MP4 -> TASL video + original sound -> MP4.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const root=process.env.QUALITY_TEST_DIR||'/tmp/pc98-direct-mp4-opus-qc';
await mkdir(root,{recursive:true});
const source=join(root,'source-tone.webm');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',
 'testsrc2=size=320x180:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
 '-t','2.2','-c:v','libvpx','-deadline','realtime','-cpu-used','8','-b:v','500k',
 '-c:a','libopus','-b:a','96k',source]);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
 const errors=[];
 const uploads=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))uploads.push(r.method()+':'+r.url());});
 await page.goto(process.env.PLAYER_URL||'http://127.0.0.1:4188/');
 await page.click('#tab-converter');
 assert.equal(await page.locator('#video-direct-mp4').count(),1);
 await page.check('#video-direct-mp4');
 await page.selectOption('#video-mode','landscape');
 await page.selectOption('#video-fps','5');
 await page.setInputFiles('#video-file',source);
 const downloadPromise=page.waitForEvent('download',{timeout:180000});
 await page.click('#convert-tsl');
 const download=await downloadPromise;
 const save=join(root,'source-tone_opus_TASL_音声付き.mp4');
 await download.saveAs(save);
 await page.waitForFunction(()=>/音声付きMP4の保存準備が完了しました|MP4作成に失敗|変換できません/.test(document.querySelector('#converter-status').textContent),null,{timeout:20000});
 const status=await page.locator('#converter-status').textContent();
 assert.match(status,/保存準備が完了/);
 assert.ok(download.suggestedFilename().includes('_TASL_音声付き.mp4'));
 assert.equal(await page.locator('#direct-mp4-download').isVisible(),true);
 assert.equal(await page.locator('#tsl-download').isVisible(),true);
 const ffprobe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,duration,width,height','-of','json',save],{encoding:'utf8'}));
 const audio=ffprobe.streams.find(s=>s.codec_type==='audio');
 const video=ffprobe.streams.find(s=>s.codec_type==='video');
 assert.equal(audio?.codec_name,'aac');
 assert.equal(video?.codec_name,'h264');
 assert.equal(video.width,1920);
 assert.equal(video.height,1080);
 assert.ok(Math.abs(Number(ffprobe.format.duration)-2.2)<.16,JSON.stringify(ffprobe));
 execFileSync('ffmpeg',['-v','error','-i',save,'-f','null','-']);
 const measure=execFileSync('ffmpeg',['-hide_banner','-nostdin','-i',save,'-map','0:a:0','-af','volumedetect','-f','null','-'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}); 
 assert.equal(errors.length,0,JSON.stringify(errors));
 assert.deepEqual(uploads,[]);
 console.log(JSON.stringify({status,source,save,ffprobe,errors,uploads},null,2));
}finally{await browser.close();}
