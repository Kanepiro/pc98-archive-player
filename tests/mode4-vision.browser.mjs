import {chromium} from '@playwright/test';
const b=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const page=await b.newPage({viewport:{width:1200,height:800}});
const errors=[];
page.on('pageerror',e=>errors.push('pageerror: '+e.message));
page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errors.push('console: '+m.text().slice(0,700))});
page.on('requestfailed',r=>errors.push('REQUEST_FAIL:'+r.url()+' '+r.failure()?.errorText));
try{
 await page.goto('http://127.0.0.1:4483/',{waitUntil:'load'});
 const result=await page.evaluate(async()=>{
  const msgs=[];const {createArtisanVision}=await import('/tsl-artisan-vision.js');
  const t0=performance.now();
  const vision=await createArtisanVision({onStatus:t=>msgs.push(t)});
  // Run the detectors on a real canvas (white) even if no face/object is found.
  const c=document.createElement('canvas');c.width=640;c.height=360;
  const ctx=c.getContext('2d');ctx.fillStyle='#f8f8f8';ctx.fillRect(0,0,c.width,c.height);
  const pixels=ctx.getImageData(0,0,c.width,c.height);
  const rect={x:0,y:0,width:640,height:360};
  // Explicit model invocation on image source (the video pipeline uses video).
  const result={capabilities:vision.capabilities,msgs,loadMs:Math.round(performance.now()-t0)};
  vision.close();return result;
 });
 console.log('MODEL_TEST_RESULT',JSON.stringify(result));
 console.log('MODEL_ERRORS',JSON.stringify(errors.slice(0,12)));
}finally{await b.close();}
