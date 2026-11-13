// Mode 3: contextual, temporally stable glyph matching.
import {Mode3GpuMatcher} from './tsl-webgpu.js';
// XDoG (extended difference of Gaussians) + Canny/Edge-Drawing-style
// connected edge tracing + actual renderer glyph-mask matching.
// Full-width CP932 glyphs occupy 2 columns; half-width ASCII occupies 1.
// Mode 1 is implemented in tsl-converter-core.js and is not touched.
const FULL={
 '│':[0x84,0xa0],'─':[0x84,0x9f],'┃':[0x84,0xab],'━':[0x84,0xaa],
 '／':[0x81,0x5e],'＼':[0x81,0x5f],
 '┌':[0x84,0xa1],'┐':[0x84,0xa2],'└':[0x84,0xa4],'┘':[0x84,0xa3],
 '┼':[0x84,0xa9],'（':[0x81,0x69],'）':[0x81,0x6a],
 '〈':[0x81,0x71],'〉':[0x81,0x72],'・':[0x81,0x45],
 '。':[0x81,0x42],
 // Exclude large circle, square and diamond glyphs from new Mode 3 frames.
 '＋':[0x81,0x7b],'×':[0x81,0x7e],'｜':[0x81,0x62],'―':[0x81,0x5c]
};
export const QUALITY_ASCII = " .,:;'-_+=*/\\|()<>oO0@#%$YV8D";
export const QUALITY_GLYPHS=Object.freeze({
 ...Object.fromEntries([...QUALITY_ASCII].map(c=>[c,[c.charCodeAt(0)]])),
 ...FULL
});
export const QUALITY_CHARS=Object.freeze(Object.keys(QUALITY_GLYPHS));
const cw=c=>QUALITY_GLYPHS[c]?.length;
const clamp=(v,l=0,h=1)=>Math.min(h,Math.max(l,v));
export function qualityColumns(line){
 let n=0;
 for(const c of line){const w=cw(c);if(!w)throw Error('モード3で利用できない文字: '+c);n+=w;}
 return n;
}
export function encodeQualityFrame(lines){
 const size=lines.reduce((n,x)=>n+qualityColumns(x)+2,0)+3,arr=new Uint8Array(size);
 let p=0;
 for(const line of lines){
  for(const c of line)for(const b of QUALITY_GLYPHS[c])arr[p++]=b;
  arr[p++]=13;arr[p++]=10;
 }
 arr[p++]=12;arr[p++]=13;arr[p++]=10;
 if(p!==size)throw Error('Shift-JISのサイズが一致しません');
 return arr;
}
// Calibrate from the exact font/metrics used by drawTSL in tsl.js.
// Returned arrays are serializable/transferable to the converter worker.
export function makeGlyphAtlas(sample=6){
 if(!Number.isInteger(sample)||sample<4||sample>10)throw Error('標本数が不正です');
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
 const small=document.createElement('canvas'),mini=small.getContext('2d',{willReadFrequently:true});
 const items=[];
 for(const char of QUALITY_CHARS){
  const columns=cw(char);
  canvas.width=12*columns;canvas.height=24;
  ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#fff';ctx.font='20px monospace';ctx.textBaseline='top';
  if(char!==' ')ctx.fillText(char,0,0,12*columns);
  small.width=sample*columns;small.height=sample;
  mini.fillStyle='#000';mini.fillRect(0,0,small.width,small.height);
  mini.imageSmoothingEnabled=true;mini.imageSmoothingQuality='high';
  mini.drawImage(canvas,0,0,small.width,small.height);
  const data=mini.getImageData(0,0,small.width,small.height).data;
  const mask=new Float32Array(columns*sample*sample);
  for(let i=0;i<mask.length;i++)mask[i]=data[i*4]/255;
  items.push({char,columns,mask});
 }
 return items;
}
function gaussian(src,w,h,sigma){
 const radius=Math.max(1,Math.ceil(2.4*sigma)),kern=new Float32Array(radius*2+1);
 let sum=0;
 for(let k=-radius;k<=radius;k++){const v=Math.exp(-k*k/(2*sigma*sigma));kern[k+radius]=v;sum+=v;}
 for(let k=0;k<kern.length;k++)kern[k]/=sum;
 const tmp=new Float32Array(src.length),dst=new Float32Array(src.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let acc=0;for(let k=-radius;k<=radius;k++)acc+=src[y*w+Math.min(w-1,Math.max(0,x+k))]*kern[k+radius];
  tmp[y*w+x]=acc;
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let acc=0;for(let k=-radius;k<=radius;k++)acc+=tmp[Math.min(h-1,Math.max(0,y+k))*w+x]*kern[k+radius];
  dst[y*w+x]=acc;
 }
 return dst;
}
// Connected hysteresis makes a coherent edge chain rather than a scatter of points.
// Anchors are gradient maxima, and weak pixels must connect to strong anchors.
function traceEdges(gray,red,green,blue,w,h){
 const a=gaussian(gray,w,h,.75),r=gaussian(red,w,h,.75),
       g=gaussian(green,w,h,.75),b=gaussian(blue,w,h,.75);
 const channels=[a,r,g,b];
 const magnitude=new Float32Array(w*h),direction=new Uint8Array(w*h),
       isPeak=new Uint8Array(w*h),visited=new Uint8Array(w*h);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x;
  let best=0,dx=0,dy=0;
  for(const channel of channels){
   const xx=channel[i+1]-channel[i-1];
   const yy=channel[i+w]-channel[i-w];
   const v=xx*xx+yy*yy;
   if(v>best){best=v;dx=xx;dy=yy;}
  }
  magnitude[i]=Math.sqrt(best);
  const angle=Math.atan2(dy,dx);
  const deg=((angle*180/Math.PI)%180+180)%180;
  direction[i]=deg<22.5||deg>=157.5?0:deg<67.5?1:deg<112.5?2:3;
 }
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x,m=magnitude[i];if(m<.10)continue;
  const offsets=[1,w+1,w,w-1],d=offsets[direction[i]];
  if(m>=magnitude[i-d]&&m>=magnitude[i+d])isPeak[i]=1;
 }
 const connected=new Uint8Array(w*h),stack=[];
 // Edge Drawing-style seed and trace: start at strong anchors, link nearby
 // weak anchors in the 8-neighborhood, discard small noisy components.
 for(let i=0;i<isPeak.length;i++){
  if(!isPeak[i]||visited[i]||magnitude[i]<.24)continue;
  stack.length=0;const component=[i];stack.push(i);visited[i]=1;
  while(stack.length){
   const t=stack.pop(),y=Math.floor(t/w),x=t-y*w;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    if(dx===0&&dy===0)continue;
    const nx=x+dx,ny=y+dy;if(nx<=0||nx>=w-1||ny<=0||ny>=h-1)continue;
    const q=ny*w+nx;
    if(!visited[q]&&isPeak[q]&&magnitude[q]>=.085){
     visited[q]=1;stack.push(q);component.push(q);
    }
   }
  }
  if(component.length>=3)for(const k of component)connected[k]=1;
 }
 // Join single-pixel gaps between line endpoints without growing flat regions.
 for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
  const i=y*w+x;
  if(connected[i]||magnitude[i]<.06)continue;
  if((connected[i-1]&&connected[i+1])||(connected[i-w]&&connected[i+w])||
     (connected[i-w-1]&&connected[i+w+1])||(connected[i-w+1]&&connected[i+w-1]))
    connected[i]=1;
 }
 return connected;
}
function targetImage(pixels,width,height,sample,brightness,contrast,gamma,previous){
 const w=width*sample,h=height*sample,n=w*h;
 const red=new Float32Array(n),green=new Float32Array(n),blue=new Float32Array(n),gray=new Float32Array(n);
 for(let i=0;i<n;i++){
  const p=i*4,v=[pixels[p],pixels[p+1],pixels[p+2]];
  for(let c=0;c<3;c++)v[c]=clamp((v[c]/255-.5)*contrast+.5+brightness/100)**gamma;
  red[i]=v[0];green[i]=v[1];blue[i]=v[2];
  gray[i]=.2126*v[0]+.7152*v[1]+.0722*v[2];
 }
 const prev=previous;
 const prevGray=prev?.gray;
 let sceneChange=0;
 if(prevGray?.length===n){
  for(let i=0;i<n;i+=Math.max(1,Math.floor(n/2000)))sceneChange+=Math.abs(gray[i]-prevGray[i]);
  sceneChange/=Math.ceil(n/Math.max(1,Math.floor(n/2000)));
 }
 const cut=sceneChange>.18;
 const blurA=gaussian(gray,w,h,.8),blurB=gaussian(gray,w,h,1.85);
 const connected=traceEdges(gray,red,green,blue,w,h);
 const target=new Float32Array(n);
 for(let i=0;i<n;i++){
  // Contour-only target: no global brightness/colour fill. Even a solid
  // saturated pink/yellow image MUST produce an entirely blank frame.
  const xdog=clamp((Math.abs(blurA[i]-blurB[i])-.014)*7);
  const outline=Math.max(connected[i]?0.98:0,xdog*0.95);
  // Only ink from the CURRENT frame: old pixels never trail moving objects.
  target[i]=outline<.17?0:outline;
 }
 return {target,gray,cut};
}
// CPU correlation is used only for the one-time automatic GPU speed and
// output-accuracy comparison; normal CPU rendering keeps its original path.
export function qualityCpuDots(target,width,height,S,atlas){
 const out=new Float64Array(width*height*atlas.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const a=x*S,b=y*S*width*S;
  for(let j=0;j<atlas.length;j++){
   const glyph=atlas[j],cols=glyph.columns;if(x+cols>width)continue;
   let dot=0;
   for(let py=0;py<S;py++){
    const start=b+py*width*S+a,mi=py*S*cols;
    for(let px=0;px<S*cols;px++)dot+=target[start+px]*glyph.mask[mi+px];
   }
   out[(y*width+x)*atlas.length+j]=dot;
  }
 }
 return out;
}
export class QualityConverter{
 constructor(atlas,sample=6,{artisan=false}={}){
  if(!Array.isArray(atlas)||!atlas.length)throw Error('文字マスクがありません');
  this.sample=sample;this.atlas=atlas.map(a=>({
   ...a,mask:Float32Array.from(a.mask),
   squares:Float32Array.from(a.mask).reduce((s,v)=>s+v*v,0)
  }));
  const available=new Set(this.atlas.map(a=>a.char));
  if(!available.has(' ')||!available.has('／')||(!artisan&&!available.has('#')))throw Error('文字マスクが不足しています');
  this.previous=null;this.prevGlyphs=null;
  this.gpuMatcher=null;this.gpuBenchmarked=false;this.acceleration='CPU';
 }
 snapshot(){
  if(!this.previous)return null;
  return {
   sample:this.sample,
   target:this.previous.target,gray:this.previous.gray,
   prevGlyphs:this.prevGlyphs
  };
 }
 restore(state){
  if(!state)return;
  if(state.sample!==this.sample||!(state.target instanceof Float32Array)||
     !(state.gray instanceof Float32Array)||state.target.length!==state.gray.length||
     !Array.isArray(state.prevGlyphs))
   throw Error('途中保存の文字状態が不正です');
  this.previous={target:state.target,gray:state.gray,cut:false};
  this.prevGlyphs=state.prevGlyphs;
 }
 async enableWebGPU(width,height){
  try{
   this.gpuMatcher=await Mode3GpuMatcher.create(this.atlas,this.sample,width,height);
   if(this.gpuMatcher){
    // Shader warmup verifies the GPU path before numerical output comparison.
    await this.gpuMatcher.compute(new Float32Array(width*height*this.sample*this.sample));
   }
  }catch(e){
   this.gpuError=String(e);
   this.gpuMatcher?.dispose();this.gpuMatcher=null;this.acceleration='CPU';
  }
 }
 async convertAccelerated(pixels,width,height,options={}){
  if(!this.gpuMatcher)return this.convert(pixels,width,height,options);
  const {brightness=0,contrast=1,gamma=1}=options,S=this.sample;
  if(pixels.length!==width*height*S*S*4)throw Error('画素数が一致しません');
  const state=targetImage(pixels,width,height,S,brightness,contrast,gamma,this.previous);
  let dots=null;
  try{
   const gpuDots=await this.gpuMatcher.compute(state.target);
   if(!this.gpuBenchmarked){
    this.gpuBenchmarked=true;
    const cpuDots=qualityCpuDots(state.target,width,height,S,this.atlas);
    let maxError=0;
    for(let k=0;k<gpuDots.length;k+=37){
     const diff=Math.abs(gpuDots[k]-cpuDots[k]);
     if(!Number.isFinite(diff)){maxError=Infinity;break;}
     maxError=Math.max(maxError,diff);
    }
    // GPU is explicitly requested wherever available. Preserve numerical
    // parity with CPU rather than reject a correct GPU for being slower.
    if(maxError<.001){
     this.acceleration='WebGPU';dots=gpuDots;
    }else{
     this.acceleration='CPU';dots=cpuDots;
     this.gpuMatcher.dispose();this.gpuMatcher=null;
    }
   }else dots=gpuDots;
  }catch{
   this.gpuMatcher?.dispose();this.gpuMatcher=null;this.acceleration='CPU';
  }
  return this._render(state,width,height,dots);
 }
 convert(pixels,width,height,{brightness=0,contrast=1,gamma=1}={}){
  const S=this.sample;
  if(pixels.length!==width*height*S*S*4)throw Error('画像の標本数が不正です');
  const state=targetImage(pixels,width,height,S,brightness,contrast,gamma,this.previous);
  return this._render(state,width,height,null);
 }
 _render(state,width,height,precomputedDots=null){
  const S=this.sample;
  const {target,cut}=state,w=width*S,rows=[],prev=this.previous?.target;
  const newGlyphs=new Array(width*height).fill(null);
  const atlas=this.atlas;
  for(let y=0;y<height;y++){
   const dp=new Float32Array(width+1);dp.fill(Infinity);dp[0]=0;
   const back=new Array(width+1);
   // These values depend on the source frame only, not on which glyph we try.
   // Calculate them once per cell instead of repeating them for every candidate.
   const cellSquared=new Float32Array(width),cellChange=new Float32Array(width);
   const edgeCurrent=new Uint16Array(width),edgePrevious=new Uint16Array(width),edgeShared=new Uint16Array(width);
   for(let x=0;x<width;x++){
    for(let py=0;py<S;py++){
     const start=(y*S+py)*w+x*S;
     for(let px=0;px<S;px++){
      const idx=start+px,v=target[idx];
      cellSquared[x]+=v*v;
      if(prev&&!cut){
       const old=prev[idx],a=v>.22,b=old>.22;
       cellChange[x]+=Math.abs(v-old);
       if(a)edgeCurrent[x]++;
       if(b)edgePrevious[x]++;
       if(a&&b)edgeShared[x]++;
      }
     }
    }
    cellChange[x]/=S*S;
   }
   for(let x=0;x<width;x++){
    if(!Number.isFinite(dp[x]))continue;
    const a=x*S,b=y*S*w;
    for(let j=0;j<atlas.length;j++){
     const glyph=atlas[j],cols=glyph.columns;if(x+cols>width)continue;
     const mask=glyph.mask,total=cols*S*S;
     // Exact squared-template loss, using ||image-glyph||² =
     // ||image||² + ||glyph||² - 2*dot(image,glyph).
     let dot=precomputedDots?precomputedDots[(y*width+x)*atlas.length+j]:0;
     if(!precomputedDots)for(let py=0;py<S;py++){
      const start=b+py*w+a,mi=py*S*cols;
      for(let px=0;px<S*cols;px++)dot+=target[start+px]*mask[mi+px];
     }
     const patchSquared=cellSquared[x]+(cols===2?cellSquared[x+1]:0);
     let loss=Math.max(0,(patchSquared+glyph.squares-2*dot)/total);
     if(glyph.char!==' ')loss+=.006;
     // When no edge energy exists, clear the cell regardless of its old
     // character. This prevents sparse punctuation from sticking to a blank.
     const empty=cellSquared[x]/(S*S)<.014 &&
      (cols===1||cellSquared[x+1]/(S*S)<.014);
     if(empty&&glyph.char!==' ')continue;
     const old=this.prevGlyphs?.[y*width+x],same=old===glyph.char;
     if(!empty&&prev&&!cut&&old&&!same){
      // Reuse an old glyph only if the current edge remains at the same
      // pixels. Moving outlines do not drag previous glyphs behind them.
      const cur=edgeCurrent[x]+(cols===2?edgeCurrent[x+1]:0);
      const prior=edgePrevious[x]+(cols===2?edgePrevious[x+1]:0);
      const both=edgeShared[x]+(cols===2?edgeShared[x+1]:0);
      const overlap=both/Math.max(1,cur+prior-both);
      const change=(cellChange[x]+(cols===2?cellChange[x+1]:0))/cols;
      if(overlap>.72&&change<.1)
       loss+=.055*clamp((overlap-.72)/.28)*clamp((.1-change)/.1);
     }
     const score=dp[x]+loss*cols;
     if(score<dp[x+cols]){dp[x+cols]=score;back[x+cols]={start:x,j};}
    }
   }
   if(!back[width])throw Error('モード3の文字配置に失敗しました');
   let x=width;
   const glyphs=[];
   while(x>0){
    const step=back[x],glyph=atlas[step.j];glyphs.push(glyph.char);
    newGlyphs[y*width+step.start]=glyph.char;
    for(let col=step.start+1;col<x;col++)newGlyphs[y*width+col]='\0';
    x=step.start;
   }
   rows.push(glyphs.reverse().join(''));
  }
  this.prevGlyphs=newGlyphs;
  this.previous=state;
  return rows.join('\r\n')+'\r\n';
 }
}
