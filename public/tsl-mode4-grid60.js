import {MODE4_CHARS,MODE4_BYTES,MODE4_MASK_SHA256} from './mode4-palette60.js';
// Symmetric chamfer error: glyph-only strokes cost 65%, missed target strokes 35%.
// Features: 576 normalized ink weights followed by 576 truncated distance values.
export function shapeDescriptor(mask){
 const n=24,weights=Float32Array.from(mask,v=>v>=.18?v:0),distance=new Float32Array(576).fill(100);
 let sum=0;for(let i=0;i<576;i++){sum+=weights[i];if(weights[i])distance[i]=0;}
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*n+x;let v=distance[i];
  if(x)v=Math.min(v,distance[i-1]+1);if(y)v=Math.min(v,distance[i-n]+1);
  if(x&&y)v=Math.min(v,distance[i-n-1]+Math.SQRT2);if(x<n-1&&y)v=Math.min(v,distance[i-n+1]+Math.SQRT2);distance[i]=v;
 }
 for(let y=n-1;y>=0;y--)for(let x=n-1;x>=0;x--){const i=y*n+x;let v=distance[i];
  if(x<n-1)v=Math.min(v,distance[i+1]+1);if(y<n-1)v=Math.min(v,distance[i+n]+1);
  if(x<n-1&&y<n-1)v=Math.min(v,distance[i+n+1]+Math.SQRT2);if(x&&y<n-1)v=Math.min(v,distance[i+n-1]+Math.SQRT2);distance[i]=v;
 }
 const out=new Float32Array(1152);
 for(let i=0;i<576;i++){out[i]=sum?weights[i]/sum:0;out[576+i]=Math.min(1,Math.max(0,distance[i]-.5)/6);}
 return out;
}
export function glyphScore(t,g){let loss=0;for(let i=0;i<576;i++)loss+=.65*g[i]*t[i+576]+.35*t[i]*g[i+576];return loss;}
export const MODE4_CELL=60,MODE4_SAMPLE=24,MODE4_ENGINE=6001,MODE4_BLUR_SIGMA=8;
export const MODE4_LIMIT=0.22,MODE4_EDGE_HIGH=0.025,MODE4_EDGE_LOW=0.0125,MODE4_MIN_EDGE=8;
export const MODE4_SPACE='　';
const chars=[...MODE4_CHARS],ids=new Map(chars.map((c,i)=>[c,i]));
const state=globalThis[Symbol.for('tasl.mode4.grid60.v1')]??={promise:null,masks:null,tints:new Map()};
export function mode4Grid(w,h){
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>3840*2160)throw Error('モード4の動画サイズが不正です');
 const columns=Math.ceil(w/60),height=Math.ceil(h/60);
 return {width:columns*2,height,columns,mode4Cell60:true,native16:false,
  sourceWidth:w,sourceHeight:h,pixelWidth:columns*60,pixelHeight:height*60};
}
export function validateGridFrame(lines,width,height){
 if(width%2||lines.length!==height||lines.some(row=>[...row].length!==width/2||[...row].some(c=>c!==MODE4_SPACE&&!ids.has(c))))
  throw Error('モード4は各60pxセルに指定文字1文字または空白を配置します');
}
export function encodeGridFrame(lines){
 const bytes=[];
 for(const row of lines){for(const c of row){if(c===MODE4_SPACE){bytes.push(0x81,0x40);continue;}
 const i=ids.get(c);if(i===undefined)throw Error('指定外の文字です');bytes.push(...MODE4_BYTES[i]);}bytes.push(13,10);}
 bytes.push(12,13,10);return Uint8Array.from(bytes);
}
export function ensureMode4Atlas(){
 if(state.promise)return state.promise;
 state.promise=(async()=>{
  const r=await fetch(new URL('./mode4-atlas60.bin',import.meta.url));if(!r.ok)throw Error('60px字形を読み込めません');
  const bytes=new Uint8Array(await r.arrayBuffer());
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(bytes.length!==170*3600||hash!==MODE4_MASK_SHA256)throw Error('60px字形が一致しません');
  state.masks=bytes;return bytes;
 })();return state.promise;
}
function canvasOf(w,h){const c=typeof document==='undefined'?new OffscreenCanvas(w,h):document.createElement('canvas');c.width=w;c.height=h;return c;}
function tintedAtlas(color){
 if(!state.masks)throw Error('60px字形読み込み未完了');
 if(state.tints.has(color))return state.tints.get(color);
 const canvas=canvasOf(600,1020),c=canvas.getContext('2d'),im=c.createImageData(600,1020);
 for(let g=0;g<170;g++)for(let y=0;y<60;y++)for(let x=0;x<60;x++){
  const i=(((g/10|0)*60+y)*600+g%10*60+x)*4;im.data[i]=im.data[i+1]=im.data[i+2]=255;im.data[i+3]=state.masks[g*3600+y*60+x];
 }
 c.putImageData(im,0,0);c.globalCompositeOperation='source-in';c.fillStyle=color;c.fillRect(0,0,600,1020);
 if(state.tints.size>=4)state.tints.delete(state.tints.keys().next().value);state.tints.set(color,canvas);return canvas;
}
export function drawMode4Grid(canvas,data,index,{foreground='#e3f4e8',background='#080d12'}={}){
 const lines=data.frames[index].split('\n');validateGridFrame(lines,data.width,data.height);
 const w=data.width*30,h=data.height*60;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 const c=canvas.getContext('2d');c.fillStyle=background;c.fillRect(0,0,w,h);const atlas=tintedAtlas(foreground);c.imageSmoothingEnabled=false;
 for(let y=0;y<lines.length;y++)for(let x=0,row=[...lines[y]];x<row.length;x++){
  const g=ids.get(row[x]);if(g===undefined)continue;c.drawImage(atlas,g%10*60,(g/10|0)*60,60,60,x*60,y*60,60,60);
 }
}
const kernels=new Map();
export function gaussianFrame(src,w,h,sigma=8){
 if(!Number.isFinite(sigma)||sigma<0||sigma>24)throw Error('Gaussian sigma invalid');
 if(sigma===0)return Float32Array.from(src);
 let k=kernels.get(sigma);
 if(!k){const r=Math.ceil(sigma*3);k=Float32Array.from({length:r*2+1},(_,i)=>Math.exp(-.5*((i-r)/sigma)**2));const sum=k.reduce((a,b)=>a+b);for(let i=0;i<k.length;i++)k[i]/=sum;kernels.set(sigma,k);}
 const r=(k.length-1)/2,tmp=new Float32Array(src.length),out=new Float32Array(src.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let d=-r;d<=r;d++)s+=src[y*w+Math.max(0,Math.min(w-1,x+d))]*k[d+r];tmp[y*w+x]=s;}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let d=-r;d<=r;d++)s+=tmp[Math.max(0,Math.min(h-1,y+d))*w+x]*k[d+r];out[y*w+x]=s;}
 return out;
}
// Exact area resampling, including fractional 60/24 boundaries.
export function areaSample(src,w,h,n){
 const out=new Float32Array(n*n),sx=w/n,sy=h/n;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const x0=x*sx,x1=(x+1)*sx,y0=y*sy,y1=(y+1)*sy;let s=0;
  for(let yy=Math.floor(y0);yy<Math.ceil(y1);yy++)for(let xx=Math.floor(x0);xx<Math.ceil(x1);xx++)
   s+=src[yy*w+xx]*(Math.min(x1,xx+1)-Math.max(x0,xx))*(Math.min(y1,yy+1)-Math.max(y0,yy));
  out[y*n+x]=s/(sx*sy);
 }return out;
}
export async function makeMode4Atlas(){
 const bytes=await ensureMode4Atlas();return chars.map((char,i)=>{
  const mask=areaSample(Float32Array.from(bytes.subarray(i*3600,(i+1)*3600),v=>v/255),60,60,24);
  if(!mask.some(v=>v>0))throw Error('指定文字の字形が空です');return {char,columns:2,mask,features:shapeDescriptor(mask)};
 });
}
export function prepareMode4Targets(pixels,width,height,options={}){
 const W=width/2*60,H=height*60;
 if(width%2||pixels.length!==W*H*4)throw Error('60px画素数が一致しません');
 const gray=new Float32Array(W*H);
 for(let i=0;i<gray.length;i++){const k=i*4,a=pixels[k+3]/255;const l=(.2126*pixels[k]+.7152*pixels[k+1]+.0722*pixels[k+2])*a+255*(1-a);
 gray[i]=Math.pow(Math.min(1,Math.max(0,((l-127.5)*(options.contrast??1)+127.5+(options.brightness??0)*2.55)/255)),options.gamma??1);}
 const blurred=gaussianFrame(gray,W,H,options.mode4BlurSigma??MODE4_BLUR_SIGMA),w=W/2,h=H/2;
 const small=new Float32Array(w*h),mag=new Float32Array(w*h),direction=new Uint8Array(w*h),thin=new Float32Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*2*W+x*2;small[y*w+x]=(blurred[p]+blurred[p+1]+blurred[p+W]+blurred[p+W+1])*.25;}
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x,gx=(small[i+1]-small[i-1])/2,gy=(small[i+w]-small[i-w])/2;
  mag[i]=Math.hypot(gx,gy);const a=(Math.atan2(gy,gx)*180/Math.PI+180)%180;direction[i]=a<22.5||a>=157.5?0:a<67.5?1:a<112.5?2:3;
 }
 const high=options.mode4EdgeHigh??MODE4_EDGE_HIGH,low=options.mode4EdgeLow??MODE4_EDGE_LOW;
 const steps=[1,w+1,w,w-1];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,d=steps[direction[i]],m=mag[i];if(m>=low&&m>=mag[i-d]&&m>=mag[i+d])thin[i]=m;}
 const edges=new Float32Array(w*h),seen=new Uint8Array(w*h),stack=[],component=[];
 for(let i=0;i<thin.length;i++)if(thin[i]>=high&&!seen[i]){
  stack.push(i);seen[i]=1;component.length=0;
  while(stack.length){const p=stack.pop();component.push(p);const x=p%w,y=p/w|0;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<=0||nx>=w-1||ny<=0||ny>=h-1)continue;
    const n=ny*w+nx;if(!seen[n]&&thin[n]>=low){seen[n]=1;stack.push(n);}}
  }
  if(component.length>=12)for(const p of component)edges[p]=1;
 }
 // Broaden a one-pixel skeleton to the Noto stroke width; no source luminance fill.
 const ink=gaussianFrame(edges,w,h,.9);for(let i=0;i<ink.length;i++)ink[i]=Math.min(1,ink[i]*2.4);
 const targets=[],counts=[];
 for(let cy=0;cy<height;cy++)for(let cx=0;cx<width/2;cx++){
  const cell=new Float32Array(900);let count=0;
  for(let y=0;y<30;y++)for(let x=0;x<30;x++){const i=(cy*30+y)*w+cx*30+x;cell[y*30+x]=ink[i];count+=edges[i];}
  targets.push(shapeDescriptor(areaSample(cell,30,30,24)));counts.push(count);
 }
 targets.edgeCounts=counts;if(options.mode4DebugImage)targets.contours={pixels:edges,width:w,height:h};
 return targets;
}
export function selectMode4Glyphs(targets,atlas){
 const indices=[],scores=[];
 for(const t of targets){let best=Infinity,id=0;for(let g=0;g<atlas.length;g++){const loss=glyphScore(t,atlas[g].features);if(loss<best){best=loss;id=g;}}indices.push(id);scores.push(best);}
 return {indices,scores};
}
export function judgeMode4(targets,result,atlas,options={}){
 const limit=options.mode4ScoreLimit??MODE4_LIMIT,minEdge=options.mode4MinEdge??MODE4_MIN_EDGE;
 if(!Number.isFinite(limit)||limit<0||limit>10||!Number.isFinite(minEdge)||minEdge<1)throw Error('合格ラインが不正です');
 return result.indices.map((id,i)=>{
  const score=result.scores[i],edge=targets.edgeCounts[i];
  if(!Number.isInteger(id)||!atlas[id]||!Number.isFinite(score))throw Error('字形スコアが不正です');
  const accepted=edge>=minEdge&&score<=limit;
  return {cell:i,bestChar:atlas[id].char,bestScore:score,edgePixels:edge,limit,accepted,output:accepted?atlas[id].char:MODE4_SPACE,reason:edge<minEdge?'no-contour':score>limit?'score':'accepted'};
 });
}
export class Grid60Converter{
 constructor(atlas){this.atlas=atlas;this.acceleration='CPU 60px contour matching';this.lastPerf=null;}
 restore(s){if(s&&s.engine!==MODE4_ENGINE)throw Error('旧モード4の途中データは引き継げません');}
 snapshot(){return {engine:MODE4_ENGINE};}
 async enableNativeGPU(){try{const {NativeGrid60}=await import('./tsl-mode4-grid60-native.js');this.native=await NativeGrid60.create();this.nativeGpuInfo=this.native?.adapterInfo;}catch(e){this.gpuError=e.message;}}
 async convertAccelerated(pixels,width,height,options={}){
  const start=performance.now(),targets=prepareMode4Targets(pixels,width,height,options),prepared=performance.now();let result;
  if(this.native)try{result=await this.native.match(targets,this.atlas);this.acceleration=this.native.adapterInfo.software?'WARP test 60px contour matching':'DirectCompute 60px contour matching';}
   catch(e){this.gpuError=e.message;this.native=null;this.acceleration='CPU 60px contour matching';}
  result??=selectMode4Glyphs(targets,this.atlas);
  // Final common gate runs AFTER CPU/GPU selection. No layout pass may revive a rejection.
  const decisions=judgeMode4(targets,result,this.atlas,options),accepted=decisions.filter(d=>d.accepted).length;
  this.lastAudit=options.mode4Diagnostics?decisions:null;
  this.lastPerf={prepareMs:prepared-start,matchMs:performance.now()-prepared,totalMs:performance.now()-start,candidates:170,cells:targets.length,accepted,blank:targets.length-accepted,limit:options.mode4ScoreLimit??MODE4_LIMIT,sigma:options.mode4BlurSigma??MODE4_BLUR_SIGMA};
  const rows=[];for(let y=0;y<height;y++)rows.push(decisions.slice(y*width/2,(y+1)*width/2).map(d=>d.output).join(''));
  return rows.join('\r\n')+'\r\n';
 }
}
