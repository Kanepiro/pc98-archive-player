import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-webgpu']});
try{
 const page=await browser.newPage();
 await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39085/');
 const report=await page.evaluate(async()=>{
  const {NativeModeConverter}=await import('/tsl-native-modes.js');
  const {QualityConverter,makeGlyphAtlas,qualityColumns}=await import('/tsl-quality.js');
  const {rgbaToASCII,CANDIDATE_RAMP}=await import('/tsl-converter-core.js');
  const {rgbaToHalftone,HALFTONE_TONES}=await import('/tsl-halftone.js');
  const results=[],S=6,W=31,H=16,w=W*S,h=H*S;
  function input(kind,shift=0){
   const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   ctx.fillStyle=kind==='black'?'black':kind==='white'?'white':kind==='pink'?'#ee33cc':'#18232a';ctx.fillRect(0,0,w,h);
   if(kind==='ramp'){
    const d=ctx.getImageData(0,0,w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;d.data[i]=x*255/(w-1);d.data[i+1]=y*255/(h-1);d.data[i+2]=(x+y)%256;d.data[i+3]=x%9===0?80:255;}return d.data;
   }
   if(kind==='person'){
    ctx.strokeStyle='#f1e1a3';ctx.fillStyle='#f1e1a3';ctx.lineWidth=4;
    ctx.beginPath();ctx.arc(65+shift,22,10,0,Math.PI*2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(65+shift,32);ctx.lineTo(65+shift,62);ctx.moveTo(40+shift,49);ctx.lineTo(65+shift,36);ctx.lineTo(90+shift,48);ctx.moveTo(65+shift,62);ctx.lineTo(47+shift,88);ctx.moveTo(65+shift,62);ctx.lineTo(86+shift,88);ctx.stroke();
    ctx.fillStyle='#4455f0';ctx.fillRect(130,15,28,65);
   }
   return ctx.getImageData(0,0,w,h).data;
  }
  const cases=['black','white','pink','ramp','person'];
  for(const mode of [1,2]){
   const engine=await NativeModeConverter.create(mode,S,W,H);
   if(engine.acceleration!=='WARP Test Modes')throw Error('Expected explicitly selected WARP test adapter');
   for(const kind of cases)for(const tune of [{},{brightness:15,contrast:1.3,gamma:.8,edge:.7}]){
    const options={sample:S,ramp:CANDIDATE_RAMP,...tune},pixels=input(kind);
    const actual=await engine.convert(pixels,options),reference=mode===1?rgbaToASCII(pixels,W,H,options):rgbaToHalftone(pixels,W,H,options);
    const palette=mode===1?Array.from(CANDIDATE_RAMP):HALFTONE_TONES;
    const a=Array.from(actual.replace(/[\r\n]/g,'')),b=Array.from(reference.replace(/[\r\n]/g,''));
    if(a.length!==b.length)throw Error('Tone layout length');
    let differences=0,maxToneDifference=0;
    for(let i=0;i<a.length;i++)if(a[i]!==b[i]){differences++;maxToneDifference=Math.max(maxToneDifference,Math.abs(palette.indexOf(a[i])-palette.indexOf(b[i])));}
    if(maxToneDifference>1||differences/a.length>.03)throw Error('Tone/polarity regression '+JSON.stringify({mode,kind,differences,maxToneDifference}));
    if(kind==='black'&&!tune.brightness&&mode===2&&!/^([　 ]*\r\n)+$/.test(actual))throw Error('Black must remain blank');
    results.push({mode,kind,settings:tune,differences,maxToneDifference,perf:engine.lastPerf});
   }
  }
  const atlas=makeGlyphAtlas(S),cpu=new QualityConverter(atlas,S),gpu=new QualityConverter(atlas,S);
  await gpu.enableNativeGPU(W,H);if(!gpu.nativeMode)throw Error(gpu.gpuError);
  function loss(frame,target){
   let total=0,energy=0,y=0;
   for(const row of frame.split('\r\n').slice(0,-1)){let x=0;for(const char of row){
    const glyph=atlas.find(a=>a.char===char);if(!glyph)throw Error('Unknown glyph');
    for(let py=0;py<S;py++)for(let px=0;px<glyph.columns*S;px++){
     const v=target[(y*S+py)*w+x*S+px],d=v-glyph.mask[py*glyph.columns*S+px];total+=d*d;energy+=v*v;
    }x+=glyph.columns;
   }y++;}
   return total/(W*H*S*S);
  }
  for(const [kind,shift] of [['black',0],['white',0],['pink',0],['ramp',0],['person',0],['person',8],['person',8],['black',0]]){
   const pixels=input(kind,shift),reference=cpu.convert(pixels,W,H),actual=await gpu.convertAccelerated(pixels,W,H);
   if(gpu.acceleration!=='WARP Test Modes')throw Error('GPU path fell back: '+gpu.gpuError);
   const rows=actual.split('\r\n');if(rows.pop()!==''||rows.length!==H||rows.some(row=>qualityColumns(row)!==W))throw Error('Quality frame layout');
   let mae=0,union=0,intersection=0,grayError=0;
   for(let i=0;i<w*h;i++){
    const a=gpu.previous.target[i],b=cpu.previous.target[i];mae+=Math.abs(a-b);
    if(a>.22||b>.22)union++;if(a>.22&&b>.22)intersection++;
    grayError=Math.max(grayError,Math.abs(gpu.previous.gray[i]-cpu.previous.gray[i]));
   }
   mae/=w*h;const iou=union?intersection/union:1;
   const referenceLoss=loss(reference,cpu.previous.target),gpuLoss=loss(actual,cpu.previous.target);
   if(mae>.035||iou<.82||grayError>.0001||gpuLoss>referenceLoss*1.2+.003)throw Error('Contour/template quality regression '+JSON.stringify({kind,shift,mae,iou,grayError,referenceLoss,gpuLoss}));
   if(['black','white','pink'].includes(kind)&&actual.trim()!=='')throw Error('Flat color filled with glyphs');
   results.push({mode:3,kind,shift,mae,iou,grayError,referenceLoss,gpuLoss,perf:gpu.lastPerf});
  }
  // Restore a moving contour checkpoint and continue on the native path.
  const before=input('person',8);await gpu.convertAccelerated(before,W,H);
  const restored=new QualityConverter(atlas,S);restored.restore(gpu.snapshot());await restored.enableNativeGPU(W,H);
  const next=input('person',14),a=await gpu.convertAccelerated(next,W,H),b=await restored.convertAccelerated(next,W,H);
  if(a!==b)throw Error('Native checkpoint restore changed identical native state');
  // A real request error must retain the original CPU converter, not stop the job.
  const fetchOriginal=globalThis.fetch;
  globalThis.fetch=async(url,options)=>String(url).includes('/api/modes/convert')?new Response(JSON.stringify({error:'forced GPU failure'}),{status:503,headers:{'Content-Type':'application/json'}}):fetchOriginal(url,options);
  const fallback=await gpu.convertAccelerated(input('black'),W,H);
  globalThis.fetch=fetchOriginal;
  if(gpu.acceleration!=='CPU'||fallback.trim()!==''||!gpu.gpuError.includes('forced GPU failure'))throw Error('Mode3 CPU fallback');
  return {environment:'Windows CI; DirectCompute shaders on explicit WARP software adapter; browser WebGPU disabled',results,checkpoint:'PASS',mode3Fallback:'PASS'};
 });
 // Workers must also fall back for modes 1 and 2 after a service failure.
 await page.route('**/api/modes/convert',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"forced GPU failure"}'}));
 report.workerFallback=await page.evaluate(async()=>{
  const results=[];
  for(const mode of ['legacy','halftone']){
   const worker=new Worker('/tsl-converter-worker.js',{type:'module'});
   const ask=d=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('worker timeout')),120000);worker.onmessage=e=>{clearTimeout(t);e.data.error?reject(Error(e.data.error)):resolve(e.data);};worker.postMessage(d);});
   try{
    await ask({type:'init',mode,width:12,height:8,sample:6});
    const out=await ask({width:12,height:8,pixels:new Uint8ClampedArray(12*8*36*4).buffer,options:{sample:6,conversionMode:mode}});
    if(out.acceleration!=='CPU'||!out.gpuReason.includes('forced GPU failure')||out.frame.trim()!=='')throw Error('Worker fallback '+mode);
    results.push({mode,backend:out.acceleration,reason:out.gpuReason});
   }finally{worker.terminate();}
  }
  return results;
 });
 await mkdir('gpu-validation',{recursive:true});
 await writeFile('gpu-validation/native-modes.json',JSON.stringify(report,null,2));
 console.log('PASS native modes 1–3: tone polarity, contour/template quality, motion, blank clearing, checkpoint, CPU fallbacks',JSON.stringify(report));
 assert.equal(report.results.length,28);
}finally{await browser.close();}
