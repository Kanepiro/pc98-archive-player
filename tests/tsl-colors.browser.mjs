import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {makePlan,TSLWriter} from '../public/tsl-converter-core.js';

const url=process.env.PLAYER_URL||'http://127.0.0.1:4198/';
const out=process.env.QUALITY_TEST_DIR||'/tmp/pc98-tsl-colors';
await mkdir(out,{recursive:true});
const plan=makePlan(1.5,{width:45,height:40,fps:2});
const writer=new TSLWriter(plan);
for(let i=0;i<plan.count;i++){
 const lines=Array.from({length:40},(_,y)=>{
   if(y>=25)return ' '.repeat(45);
   return (i%2===0?'#':'O').repeat(20)+' '.repeat(25);
 });
 writer.append(lines.join('\r\n')+'\r\n');
}
const original=Buffer.from(await writer.finish().arrayBuffer());
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
const errors=[],uploads=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))uploads.push(r.url());});
async function pixelSummary(){
 return page.locator('#screen').evaluate(c=>{
  const p=c.getContext('2d').getImageData(0,0,c.width,c.height);
  const i=((c.height-1)*c.width+c.width-1)*4;
  let redPixels=0,greenPixels=0;
  for(let j=0;j<p.data.length;j+=4){
   if(p.data[j]>180&&p.data[j+1]<80&&p.data[j+2]<100)redPixels++;
   if(p.data[j+1]>180&&p.data[j]<80&&p.data[j+2]<100)greenPixels++;
  }
  return {background:[...p.data.slice(i,i+3)],redPixels,greenPixels};
 });
}
async function setColor(id,value){
 await page.locator(id).evaluate((el,v)=>{
  el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));
 },value);
}
try{
 await page.goto(url);
 assert.equal(await page.locator('#tsl-colors').isVisible(),true);
 await page.setInputFiles('#file',{name:'original.TSL',mimeType:'application/octet-stream',buffer:original});
 await page.waitForFunction(()=>document.querySelector('#filename').textContent==='original.TSL');
 assert.equal(await page.locator('#tsl-colors').isVisible(),true);
 assert.equal(await page.locator('#tsl-text-color').inputValue(),'#e3f4e8');
 assert.equal(await page.locator('#tsl-bg-color').inputValue(),'#080d12');
 await setColor('#tsl-text-color','#ff0033');
 await setColor('#tsl-bg-color','#112244');
 let pixels=await pixelSummary();
 assert.deepEqual(pixels.background,[17,34,68]);
 assert.ok(pixels.redPixels>100,'No red glyphs rendered');
 await page.click('#play');
 await page.waitForTimeout(250);
 await setColor('#tsl-text-color','#00ff22');
 pixels=await pixelSummary();
 assert.deepEqual(pixels.background,[17,34,68]);
 assert.ok(pixels.greenPixels>100,'On-the-fly recoloring during playback failed');
 await page.click('#stop');
 await setColor('#tsl-text-color','#ff0033');
 await page.screenshot({path:join(out,'tsl-color-player.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const [file]=await Promise.all([page.waitForEvent('download',{timeout:90000}),page.click('#export-mp4')]);
 const mp4=join(out,'colored.mp4');
 await file.saveAs(mp4);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,codec_name','-of','json',mp4],{encoding:'utf8'}));
 const {width,height,codec_name}=probe.streams[0];
 assert.equal(codec_name,'h264');
 assert.equal(width,1080);assert.equal(height,1920);
 const bg=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',mp4,'-frames:v','1','-vf','crop=16:16:'+(width-16)+':'+(height-16),'-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
 const last=[bg[0],bg[1],bg[2]];
 for(let k=0;k<3;k++)assert.ok(Math.abs(last[k]-[17,34,68][k])<25,'Incorrect MP4 background '+last);
 const crop=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',mp4,'-frames:v','1','-vf','crop=280:400:0:0','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
 let reds=0;for(let i=0;i<crop.length;i+=3)if(crop[i]>140&&crop[i]>crop[i+1]*1.9&&crop[i]>crop[i+2]*1.5)reds++;
 assert.ok(reds>300,'Incorrect MP4 text foreground: '+reds+' red pixels');
 assert.ok(original.length>0);
 await page.click('#demo');
 await page.waitForFunction(()=>document.querySelector('#kind').textContent==='MMS');
 assert.equal(await page.locator('#tsl-colors').isVisible(),true);
 assert.deepEqual(errors,[]);
 assert.deepEqual(uploads,[]);
 console.log(JSON.stringify({status:'PASS',playerBackground:pixels.background,playerGreenGlyphs:pixels.greenPixels,mp4:{width,height,bg:last,redPixels:reds},sourceBytes:original.length}));
}finally{await browser.close();}
