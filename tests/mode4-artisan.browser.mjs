// Mode 4 end-to-end: exhaustive CP932 visual atlas, real browser video conversion.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {parseTSL} from '../public/tsl.js';
const url=process.env.PLAYER_URL||'http://127.0.0.1:4479/';
const out=process.env.MODE4_TEST_DIR||'/tmp/tasl-mode4-test';
await mkdir(out,{recursive:true});
const src=join(out,'mode4-aa-silhouette.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-nostdin',
 '-f','lavfi','-i','color=c=0xe0e0e0:s=640x360:r=5',
 '-vf','drawbox=x=245:y=30:w=160:h=290:color=0x111111:t=8,drawbox=x=290:y=100:w=24:h=20:color=white:t=fill,drawbox=x=350:y=100:w=24:h=20:color=white:t=fill,drawbox=x=297:y=230:w=67:h=12:color=white:t=fill',
 '-t','1.4','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',src]);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:414,height:896},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(url,{waitUntil:'load'});
 await page.click('#tab-converter');
 assert.equal(await page.locator('#video-font-px').inputValue(),'24');
 await page.selectOption('#video-mode','landscape');
 await page.selectOption('#video-style','artisan');
 assert.equal(await page.locator('#video-font-px').inputValue(),'96');
 const glyphs=await page.evaluate(async()=>{
  const {makeArtisanGlyphAtlas}=await import('/tsl-artisan.js');
  const {MODE4_ALLOWED_CHARS}=await import('/mode4-allowed.js');
  const atlas=await makeArtisanGlyphAtlas(6);
  const allowed=new Set([...MODE4_ALLOWED_CHARS,' ']);
  return {
   count:atlas.length,
   listCount:MODE4_ALLOWED_CHARS.length,
   extra:atlas.filter(x=>!allowed.has(x.char)).map(x=>x.char),
   missing:MODE4_ALLOWED_CHARS.split('').filter(c=>!atlas.some(x=>x.char===c)),
   kanji:atlas.some(x=>x.char==='川'),
   forbidden:atlas.some(x=>x.char==='鬱'||x.char==='森'||x.char==='#'||x.char==='A')
  };
 });
 assert.equal(glyphs.listCount,802);
 assert.equal(glyphs.count,803);
 assert.deepEqual(glyphs.extra,[]);
 assert.deepEqual(glyphs.missing,[]);
 assert.equal(glyphs.kanji,true);
 assert.equal(glyphs.forbidden,false);
 console.log('MODE4_ATLAS',JSON.stringify({count:glyphs.count,listCount:glyphs.listCount,extra:glyphs.extra.length,missing:glyphs.missing.length}));
 await page.setInputFiles('#video-file',src);
 await page.click('#convert-tsl');
 await page.waitForFunction(()=>/変換が完了しました|変換できません/.test(document.querySelector('#converter-status').textContent),null,{timeout:360000});
 const status=await page.locator('#converter-status').textContent();
 assert.equal(status,'変換が完了しました','Browser conversion failed: '+status);
 const download=page.waitForEvent('download');await page.click('#tsl-download');const file=await download;
 assert.equal(file.suggestedFilename(),'mode4-aa-silhouette_Mode4.TSL');
 const bytes=await readFile(await file.path()),data=parseTSL(new TextDecoder('shift_jis').decode(bytes));
 assert.ok(data.frames.length>=5);assert.ok(data.width<=45&&data.width>=26);
 const lines=data.frames[0].split('\n');
 assert.equal(lines.length,data.height);
 const characters=new Set([...data.frames.join('')].filter(c=>c.trim()&&c!=='\n'));
 assert.ok(characters.size>=2,'No AA detail: '+JSON.stringify([...characters]));
 const decodedText=[...data.frames.join('').replaceAll('\n','')].filter(x=>x!==' ');
 const whitelist=await page.evaluate(async()=>{const m=await import('/mode4-allowed.js');return m.MODE4_ALLOWED_CHARS;});
 const allowed=new Set([...whitelist]);
 assert.deepEqual(decodedText.filter(c=>!allowed.has(c)),[],"TSL contained a non-whitelisted character");

 assert.deepEqual(errors,[]);
 console.log('MODE4_E2E_PASS',JSON.stringify({bytes:bytes.length,frames:data.frames.length,grid:[data.width,data.height],chars:characters.size,preview:lines.slice(0,6)}));
 await page.click('#preview-tsl');
 await page.waitForFunction(()=>document.querySelector('#filename').textContent.endsWith('_Mode4.TSL'));
 await page.screenshot({path:join(out,'mode4-ui.png')});
}finally{await browser.close();}
