import {chromium} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
await mkdir('validation',{recursive:true});
try{
 const page=await browser.newPage();await page.goto(process.env.PLAYER_URL||'http://127.0.0.1:4197/');
 for(const name of ['face','dog','review-18','review-64']){
  const results=await page.evaluate(async name=>{
   const {makeMode4Atlas,Grid120Converter,drawMode4Grid}=await import('/tsl-mode4-grid.js');
   const atlas=await makeMode4Atlas(),converter=new Grid120Converter(atlas);
   const im=await createImageBitmap(await(await fetch('/__'+name+(name.startsWith('review-')?'.png':'.jpg'))).blob());
   const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
   const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,1920,1080);
   const scale=Math.min(1920/im.width,1080/im.height),w=im.width*scale,h=im.height*scale;
   c.drawImage(im,(1920-w)/2,(1080-h)/2,w,h);
   const source=canvas.toDataURL(),pixels=c.getImageData(0,0,1920,1080).data,results=[];
   for(const sigma of [4,8,12,16]){
    const frame=await converter.convertAccelerated(pixels,32,9,{mode4BlurSigma:sigma});
    const out=document.createElement('canvas');
    drawMode4Grid(out,{width:32,height:9,frames:[frame.replaceAll('\r','').trimEnd()]},0,{foreground:'#111111',background:'#ffffff'});
    results.push({sigma,png:out.toDataURL(),frame,perf:converter.lastPerf});
   }
   return {source,results};
  },name);
  await writeFile('validation/'+name+'-source.png',Buffer.from(results.source.split(',')[1],'base64'));
  for(const r of results.results){
   await writeFile('validation/'+name+'-'+r.sigma+'.png',Buffer.from(r.png.split(',')[1],'base64'));
   delete r.png;console.log(name,JSON.stringify(r));
  }
 }
}finally{await browser.close();}
