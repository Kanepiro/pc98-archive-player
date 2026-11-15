import {GRID120_CHARS,GRID120_BYTES,GRID120_MASK_SHA256} from './mode4-palette.js';
export const MODE4_CELL=120,MODE4_SAMPLE=24,MODE4_ENGINE=1202;
export const MODE4_BLUR_SIGMA=8;
const chars=[...GRID120_CHARS],ids=new Map(chars.map((c,i)=>[c,i]));
const state=globalThis[Symbol.for('tasl.mode4.grid120.v1')]??={promise:null,masks:null,tints:new Map()};
export function mode4Grid(w,h){
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>3840*2160)throw Error('モード4の動画サイズが不正です');
 const columns=Math.ceil(w/120),height=Math.ceil(h/120);
 return {width:columns*2,height,columns,mode4Cell120:true,native16:false,
  sourceWidth:w,sourceHeight:h,pixelWidth:columns*120,pixelHeight:height*120};
}
export function validateGridFrame(lines,width,height){
 if(width%2||lines.length!==height||lines.some(row=>[...row].length!==width/2||[...row].some(c=>!ids.has(c))))
  throw Error('モード4は各120pxセルに指定文字を1文字ずつ配置します');
}
export function encodeGridFrame(lines){
 const bytes=[];
 for(const row of lines){for(const c of row){const i=ids.get(c);if(i===undefined)throw Error('指定外の文字です');bytes.push(...GRID120_BYTES[i]);}bytes.push(13,10);}
 bytes.push(12,13,10);return Uint8Array.from(bytes);
}
export function ensureMode4Atlas(){
 if(state.promise)return state.promise;
 state.promise=(async()=>{
  const r=await fetch(new URL('./mode4-atlas.bin',import.meta.url));if(!r.ok)throw Error('モード4の字形を読み込めません');
  const bytes=new Uint8Array(await r.arrayBuffer());
  if(bytes.length!==chars.length*120*120)throw Error('モード4字形のサイズが不正です');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==GRID120_MASK_SHA256)throw Error('モード4字形のハッシュが一致しません');
  state.masks=bytes;return bytes;
 })();return state.promise;
}
function canvasOf(w,h){
 const c=typeof document==='undefined'?new OffscreenCanvas(w,h):document.createElement('canvas');
 c.width=w;c.height=h;return c;
}
function tintedAtlas(color){
 if(!state.masks)throw Error('モード4の字形読み込みが完了していません');
 if(state.tints.has(color))return state.tints.get(color);
 const canvas=canvasOf(1200,2040),c=canvas.getContext('2d'),im=c.createImageData(1200,2040);
 for(let g=0;g<chars.length;g++)for(let y=0;y<120;y++)for(let x=0;x<120;x++){
  const i=(((g/10|0)*120+y)*1200+(g%10)*120+x)*4;
  im.data[i]=im.data[i+1]=im.data[i+2]=255;im.data[i+3]=state.masks[g*14400+y*120+x];
 }
 c.putImageData(im,0,0);c.globalCompositeOperation='source-in';c.fillStyle=color;c.fillRect(0,0,1200,2040);
 if(state.tints.size>=4)state.tints.delete(state.tints.keys().next().value);
 state.tints.set(color,canvas);return canvas;
}
export function drawMode4Grid(canvas,data,index,{foreground='#e3f4e8',background='#080d12'}={}){
 const lines=data.frames[index].split('\n');validateGridFrame(lines,data.width,data.height);
 const w=data.width*60,h=data.height*120;
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 const c=canvas.getContext('2d');c.fillStyle=background;c.fillRect(0,0,w,h);
 const atlas=tintedAtlas(foreground);c.imageSmoothingEnabled=false;
 for(let y=0;y<lines.length;y++)for(let x=0,row=[...lines[y]];x<row.length;x++){
  const g=ids.get(row[x]);c.drawImage(atlas,(g%10)*120,(g/10|0)*120,120,120,x*120,y*120,120,120);
 }
}
// Three separable box passes approximate a Gaussian on the complete frame,
// before any cell is extracted. Edge replication avoids artificial borders.
export function boxBlur(src,w,h,r,tmp=null,dst=null){
 if(r===0)return Float32Array.from(src);
 tmp??=new Float32Array(src.length);dst??=new Float32Array(src.length);const n=2*r+1;
 for(let y=0;y<h;y++){
  const off=y*w;let sum=0;for(let k=-r;k<=r;k++)sum+=src[off+Math.min(w-1,Math.max(0,k))];
  for(let x=0;x<w;x++){tmp[off+x]=sum/n;sum+=src[off+Math.min(w-1,x+r+1)]-src[off+Math.max(0,x-r)];}
 }
 for(let x=0;x<w;x++){
  let sum=0;for(let k=-r;k<=r;k++)sum+=tmp[Math.min(h-1,Math.max(0,k))*w+x];
  for(let y=0;y<h;y++){dst[y*w+x]=sum/n;sum+=tmp[Math.min(h-1,y+r+1)*w+x]-tmp[Math.max(0,y-r)*w+x];}
 }
 return dst;
}
export function gaussianFrame(src,w,h,sigma=MODE4_BLUR_SIGMA,workspace=null){
 const ideal=Math.sqrt(4*sigma*sigma+1),low=Math.floor(ideal)|1,lo=low>ideal?low-2:low,hi=lo+2;
 const m=Math.round((12*sigma*sigma-3*lo*lo-12*lo-9)/(-4*lo-4));
 let out=src;
 for(let k=0;k<3;k++)out=boxBlur(out,w,h,((k<m?lo:hi)-1)/2,workspace?.temp,workspace?(k%2===0?workspace.output:workspace.gray):null);
 return out;
}
function downsample(a,w,h,n){
 const out=new Float32Array(n*n),sx=w/n,sy=h/n;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  let sum=0;for(let yy=y*sy;yy<(y+1)*sy;yy++)for(let xx=x*sx;xx<(x+1)*sx;xx++)sum+=a[yy*w+xx];
  out[y*n+x]=sum/(sx*sy);
 }return out;
}
function unitInto(out,values,weight,center=false){
 let mean=center?values.reduce((a,b)=>a+b,0)/values.length:0,norm=0;
 for(const v of values)norm+=(v-mean)**2;
 norm=Math.sqrt(norm)+1e-5;
 for(const v of values)out.push(weight*(v-mean)/norm);
}
// Spatial correlation of contours, stroke position/orientation and coarse shape.
// Every glyph is scored spatially. Ink balance is computed from the contour map,
// never from mean source luminance; flat regions stay sparse at every brightness.
export function shapeDescriptor(mask,target=false){
 const smooth=boxBlur(mask,24,24,1),small=downsample(smooth,24,24,12),gx=[],gy=[];
 for(let y=0;y<12;y++)for(let x=0;x<12;x++){
  gx.push(small[y*12+Math.min(11,x+1)]-small[y*12+Math.max(0,x-1)]);
  gy.push(small[Math.min(11,y+1)*12+x]-small[Math.max(0,y-1)*12+x]);
 }
 const out=[];unitInto(out,small,Math.sqrt(.5),true);unitInto(out,gx,Math.sqrt(.14));unitInto(out,gy,Math.sqrt(.14));
 unitInto(out,downsample(smooth,24,24,6),Math.sqrt(.22));
 const mean=mask.reduce((a,b)=>a+b,0)/mask.length;
 if(target){let peak=0;for(const v of mask)peak=Math.max(peak,v);const strength=Math.min(1,peak/.18);for(let i=0;i<out.length;i++)out[i]*=strength;}
 out.push(mean*8);
 return Float32Array.from(out);
}
export async function makeMode4Atlas(){
 const bytes=await ensureMode4Atlas(),atlas=[];
 for(let i=0;i<chars.length;i++){
  const full=Float32Array.from(bytes.subarray(i*14400,(i+1)*14400),v=>v/255);
  const mask=downsample(full,120,120,24);
  if(!mask.some(v=>v>0))throw Error('指定文字の字形が空です');
  atlas.push({char:chars[i],columns:2,mask,features:shapeDescriptor(mask)});
 }return atlas;
}
let frameWorkspace=null;
export function prepareMode4Targets(pixels,width,height,options={}){
 const W=width/2*120,H=height*120;
 if(width%2||pixels.length!==W*H*4)throw Error('モード4の120px画素数が一致しません');
 if(frameWorkspace?.gray.length!==W*H)frameWorkspace={gray:new Float32Array(W*H),temp:new Float32Array(W*H),output:new Float32Array(W*H)};
 const gray=frameWorkspace.gray;
 for(let i=0;i<gray.length;i++){
  const k=i*4,a=pixels[k+3]/255,l=(.2126*pixels[k]+.7152*pixels[k+1]+.0722*pixels[k+2])*a+255*(1-a);
  const v=Math.min(1,Math.max(0,((l-127.5)*(options.contrast??1)+127.5+(options.brightness??0)*2.55)/255));
  gray[i]=Math.pow(v,options.gamma??1);
 }
 const blurred=gaussianFrame(gray,W,H,options.mode4BlurSigma??MODE4_BLUR_SIGMA,frameWorkspace),targets=[];
 // Area-average the already-blurred image. Derivatives span cell boundaries:
 // extracting each cell first would invent or lose lines along the grid.
 const w=W/5,h=H/5,small=new Float32Array(w*h),contours=new Float32Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let sum=0;for(let dy=0;dy<5;dy++)for(let dx=0;dx<5;dx++)sum+=blurred[(y*5+dy)*W+x*5+dx];
  small[y*w+x]=sum/25;
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const gx=(small[y*w+Math.min(w-1,x+1)]-small[y*w+Math.max(0,x-1)])/2;
  const gy=(small[Math.min(h-1,y+1)*w+x]-small[Math.max(0,y-1)*w+x])/2;
  contours[y*w+x]=Math.min(1,2*Math.hypot(gx,gy));
 }
 for(let cy=0;cy<height;cy++)for(let cx=0;cx<width/2;cx++){
  const mask=new Float32Array(576);
  for(let y=0;y<24;y++)for(let x=0;x<24;x++)mask[y*24+x]=contours[(cy*24+y)*w+cx*24+x];
  targets.push(shapeDescriptor(mask,true));
 }return targets;
}
export function selectMode4Glyphs(targets,atlas){
 return targets.map(t=>{
  let best=Infinity,id=0;
  for(let g=0;g<atlas.length;g++){
   const v=atlas[g].features;let loss=0;
   for(let j=0;j<t.length;j++)loss+=(t[j]-v[j])**2;
   if(loss<best){best=loss;id=g;}
  }return id;
 });
}
export class Grid120Converter{
 constructor(atlas){this.atlas=atlas;this.acceleration='CPU 120px shape matching';this.lastPerf=null;}
 restore(s){if(s&&s.engine!==MODE4_ENGINE)throw Error('旧モード4の途中データは引き継げません');}
 snapshot(){return {engine:MODE4_ENGINE};}
 async enableNativeGPU(){
  try{const {NativeGrid120}=await import('./tsl-mode4-grid-native.js');this.native=await NativeGrid120.create();this.nativeGpuInfo=this.native?.adapterInfo;}
  catch(e){this.gpuError=e.message;}
 }
 async convertAccelerated(pixels,width,height,options){
  const start=performance.now(),targets=prepareMode4Targets(pixels,width,height,options),prepared=performance.now();
  let indices;
  if(this.native)try{indices=await this.native.match(targets,this.atlas);this.acceleration=this.native.adapterInfo.software?'WARP test 120px shape matching':'DirectCompute 120px shape matching';}
   catch(e){this.gpuError=e.message;this.native=null;this.acceleration='CPU 120px shape matching';}
  indices??=selectMode4Glyphs(targets,this.atlas);
  const rows=[];for(let y=0;y<height;y++)rows.push(indices.slice(y*width/2,(y+1)*width/2).map(i=>this.atlas[i].char).join(''));
  this.lastPerf={prepareMs:prepared-start,matchMs:performance.now()-prepared,totalMs:performance.now()-start,candidates:this.atlas.length,cells:targets.length};
  return rows.join('\r\n')+'\r\n';
 }
}
