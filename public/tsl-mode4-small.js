import {MODE4_CHARS} from './mode4-palette60.js';
import {SMALL_PROFILES} from './mode4-small-profiles.js';
import {Grid60Converter,shapeDescriptor,gaussianFrame,gaussianHalfFrame,areaSample,selectMode4Glyphs,judgeMode4,validateGridFrame} from './tsl-mode4-grid60.js';
import {decodeOffsets} from './mode4-position60.js';
const ids=new Map([...MODE4_CHARS].map((c,i)=>[c,i])),chars=[...MODE4_CHARS],cache=new Map();
export function smallProfile(cell){
 const p=SMALL_PROFILES[cell];if(!p||![30,40].includes(Number(cell)))throw Error('モード4のセルサイズが不正です');
 return p;
}
export function smallGrid(w,h,cell){
 smallProfile(cell);
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>3840*2160)throw Error('モード4の動画サイズが不正です');
 const columns=Math.ceil(w/cell),height=Math.ceil(h/cell);
 return {width:columns*2,height,columns,mode4CellSize:cell,mode4Cell60:false,native16:false,sourceWidth:w,sourceHeight:h,pixelWidth:columns*cell,pixelHeight:height*cell};
}
export function validateSmallOffsets(lines,width,height,bytes,cell){
 const p=smallProfile(cell);validateGridFrame(lines,width,height);
 if(!(bytes instanceof Uint8Array)||bytes.length!==width*height)throw Error('文字位置のサイズが不正です');
 for(let y=0;y<height;y++)for(let x=0,row=[...lines[y]];x<width/2;x++){
  const at=y*width+x*2,dx=bytes[at]-60,dy=bytes[at+1]-60,g=ids.get(row[x]);
  if(dx%p.step||dy%p.step||Math.abs(dx)>=cell||Math.abs(dy)>=cell)throw Error('文字位置が不正です');
  if(row[x]==='　'){if(dx||dy)throw Error('空白の位置は固定です');continue;}
  const [l,t,r,b]=p.bounds[g];if(l+dx<0||r+dx>cell||t+dy<0||b+dy>cell)throw Error('文字がセルからはみ出します');
 }
 return bytes;
}
export function parseSmallPositions(header,frames,width,height,cell){
 const entries=header.split('\n').filter(l=>l.startsWith('# TASL_MODE4_OFFSETS '));
 if(!entries.length)return null;if(entries.length!==frames.length)throw Error('文字位置の画面数が不正です');
 const out=new Array(frames.length);
 for(const line of entries){
  const m=line.match(/^# TASL_MODE4_OFFSETS (\d+) ([A-Za-z0-9+/=]+)$/);if(!m)throw Error('文字位置ヘッダーが不正です');
  const n=Number(m[1]);if(n>=frames.length||out[n])throw Error('文字位置の画面番号が不正です');
  out[n]=validateSmallOffsets(frames[n].split('\n'),width,height,decodeOffsets(m[2],width*height),cell);
 }
 return out;
}
function state(cell){smallProfile(cell);if(!cache.has(cell))cache.set(cell,{masks:null,promise:null,atlas:null,tints:new Map()});return cache.get(cell);}
export function ensureSmallAtlas(cell){
 const s=state(cell),p=smallProfile(cell);
 return s.promise??=(async()=>{
  const r=await fetch(new URL('./mode4-atlas'+cell+'.bin',import.meta.url));if(!r.ok)throw Error('字形を読み込めません');
  const bytes=new Uint8Array(await r.arrayBuffer()),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(bytes.length!==170*cell*cell||hash!==p.hash)throw Error('字形が一致しません');s.masks=bytes;return bytes;
 })().catch(e=>{s.promise=null;throw e;});
}
export async function makeSmallAtlas(cell){
 const s=state(cell);if(s.atlas)return s.atlas;const p=smallProfile(cell),bytes=await ensureSmallAtlas(cell),atlas=[];
 for(let g=0;g<170;g++){
  const [l,t,r,b]=p.bounds[g],offsets=[[0,0]];
  for(let dy=Math.ceil(-t/p.step)*p.step;dy<=cell-b;dy+=p.step)for(let dx=Math.ceil(-l/p.step)*p.step;dx<=cell-r;dx+=p.step)if(dx||dy)offsets.push([dx,dy]);
  for(const [dx,dy] of offsets){
   // Shift the native-resolution mask BEFORE area integration. Fractional
   // descriptor coordinates must not truncate small-size position candidates.
   const shifted=new Float32Array(cell*cell);
   for(let y=t;y<b;y++)for(let x=l;x<r;x++)shifted[(y+dy)*cell+x+dx]=bytes[g*cell*cell+y*cell+x]/255;
   const features=shapeDescriptor(areaSample(shifted,cell,cell,24),'glyph'),ink=[];
   for(let k=0;k<576;k++)if(features[k])ink.push(k);
   atlas.push({char:chars[g],glyph:g,columns:2,dx,dy,features,ink});
  }
 }
 if(new Set(atlas.map(g=>g.char)).size!==170||atlas.length>8192)throw Error('配置候補が不正です');
 s.atlas=atlas;return atlas;
}
export function drawSmallGrid(canvas,data,index,{foreground='#e3f4e8',background='#080d12'}={}){
 const cell=data.mode4CellSize,s=state(cell),lines=data.frames[index].split('\n'),positions=data.mode4Offsets?.[index];
 validateGridFrame(lines,data.width,data.height);if(positions)validateSmallOffsets(lines,data.width,data.height,positions,cell);
 if(!s.masks)throw Error('字形読み込み未完了');
 if(!s.tints.has(foreground)){
  const atlas=typeof document==='undefined'?new OffscreenCanvas(cell*10,cell*17):document.createElement('canvas');
  atlas.width=cell*10;atlas.height=cell*17;const c=atlas.getContext('2d'),im=c.createImageData(atlas.width,atlas.height);
  for(let g=0;g<170;g++)for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){const i=(((g/10|0)*cell+y)*atlas.width+g%10*cell+x)*4;im.data[i]=im.data[i+1]=im.data[i+2]=255;im.data[i+3]=s.masks[g*cell*cell+y*cell+x];}
  c.putImageData(im,0,0);c.globalCompositeOperation='source-in';c.fillStyle=foreground;c.fillRect(0,0,atlas.width,atlas.height);
  if(s.tints.size>=4)s.tints.delete(s.tints.keys().next().value);s.tints.set(foreground,atlas);
 }
 const w=data.width/2*cell,h=data.height*cell;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 const c=canvas.getContext('2d');c.fillStyle=background;c.fillRect(0,0,w,h);c.imageSmoothingEnabled=false;
 for(let y=0;y<lines.length;y++)for(let x=0,row=[...lines[y]];x<row.length;x++){
  const g=ids.get(row[x]);if(g===undefined)continue;const at=y*data.width+x*2,dx=positions?positions[at]-60:0,dy=positions?positions[at+1]-60:0;
  c.save();c.beginPath();c.rect(x*cell,y*cell,cell,cell);c.clip();c.drawImage(s.tints.get(foreground),g%10*cell,(g/10|0)*cell,cell,cell,x*cell+dx,y*cell+dy,cell,cell);c.restore();
 }
}
export function principalSmallContours(raw,w,h,halfCell){
 if(w%halfCell||h%halfCell||raw.length!==w*h)throw Error('Contour grid invalid');
 const labels=new Int32Array(raw.length),sizes=[0],filtered=new Float32Array(raw.length);let label=0;
 for(let i=0;i<raw.length;i++)if(raw[i]&&!labels[i]){
  label++;const todo=[i];labels[i]=label;
  for(let k=0;k<todo.length;k++){const at=todo[k],x=at%w,y=at/w|0;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;const j=ny*w+nx;if(raw[j]&&!labels[j]){labels[j]=label;todo.push(j);}}
  }sizes.push(todo.length);
 }
 for(let cy=0;cy<h/halfCell;cy++)for(let cx=0;cx<w/halfCell;cx++){
  const visited=new Uint8Array(halfCell*halfCell);let best=[],importance=-1;
  for(let q=0;q<visited.length;q++){
   const gx=cx*halfCell+q%halfCell,gy=cy*halfCell+(q/halfCell|0);if(visited[q]||!raw[gy*w+gx])continue;
   const todo=[q];visited[q]=1;
   for(let k=0;k<todo.length;k++){const at=todo[k],x=at%halfCell,y=at/halfCell|0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||nx>=halfCell||ny<0||ny>=halfCell)continue;const j=ny*halfCell+nx;if(!visited[j]&&raw[(cy*halfCell+ny)*w+cx*halfCell+nx]){visited[j]=1;todo.push(j);}}
   }
   const score=todo.length*(1+.25*Math.log1p(sizes[labels[gy*w+gx]]));if(score>importance){importance=score;best=todo;}
  }
  for(const q of best)filtered[(cy*halfCell+(q/halfCell|0))*w+cx*halfCell+q%halfCell]=1;
 }
 return filtered;
}
export function smallOptions(cell,o={}){
 const p=smallProfile(cell);
 return {...o,mode4CellSize:cell,mode4BlurSigma:o.mode4BlurSigma??p.sigma,mode4EdgeHigh:o.mode4EdgeHigh??p.high,mode4EdgeLow:o.mode4EdgeLow??p.low,mode4MinEdge:o.mode4MinEdge??p.minEdge,mode4ScoreLimit:o.mode4ScoreLimit??p.limit};
}
export function prepareSmallTargets(pixels,width,height,cell,options={}){
 const p=smallProfile(cell),o=smallOptions(cell,options),W=width/2*cell,H=height*cell,halfCell=cell/2;
 if(width%2||pixels.length!==W*H*4)throw Error('画素数が一致しません');
 const gray=new Float32Array(W*H);
 for(let i=0;i<gray.length;i++){const k=i*4,a=pixels[k+3]/255,l=(.2126*pixels[k]+.7152*pixels[k+1]+.0722*pixels[k+2])*a+255*(1-a);gray[i]=Math.pow(Math.min(1,Math.max(0,((l-127.5)*(o.contrast??1)+127.5+(o.brightness??0)*2.55)/255)),o.gamma??1);}
 const w=W/2,h=H/2,small=gaussianHalfFrame(gray,W,H,o.mode4BlurSigma),mag=new Float32Array(w*h),direction=new Uint8Array(w*h),thin=new Float32Array(w*h),steps=[1,w+1,w,w-1];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,gx=(small[i+1]-small[i-1])/2,gy=(small[i+w]-small[i-w])/2;mag[i]=Math.hypot(gx,gy);const a=(Math.atan2(gy,gx)*180/Math.PI+180)%180;direction[i]=a<22.5||a>=157.5?0:a<67.5?1:a<112.5?2:3;}
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,d=steps[direction[i]],m=mag[i];if(m>=o.mode4EdgeLow&&m>=mag[i-d]&&m>=mag[i+d])thin[i]=m;}
 let edges=new Float32Array(w*h);const seen=new Uint8Array(w*h);
 for(let i=0;i<thin.length;i++)if(thin[i]>=o.mode4EdgeHigh&&!seen[i]){
  const todo=[i];seen[i]=1;
  for(let k=0;k<todo.length;k++){const at=todo[k],x=at%w,y=at/w|0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<=0||nx>=w-1||ny<=0||ny>=h-1)continue;const j=ny*w+nx;if(!seen[j]&&thin[j]>=o.mode4EdgeLow){seen[j]=1;todo.push(j);}}}
  if(todo.length>=p.minComponent)for(const at of todo)edges[at]=1;
 }
 const rawEdges=edges;edges=principalSmallContours(edges,w,h,halfCell);
 const ink=gaussianFrame(edges,w,h,p.inkSigma);for(let i=0;i<ink.length;i++)ink[i]=Math.min(1,ink[i]*p.inkGain);
 const targets=[],counts=[];
 for(let cy=0;cy<height;cy++)for(let cx=0;cx<width/2;cx++){
  const block=new Float32Array(halfCell*halfCell);let count=0;
  for(let y=0;y<halfCell;y++)for(let x=0;x<halfCell;x++){const i=(cy*halfCell+y)*w+cx*halfCell+x;block[y*halfCell+x]=ink[i];count+=edges[i];}
  targets.push(shapeDescriptor(areaSample(block,halfCell,halfCell,24),'target'));counts.push(count);
 }
 targets.edgeCounts=counts;if(o.mode4DebugImage)targets.contours={pixels:edges,rawPixels:rawEdges,width:w,height:h};return targets;
}
export class SmallGridConverter{
 constructor(atlas,cell){this.profile=smallProfile(cell);this.cell=cell;this.atlas=atlas;this.acceleration='CPU '+cell+'px contour matching';}
 restore(s){if(s&&s.engine!==this.profile.engine)throw Error('サイズまたは変換方式の異なる途中データは引き継げません');}
 snapshot(){return {engine:this.profile.engine};}
 async enableNativeGPU(){}
 async convertAccelerated(pixels,width,height,options={}){
  const o=smallOptions(this.cell,options),start=performance.now();let targets,result,prepared,nativeStages=null;
  if(this.native&&!o.mode4DebugImage)try{
   result=await this.native.prepareMatch(pixels,width,height,this.atlas,o);targets=Array.from({length:result.indices.length},()=>null);targets.edgeCounts=result.counts;nativeStages=result.timings;prepared=start+nativeStages.slice(0,4).reduce((a,b)=>a+b,0);this.acceleration=(this.native.adapterInfo.software?'WARP test ':'DirectCompute small ')+this.cell+'px / SSE2';
  }catch(e){this.gpuError=e.message;this.native=null;}
  if(!result){targets=prepareSmallTargets(pixels,width,height,this.cell,o);prepared=performance.now();result=Grid60Converter.prototype.matchCached.call(this,targets);this.acceleration='CPU '+this.cell+'px contour matching';}
  const decisions=judgeMode4(targets,result,this.atlas,o),accepted=decisions.filter(d=>d.accepted).length;
  this.lastOffsets=Uint8Array.from(decisions.flatMap(d=>[d.x+60,d.y+60]));this.lastAudit=o.mode4Diagnostics?decisions:null;
  this.lastPerf={totalMs:performance.now()-start,prepareMs:prepared-start,matchMs:nativeStages?nativeStages[4]:performance.now()-prepared,nativeStages,candidates:170,positions:this.atlas.length,cells:decisions.length,accepted,blank:decisions.length-accepted,cell:this.cell,profile:this.profile.engine};
  const rows=[];for(let y=0;y<height;y++)rows.push(decisions.slice(y*width/2,(y+1)*width/2).map(d=>d.output).join(''));
  return rows.join('\r\n')+'\r\n';
 }
}
