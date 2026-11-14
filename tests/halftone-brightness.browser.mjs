// Regression: Mode 2 renders white video pixels as the brightest ◎ glyph,
// dark video pixels as a blank character cell, AND explains this honestly.
// The old build had this reversed in both algorithm and page copy.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39084/');
 await page.click('#tab-converter');
 const note=await page.locator('.converter-note').textContent();
 assert.ok(note.includes('黒い部分は空白、白い部分は最も明るい「◎」になります。'),
  'Mode 2 user-facing explanation still reverses its light/dark mapping');
 assert.ok(!(note.includes('暗部は「◎」になります')),
  'Misleading Mode 2 explanation remains');
 const found=await page.evaluate(async()=>{
  const {rgbaToHalftone,HALFTONE_TONES}=await import('/tsl-halftone.js');
  function make(gray){
   const W=8,H=4,S=4;
   const pixels=new Uint8ClampedArray(W*H*S*S*4);
   for(let i=0;i<pixels.length;i+=4){
    pixels[i]=pixels[i+1]=pixels[i+2]=gray;
    pixels[i+3]=255;
   }
   return rgbaToHalftone(pixels,W,H,{sample:S}).split('\r\n')[0];
  }
  return {shades:[0,76,128,180,255].map(make),
   tones:[...HALFTONE_TONES],version:document.querySelector('header .brand p').textContent};
 });
 assert.deepEqual(found.shades,[
  '　'.repeat(4),'。'.repeat(4),'ｏ'.repeat(4),
  '○'.repeat(4),'◎'.repeat(4)
 ],'Mode 2 does not go from darkest blank to brightest ◎');
 assert.deepEqual(found.tones,['　','。','ｏ','○','◎']);
 assert.match(found.version,/v0\.3\.37/);
 console.log('PASS v0.3.37 Mode2: black → blank, white → ◎, all five brightness levels and Japanese explanation agree');
}finally{await browser.close();}
