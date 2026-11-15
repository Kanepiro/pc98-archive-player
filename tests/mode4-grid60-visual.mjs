import {chromium} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
await mkdir('validation/sweep',{recursive:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4198/');
 for(const time of [1,3,5,8]){
  const results=await page.evaluate(async time=>{
   const m=await import('/tsl-mode4-grid60.js'),atlas=await m.makeMode4Atlas();
   const im=await createImageBitmap(await(await fetch('/__inmu-'+time+'.png')).blob());
   const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d');
   ctx.drawImage(im,0,0);const pixels=ctx.getImageData(0,0,1920,1080).data,results=[];
   for(const sigma of [4,8,12]){
    const targets=m.prepareMode4Targets(pixels,64,18,{mode4BlurSigma:sigma,mode4DebugImage:true}),scores=m.selectMode4Glyphs(targets,atlas);
    for(const limit of [.14,.22,.30]){
     const decisions=m.judgeMode4(targets,scores,atlas,{mode4ScoreLimit:limit}),rows=[];
     for(let y=0;y<18;y++)rows.push(decisions.slice(y*32,y*32+32).map(d=>d.output).join(''));
     const out=document.createElement('canvas');m.drawMode4Grid(out,{width:64,height:18,frames:[rows.join('\n')]},0,{foreground:'#111',background:'#fff'});
     results.push({time,sigma,limit,accepted:decisions.filter(d=>d.accepted).length,png:out.toDataURL(),decisions});
    }
    const contour=document.createElement('canvas');contour.width=960;contour.height=540;const c=contour.getContext('2d'),d=c.createImageData(960,540);
    targets.contours.pixels.forEach((v,i)=>{d.data[i*4]=d.data[i*4+1]=d.data[i*4+2]=v?0:255;d.data[i*4+3]=255;});c.putImageData(d,0,0);
    results.push({time,sigma,png:contour.toDataURL(),edge:true});
   }return results;
  },time);
  for(const r of results){const stem='validation/sweep/t'+time+'-s'+r.sigma+(r.edge?'-edge':'-l'+r.limit);await writeFile(stem+'.png',Buffer.from(r.png.split(',')[1],'base64'));delete r.png;await writeFile(stem+'.json',JSON.stringify(r));if(!r.edge)console.log(JSON.stringify({time,sigma:r.sigma,limit:r.limit,accepted:r.accepted}));}
 }
}finally{await browser.close();}
