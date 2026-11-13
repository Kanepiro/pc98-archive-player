import {chromium} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const url=process.env.PLAYER_URL||'http://127.0.0.1:4482/';
const dest='/tmp/tasl-mode4-structure-comparison';
await mkdir(dest,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1000,height:900}});
try{
 await page.goto(url,{waitUntil:'load'});
 const result=await page.evaluate(async()=>{
  const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');
  const {ArtisanComposer}=await import('/tsl-artisan-engine.js');
  const {QualityConverter}=await import('/tsl-quality.js');
  const S=10,atlas=await makeArtisanGlyphAtlas(S);
  const master=document.createElement('canvas');master.width=640;master.height=360;
  const c=master.getContext('2d');
  c.fillStyle='#f5f5f5';c.fillRect(0,0,640,360);
  c.strokeStyle='#171717';c.lineCap='round';c.lineJoin='round';
  // Simple stylized portrait: face outline, hair, eyes, nose, mouth and neck.
  c.lineWidth=5;c.beginPath();c.ellipse(320,183,95,122,0,0,Math.PI*2);c.stroke();
  c.lineWidth=7;c.beginPath();
  c.moveTo(234,160);c.quadraticCurveTo(218,60,316,49);
  c.quadraticCurveTo(425,38,420,162);
  c.moveTo(246,124);c.quadraticCurveTo(286,88,290,122);
  c.moveTo(291,120);c.quadraticCurveTo(355,68,360,126);
  c.moveTo(362,125);c.quadraticCurveTo(390,89,401,143);
  c.stroke();
  // Eyelashes and pupils.
  c.lineWidth=5;
  c.beginPath();c.moveTo(254,185);c.quadraticCurveTo(286,169,303,188);
  c.moveTo(339,189);c.quadraticCurveTo(369,171,391,185);c.stroke();
  c.fillStyle='#171717';c.beginPath();c.ellipse(282,196,7,17,0,0,Math.PI*2);
  c.ellipse(363,197,7,17,0,0,Math.PI*2);c.fill();
  c.lineWidth=3;c.beginPath();c.moveTo(315,192);c.lineTo(309,224);c.lineTo(325,230);
  c.moveTo(288,254);c.quadraticCurveTo(322,272,352,254);c.stroke();
  c.lineWidth=5;c.beginPath();c.moveTo(276,291);c.lineTo(269,333);
  c.moveTo(369,290);c.lineTo(377,333);c.stroke();
  // Repeated line segments to test actual connections and continuity.
  c.lineWidth=4;c.beginPath();c.moveTo(90,80);c.lineTo(175,170);c.lineTo(92,262);
  c.moveTo(455,80);c.lineTo(539,170);c.lineTo(462,262);c.stroke();
  function raster(w,h){
   const small=document.createElement('canvas');small.width=w*S;small.height=h*S;
   const ctx=small.getContext('2d',{willReadFrequently:true});
   ctx.drawImage(master,0,0,small.width,small.height);
   return ctx.getImageData(0,0,small.width,small.height).data;
  }
  const results=[];
  for(const [w,h] of [[32,9],[64,18]]){
   const px=raster(w,h);
   const old=new QualityConverter(atlas,S,{artisan:true});
   const a=performance.now(),oldText=old.convert(px,w,h),oldMs=performance.now()-a;
   const newEngine=new ArtisanComposer(atlas,S);
   const b=performance.now(),newText=newEngine.convert(px,w,h),newMs=performance.now()-b;
   results.push({w,h,oldText,newText,oldMs,newMs,diagnostics:newEngine.lastDiagnostics});
  }
  return results;
 });
 for(const v of result){
  await writeFile(join(dest,'mode4_comparison_'+v.w+'x'+v.h+'.txt'),
   'BEFORE MODE4\n'+v.oldText+'\n\nSTRUCTURAL MODE4\n'+v.newText+
   '\n'+JSON.stringify(v.diagnostics,null,2),'utf8');
  console.log('MODE4_COMPARE',v.w+'x'+v.h,JSON.stringify({
   oldMs:Math.round(v.oldMs),newMs:Math.round(v.newMs),
   initialEnergy:v.diagnostics.initial.total,finalEnergy:v.diagnostics.final.total,
   firstOld:v.oldText.split('\r\n').slice(0,5),
   firstNew:v.newText.split('\r\n').slice(0,5)
  }));
 }
}finally{await browser.close();}
