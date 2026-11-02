import {chromium} from '@playwright/test';
import {mkdir,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
await mkdir('verification/private',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
const results={environment:'Linux Chrome / 390x844 mobile viewport; not a physical Android device',checks:[],errors};
try{
 await page.goto(process.env.PLAYER_URL||'http://127.0.0.1:4173/');
 await page.locator('#offline').filter({hasText:'準備済み'}).waitFor({timeout:20000});
 assert.equal(await page.locator('#empty').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'verification/mobile-ui.png',fullPage:true});results.checks.push('Mobile layout fits 390px');
 await page.click('#demo');await page.waitForFunction(()=>!document.getElementById('play').disabled);
 assert.equal(await page.locator('#empty').isVisible(),false);
 await page.click('#play');
 await page.waitForFunction(()=>window.playerDiagnostics.seconds>=3,{},{timeout:30000});
 await page.evaluate(()=>{
  window.testBusy=setInterval(()=>{const end=performance.now()+150;while(performance.now()<end){}},1000);
 });
 await page.waitForTimeout(6000);await page.evaluate(()=>clearInterval(window.testBusy));
 results.continuity=await page.evaluate(()=>window.playerDiagnostics);
 assert.equal(results.continuity.gapSamples,0);assert.ok(results.continuity.frames>300);
 await page.screenshot({path:'verification/mobile-demo.png',fullPage:true});results.checks.push('Continuous MMS audio with 150ms main-thread stalls for 6s');
 await page.click('#stop');await page.waitForTimeout(150);const stopped=await page.evaluate(()=>window.playerDiagnostics.seconds);
 await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.playerDiagnostics.seconds),stopped);results.checks.push('Stop releases playback');
 await context.setOffline(true);await page.reload();await page.locator('#demo').waitFor();await page.click('#demo');await page.waitForFunction(()=>!document.getElementById('play').disabled);await page.click('#play');
 await page.waitForFunction(()=>window.playerDiagnostics.seconds>1,{},{timeout:20000});await page.click('#stop');results.checks.push('Offline reload and cached MMS playback');await context.setOffline(false);
 for(const [dir,ext] of [['reference/MAG','.mag'],['reference/TASL','.tsl']]){
  const names=(await readdir(dir)).filter(n=>n.toLowerCase().endsWith(ext)).sort();
  const name=names[0];await page.setInputFiles('#file',resolve(dir,name));await page.waitForFunction(()=>document.getElementById('filename').textContent!=='ContinuityTest.MMS');
  if(ext==='.tsl'){await page.click('#play');await page.waitForTimeout(1100);await page.click('#stop');}
  results.checks.push(name+' opened in UI');await page.screenshot({path:'verification/private/'+ext.slice(1)+'.png',fullPage:true});
 }
 for(const name of ['ALV_MM03.MMS','ESP_NAD0.MMS']){
  await page.setInputFiles('#file',resolve('../mmasl_player_20261102/reference/MMS',name));await page.waitForFunction(n=>document.getElementById('filename').textContent===n,name);await page.click('#play');
  await page.waitForFunction(()=>window.playerDiagnostics.seconds>=10,{},{timeout:40000});
  results[name]=await page.evaluate(()=>window.playerDiagnostics);await page.click('#stop');assert.equal(results[name].gapSamples,0);assert.ok(results[name].frames>0);
  await page.screenshot({path:'verification/private/'+name+'.png',fullPage:true});
 }
 await page.setInputFiles('#file',{name:'bad.MMS',mimeType:'application/octet-stream',buffer:Buffer.from('invalid')});
 await page.waitForFunction(()=>document.getElementById('filename').textContent==='bad.MMS');await page.click('#play');await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('再生できません'));
 results.checks.push('Corrupt MMS handled without page crash');
 await page.click('#demo');await page.waitForFunction(()=>!document.getElementById('play').disabled);await page.click('#play');await page.waitForFunction(()=>window.playerDiagnostics.seconds>1);await page.click('#stop');results.checks.push('Playback recovers after invalid file');
 await page.click('#play');await page.waitForFunction(()=>document.getElementById('status').textContent==='再生が終了しました',{},{timeout:25000});results.normalEnd=await page.evaluate(()=>window.playerDiagnostics);assert.equal(results.normalEnd.gapSamples,0);assert.ok(results.normalEnd.frames>600);results.checks.push('MMS completes with audio output drained');
 const remote=requests.filter(r=>!r.url.startsWith(process.env.PLAYER_URL||'http://127.0.0.1:4173/'));assert.deepEqual(remote,[]);results.checks.push('No external requests / no artwork uploads');
 assert.deepEqual(errors,[]);results.status='pass';
}catch(e){results.status='fail';results.failure=e.stack;process.exitCode=1;await page.screenshot({path:'verification/private/failure.png',fullPage:true}).catch(()=>{});}
finally{await writeFile('verification/browser-results.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));await browser.close();}
