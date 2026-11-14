// Windows CI end-to-end: PC Boost EXE -> Chrome -> TSL -> native MP4 (GPU/CPU).
// The Windows runner has no NVIDIA board: it must exercise automatic CPU fallback.
import {chromium} from 'playwright';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const temp=mkdtempSync(join(tmpdir(),'tasl-nvenc-e2e-'));
const input=join(temp,'with_audio.mp4');
const ffmpeg=process.env.FFMPEG_BIN||'ffmpeg';
const ffprobe=process.env.FFPROBE_BIN||'ffprobe';
const r=spawnSync(ffmpeg,['-hide_banner','-v','error','-f','lavfi','-i',
 'testsrc2=size=320x240:rate=24','-f','lavfi','-i',
 'sine=frequency=440:sample_rate=48000','-t','2',
 '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
 '-c:a','aac','-b:a','128k','-shortest','-y',input],{encoding:'utf8'});
if(r.status!==0)throw Error('Source video/audio fixture failed: '+r.stderr);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1200,height:900},acceptDownloads:true});
 page.on('pageerror',e=>console.error('BROWSER ERROR',e.message));
 await page.goto(process.env.BOOST_UI_URL||'http://127.0.0.1:39083/');
 await page.click('#tab-converter');
 if(!(await page.isChecked('#video-pc-boost')))throw Error('Local PC Boost not enabled');
 await page.selectOption('#video-mode','pc98');
 await page.selectOption('#video-style','artisan');
 await page.selectOption('#video-fps','5');
 await page.check('#video-direct-mp4');
 await page.setInputFiles('#video-file',input);
 await page.waitForFunction(()=>document.querySelector('#video-name').textContent.includes('320×240'));
 const download=page.waitForEvent('download',{timeout:150000});
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>{
  const status=document.querySelector('#converter-status').textContent;
  return status.includes('MP4の保存準備が完了')||
    status.includes('MP4作成に失敗')||status.includes('変換できません');
 },null,{timeout:150000});
 const status=await page.locator('#converter-status').textContent();
 console.log('Native MP4 status:',status);
 if(!status.includes('MP4の保存準備が完了'))throw Error(status);
 const downloaded=await download;
 const path=await downloaded.path();
 if(!path)throw Error('Missing MP4 download file');
 const info=spawnSync(ffprobe,['-v','error','-show_entries',
  'stream=codec_type,codec_name,width,height:format=duration',
  '-of','json',path],{encoding:'utf8'});
 if(info.status!==0)throw Error('Produced MP4 failed ffprobe: '+info.stderr);
 const media=JSON.parse(info.stdout);
 const video=media.streams.find(x=>x.codec_type==='video');
 const audio=media.streams.find(x=>x.codec_type==='audio');
 console.log('MP4 probe:',JSON.stringify(media));
 if(video?.codec_name!=='h264'||video.width!==320||video.height!==240||
    audio?.codec_name!=='aac'||
    Math.abs(Number(media.format.duration)-2)>0.5)
  throw Error('Incorrect video, audio or duration');
 if(process.env.EXPECT_CPU_FALLBACK==='1'&&!status.includes('libx264 (CPU)'))
  throw Error('NVIDIA-free runner must use CPU fallback, not claim GPU');
 console.log('PASS: Windows EXE -> native renderer -> FFmpeg H.264/AAC MP4 -> browser download');
}finally{
 await browser.close();
 rmSync(temp,{recursive:true,force:true});
}
