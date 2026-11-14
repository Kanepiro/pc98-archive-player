import {FullGpuNativeLayout} from './tsl-fullgpu-native.js';
import {parseArtisanStructure,buildArtisanTopology,finishArtisanTopology} from './tsl-artisan-structure.js';
import {NativeContour} from './tsl-fullgpu-contour.js';
import {guideArtisanFaces} from './tsl-artisan-portrait.js';
import {refineArtisanLayout} from './tsl-artisan-critic.js';
import {Mode4GpuMatcher} from './tsl-artisan-webgpu.js';
import {Mode4ExactNativeMatcher} from './tsl-mode4-native-exact.js';
import {composeArtisanBand} from './tsl-artisan-blocks.js';
// Mode 4 "AA artisan" composer. Independent of Mode 3's per-row template matcher.
// Structural contour field + alignment-tolerant stroke fitting + 2D seam-aware
// row reflow. Text remains a strict 272-character CP932 whitelist + blank.
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));

function tent(source,w,h){
 const tmp=new Float32Array(source.length),out=new Float32Array(source.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const k=y*w+x;
  tmp[k]=(source[y*w+Math.max(0,x-1)]+2*source[k]+source[y*w+Math.min(w-1,x+1)])*.25;
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const k=y*w+x;
  out[k]=(tmp[Math.max(0,y-1)*w+x]+2*tmp[k]+tmp[Math.min(h-1,y+1)*w+x])*.25;
 }
 return out;
}
function sobel(channel,w,i){
 const a=channel[i-w-1],b=channel[i-w],c=channel[i-w+1];
 const d=channel[i-1],f=channel[i+1];
 const g=channel[i+w-1],h=channel[i+w],j=channel[i+w+1];
 return [(c+2*f+j-a-2*d-g)*.125,(g+2*h+j-a-2*b-c)*.125];
}
// Closest contour distance, 8-neighbour 2-pass chamfer transform, in pixels.
export function contourDistance(target,w,h){
 const out=new Float32Array(target.length),diag=1.41421356;
 out.fill(5);
 for(let i=0;i<out.length;i++)if(target[i]>.22)out[i]=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;let d=out[i];
  if(x>0)d=Math.min(d,out[i-1]+1);
  if(y>0){d=Math.min(d,out[i-w]+1);
   if(x>0)d=Math.min(d,out[i-w-1]+diag);
   if(x+1<w)d=Math.min(d,out[i-w+1]+diag);}
  out[i]=d;
 }
 for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
  const i=y*w+x;let d=out[i];
  if(x+1<w)d=Math.min(d,out[i+1]+1);
  if(y+1<h){d=Math.min(d,out[i+w]+1);
   if(x>0)d=Math.min(d,out[i+w-1]+diag);
   if(x+1<w)d=Math.min(d,out[i+w+1]+diag);}
  out[i]=d;
 }
 return out;
}
// Extract strong, connected major boundaries, including edges separating
// nearly equal-brightness colors. DoG adds subordinate fine contours only.
export function artisanContourField(pixels,width,height,sample,options={},prevGray=null){
 const w=width*sample,h=height*sample,n=w*h;
 if(pixels.length!==n*4)throw Error('モード4の入力画素数が一致しません');
 const {brightness=0,contrast=1,gamma=1}=options;
 const red=new Float32Array(n),green=new Float32Array(n),blue=new Float32Array(n),gray=new Float32Array(n);
 for(let i=0;i<n;i++){
  const j=i*4;
  red[i]=clamp((pixels[j]/255-.5)*contrast+.5+brightness/100)**gamma;
  green[i]=clamp((pixels[j+1]/255-.5)*contrast+.5+brightness/100)**gamma;
  blue[i]=clamp((pixels[j+2]/255-.5)*contrast+.5+brightness/100)**gamma;
  gray[i]=.2126*red[i]+.7152*green[i]+.0722*blue[i];
 }
 let change=0,c=0;
 if(prevGray?.length===n){
  const step=Math.max(1,Math.floor(n/2500));
  for(let i=0;i<n;i+=step){change+=Math.abs(gray[i]-prevGray[i]);c++;}
 }
 const cut=c>0&&change/c>.18;
 const a=tent(red,w,h),b=tent(green,w,h),cblue=tent(blue,w,h),g=tent(gray,w,h);
 const smooth=tent(tent(g,w,h),w,h);
 const mag=new Float32Array(n),orient=new Uint8Array(n),peak=new Uint8Array(n);
 let maxMag=0;
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x;
  let best=0,gx=0,gy=0;
  for(const channel of [g,a,b,cblue]){
   const [dx,dy]=sobel(channel,w,i),m=dx*dx+dy*dy;
   if(m>best){best=m;gx=dx;gy=dy;}
  }
  const m=Math.sqrt(best);mag[i]=m;maxMag=Math.max(maxMag,m);
  const angle=(Math.atan2(gy,gx)*180/Math.PI+180)%180;
  orient[i]=angle<22.5||angle>=157.5?0:angle<67.5?1:angle<112.5?2:3;
 }
 const lowThreshold=Math.max(.036,Math.min(.095,maxMag*.13));
 const highThreshold=Math.max(.105,Math.min(.21,maxMag*.31));
 const dir=[1,w+1,w,w-1];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x,m=mag[i],d=dir[orient[i]];
  if(m>=lowThreshold&&m>=mag[i-d]&&m>=mag[i+d])peak[i]=1;
 }
 const visited=new Uint8Array(n),connected=new Uint8Array(n),stack=[];
 for(let i=0;i<n;i++){
  if(visited[i]||!peak[i]||mag[i]<highThreshold)continue;
  const group=[i];stack.push(i);visited[i]=1;
  while(stack.length){
   const k=stack.pop(),y=Math.floor(k/w),x=k%w;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    if(!dx&&!dy)continue;
    const xx=x+dx,yy=y+dy;if(xx<=0||xx>=w-1||yy<=0||yy>=h-1)continue;
    const j=yy*w+xx;
    if(!visited[j]&&peak[j]&&mag[j]>=lowThreshold){visited[j]=1;stack.push(j);group.push(j);}
   }
  }
  if(group.length>=3)for(const j of group)connected[j]=1;
 }
 const target=new Float32Array(n);
 for(let i=0;i<n;i++){
  const dog=Math.max(0,Math.abs(g[i]-smooth[i])-.016)*5.5;
  const edge=connected[i]?Math.max(.76,clamp(mag[i]*4)):0;
  const v=Math.max(edge,dog*.70);
  target[i]=v<.18?0:Math.min(1,v);
 }
 return {target,gray,dist:contourDistance(target,w,h),cut,w,h};
}
// Four tangent orientation bins: horizontal, \, vertical, /.
// This compares stroke shape rather than literal characters or text meaning.
function strokeHistogram(mask,width,height,offset=0,stride=width){
 const hist=new Float32Array(4);
 const neigh=[[-1,0,1,0],[-1,-1,1,1],[0,-1,0,1],[1,-1,-1,1]];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const v=mask[offset+y*stride+x];if(v<.16)continue;
  for(let k=0;k<4;k++){
   const [ax,ay,bx,by]=neigh[k];
   const a=x+ax>=0&&x+ax<width&&y+ay>=0&&y+ay<height
    ?mask[offset+(y+ay)*stride+x+ax]:0;
   const b=x+bx>=0&&x+bx<width&&y+by>=0&&y+by<height
    ?mask[offset+(y+by)*stride+x+bx]:0;
   hist[k]+=v*Math.min(1,(a+b)*.65);
  }
 }
 let sum=0;for(const v of hist)sum+=v;
 if(sum>0)for(let k=0;k<4;k++)hist[k]/=sum;
 return hist;
}

function softExpand(mask,w,h){
 const out=new Float32Array(mask.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let v=mask[y*w+x];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const xx=x+dx,yy=y+dy;
   if(xx<0||xx>=w||yy<0||yy>=h)continue;
   v=Math.max(v,mask[yy*w+xx]*(dx&&dy?.58:.78));
  }
  out[y*w+x]=v;
 }
 return out;
}
function strokeComplexity(mask,w,h){
 let ink=0,components=0;
 for(const v of mask)ink+=v;
 const visited=new Uint8Array(mask.length),stack=[];
 for(let k=0;k<mask.length;k++){
  if(mask[k]<.32||visited[k])continue;
  components++;stack.push(k);visited[k]=1;
  while(stack.length){
   const i=stack.pop(),x=i%w,y=Math.floor(i/w);
   for(const j of [x>0?i-1:-1,x+1<w?i+1:-1,y>0?i-w:-1,y+1<h?i+w:-1]){
    if(j>=0&&!visited[j]&&mask[j]>=.32){visited[j]=1;stack.push(j);}
   }
  }
 }
 return Math.min(.055,Math.max(0,ink/(w*h)-.145)*.13+Math.max(0,components-1)*.005);
}
function glyphPorts(mask,w,h){
 const left=new Float32Array(h),right=new Float32Array(h);
 const top=new Float32Array(w),bottom=new Float32Array(w);
 const maxSide=(start,step,count)=>{
  let v=0;
  for(let k=0;k<Math.min(3,count);k++){
   const weight=k===0?1:k===1?.85:.58;
   v=Math.max(v,mask[start+k*step]*weight);
  }
  return v;
 };
 for(let y=0;y<h;y++){
  left[y]=maxSide(y*w,1,w);
  right[y]=maxSide((y+1)*w-1,-1,w);
 }
 for(let x=0;x<w;x++){
  top[x]=maxSide(x,w,h);
  bottom[x]=maxSide((h-1)*w+x,-w,h);
 }
 return {left,right,top,bottom};
}
// Drawing shapes and lightweight radicals are more useful for line art than
// readable text. Every one of the user's 272 characters remains permitted:
// these are relative aesthetic weights, never a hidden character exclusion.
const LINE_PARTS=new Set([...(
 '／＼～⌒∩∪∧∨（）［］〈〉＋－×＝＜＞∟⊿' +
 '─│┌┐└┘├┬┤┴┼￣＿ー―‐┘└' +
 'ＪＬＶＷＸＺｖｗｘｚ' +
 '∴∵≫≪∈∋⊂⊃∇∠⊥・：' +
 'ノハヘメミリルレロヮンイエチトニ' +
 '人川入八凵凹凸冂冖冫厂厶丿丶乂个彡彳廴廾'
)]);
// Array is indexed by its true CP932 half-column footprint, not string length.
export function makeArtisanGeometry(atlas,sample){
 if(!Array.isArray(atlas)||atlas.length<2)throw Error('モード4の文字パレットがありません');
 return atlas.map(g=>{
  const cols=g.columns,w=sample*cols,h=sample;
  if(![1,2].includes(cols)||g.mask.length!==w*h)throw Error('モード4の字形サイズが不正です');
  const mask=Float32Array.from(g.mask);
  return {char:g.char,columns:cols,mask,
   expanded:softExpand(mask,w,h),
   orientation:strokeHistogram(mask,w,h),
   detailPenalty:strokeComplexity(mask,w,h),
   shapeSymbol:LINE_PARTS.has(g.char),
   ports:glyphPorts(mask,w,h)};
 });
}
export function portMismatch(a,b,offset=0,length=a.length,expected=null){
 // Reciprocal closest-port match tolerates a one-pixel glyph alignment error.
 let error=0;
 const end=offset+length;
 for(let i=0;i<length;i++){
  const q=offset+i;
  const av=a[i],bv=b[q];
  let nearB=bv,nearA=av;
  if(q>offset)nearB=Math.max(nearB,b[q-1]*.73);
  if(q+1<end)nearB=Math.max(nearB,b[q+1]*.73);
  if(i>0)nearA=Math.max(nearA,a[i-1]*.73);
  if(i+1<length)nearA=Math.max(nearA,a[i+1]*.73);
  error+=Math.max(0,av-nearB)+Math.max(0,bv-nearA);
  if(expected){
   // A source line crossing the cell boundary must remain connected in AA.
   // Two blank ports are NOT a valid match when the reference wants a line.
   error+=1.75*expected[q]*(1-Math.min(nearA,nearB));
  }
 }
 return error/(2*Math.max(1,length));
}
export function verticalSeamCost(top,bottom,sample,width){
 let sum=0;
 for(let i=0;i<width*sample;i+=sample){
  const g=top.subarray(i,i+sample),b=bottom.subarray(i,i+sample);
  sum+=portMismatch(g,b);
 }
 return sum;
}
function placementLoss(field,glyph,x,y,sample,targetHistogram,oldId,oldGray){
 const cols=glyph.columns,S=sample,count=cols*S*S,w=field.w;
 const top=y*S*w+x*S,mask=glyph.mask,expanded=glyph.expanded;
 let sum=0,missing=0,extra=0,direct=0;
 for(let sy=0;sy<S;sy++){
  const row=top+sy*w,mi=sy*cols*S;
  for(let sx=0;sx<cols*S;sx++){
   const k=row+sx,t=field.target[k],m=mask[mi+sx],priority=field.importance?.[k]||1;
   sum+=t*priority;
   missing+=priority*t*(1-expanded[mi+sx]);
   extra+=Math.min(1.9,priority)*m*Math.min(1,field.dist[k]/2.4);
   direct+=priority*(t-m)*(t-m);
  }
 }
 const density=sum/count;
 if(glyph.char!==' '&&density<.008)return Infinity;
 // Chamfer-like near-stroke matching (position tolerance), symmetric
 // coverage, actual raster overlap, and orientation of local contours.
 let score=(1.85*missing+.62*extra+.19*direct)/count;
 if(glyph.char!==' '&&sum>.5){
  const gh=glyph.orientation;
  let orientationError=0;
  for(let i=0;i<4;i++)orientationError+=Math.abs(gh[i]-targetHistogram[i]);
  score+=.038*Math.min(1,density*13)*orientationError;
 }
 if(glyph.char!==' '){
  score+=.0025+glyph.detailPenalty;
  if(!glyph.shapeSymbol && Array.isArray(field.faces) && field.faces.length){
   // Text-like glyphs still remain possible when their geometry is genuinely
   // needed, but simple lines dominate a face's eyes, mouth and contour.
   const cx=(x+cols*.5)/field.columnCount,cy=(y+.5)/field.rowCount;
   for(const face of field.faces){
    if(cx>=face.x-face.w*.15&&cx<=face.x+face.w*1.15&&
       cy>=face.y-face.h*.2&&cy<=face.y+face.h*1.25){
      score+=.07;
      break;
    }
   }
  }
 }
 // Preserve a stationary glyph only if the image is not a hard scene cut.
 // Source-derived blank decisions always take precedence over history.
 if(!field.cut&&oldGray&&oldId===glyph.char){
  let drift=0;
  for(let sy=0;sy<S;sy++){
   const row=top+sy*w;
   for(let sx=0;sx<cols*S;sx++)drift+=Math.abs(field.gray[row+sx]-oldGray[row+sx]);
  }
  if(drift/count<.065&&density>.025)score-=.004;
 }
 return Math.max(0,score);
}
function insertTop(arr,j,score,limit){
 if(!Number.isFinite(score))return;
 if(arr.length>=limit&&score>=arr[arr.length-1].score)return;
 let i=arr.length;
 while(i>0&&arr[i-1].score>score)i--;
 arr.splice(i,0,{j,score});
 if(arr.length>limit)arr.pop();
}
export function localCellOrientation(field,width,height,S){
 const out=new Float32Array(width*height*8);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const offset=(y*width+x)*8,start=(y*S)*field.w+x*S;
  out.set(strokeHistogram(field.target,S,S,start,field.w),offset);
  if(x+1<width)out.set(strokeHistogram(field.target,S*2,S,start,field.w),offset+4);
 }
 return out;
}
export function makeCandidates(field,atlas,width,height,S,prevChars,oldGray,gpuScores=null,orientations=null){
 const n=atlas.length,candidates=new Array(width*height),unary=new Float32Array(width*height*n);
 unary.fill(Infinity);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const pos=y*width+x,offset=pos*n;
  const best1=[],best2=[];
  // GPU scores already include tangent orientation. Avoid redundantly
  // tracing the same geometry on CPU when rendering the GPU result.
  const hist1=gpuScores?null:orientations?orientations.subarray(pos*8,pos*8+4):
   strokeHistogram(field.target,S,S,(y*S)*field.w+x*S,field.w);
  const hist2=x+1<width?(gpuScores?null:orientations?orientations.subarray(pos*8+4,pos*8+8):
   strokeHistogram(field.target,2*S,S,(y*S)*field.w+x*S,field.w)):null;
  let prevIndex=-1;
  for(let j=0;j<n;j++){
   const g=atlas[j];if(x+g.columns>width)continue;
   const gScore=gpuScores?.[offset+j];
   const score=gpuScores?(gScore>=1e18?Infinity:gScore):
    placementLoss(field,g,x,y,S,g.columns===1?hist1:hist2,
    prevChars?.[pos],oldGray);
   unary[offset+j]=score;
   insertTop(g.columns===1?best1:best2,j,score,g.columns===1?14:24);
   if(g.char===prevChars?.[pos]&&Number.isFinite(score))prevIndex=j;
  }
  const merged=[...best1,...best2].map(e=>e.j);
  if(prevIndex>=0&&!merged.includes(prevIndex))merged.push(prevIndex);
  // A one-column space guarantees a path for every row even on flat input.
  if(!merged.includes(0))merged.push(0);
  candidates[pos]=merged;
 }
 return {unary,candidates};
}
// Reference-crossing seam ports: require the generated text lines to join
// where the source contours actually continue across half-column / row edges.
export function sourceSeams(field,width,height,S){
 const horiz=new Float32Array(height*(width+1)*S);
 const vert=new Float32Array((height+1)*width*S);
 const w=width*S,t=field.target;
 for(let y=0;y<height;y++)for(let x=1;x<width;x++)for(let py=0;py<S;py++){
  const k=(y*S+py)*w+x*S;
  const a=Math.max(t[k-1],t[k-2]*.7);
  const b=Math.max(t[k],t[k+1]*.7);
  horiz[(y*(width+1)+x)*S+py]=Math.min(a,b);
 }
 for(let y=1;y<height;y++)for(let x=0;x<w;x++){
  const k=y*S*w+x;
  const a=Math.max(t[k-w],t[k-2*w]*.7);
  const b=Math.max(t[k],t[k+w]*.7);
  vert[y*w+x]=Math.min(a,b);
 }
 return {horiz,vert};
}
const HORIZONTAL_WEIGHT=.23,VERTICAL_WEIGHT=.33;
function portStrip(row,atlas,width,S,side){
 if(!row)return null;
 const out=new Float32Array(width*S);
 for(const {x,j} of row){
  const p=atlas[j].ports[side];
  out.set(p,x*S);
 }
 return out;
}

function solveRow(y,rows,atlas,width,S,unary,candidates,seams){
 const above=portStrip(rows[y-1],atlas,width,S,'bottom');
 const below=portStrip(rows[y+1],atlas,width,S,'top');
 const aExpected=seams.vert.subarray(y*width*S,(y+1)*width*S);
 const bExpected=seams.vert.subarray((y+1)*width*S,(y+2)*width*S);
 const n=atlas.length,states=Array.from({length:width+1},()=>[]);
 states[0].push({x:-1,j:-1,score:0,prev:null});
 for(let x=0;x<width;x++){
  const previous=states[x];if(!previous.length)continue;
  const start=(y*width+x),offset=start*n;
  const hExpected=seams.horiz.subarray((y*(width+1)+x)*S,(y*(width+1)+x+1)*S);
  for(const j of candidates[start]){
   const glyph=atlas[j],cols=glyph.columns;if(x+cols>width)continue;
   const local=unary[offset+j];if(!Number.isFinite(local))continue;
   let base=local*cols;
   if(above)base+=VERTICAL_WEIGHT*cols*
    portMismatch(glyph.ports.top,above,x*S,cols*S,aExpected);
   if(below)base+=VERTICAL_WEIGHT*cols*
    portMismatch(glyph.ports.bottom,below,x*S,cols*S,bExpected);
   let best=null,bestScore=Infinity;
   for(const prior of previous){
    const join=prior.j>=0
     ?HORIZONTAL_WEIGHT*portMismatch(atlas[prior.j].ports.right,glyph.ports.left,0,S,hExpected):0;
    const score=prior.score+base+join;
    if(score<bestScore){bestScore=score;best=prior;}
   }
   if(best)states[x+cols].push({x,j,score:bestScore,prev:best});
  }
 }
 const last=states[width];
 if(!last.length)throw Error('モード4の文字組版に失敗しました');
 let chosen=last[0];
 for(const p of last)if(p.score<chosen.score)chosen=p;
 const out=[];
 for(let p=chosen;p&&p.j>=0;p=p.prev)out.push({x:p.x,j:p.j});
 out.reverse();
 return out;
}
export function measureArtisanLayout(rows,atlas,unary,width,S,seams){
 const height=rows.length,n=atlas.length;
 let unaryEnergy=0,horizontal=0,vertical=0;
 for(let y=0;y<height;y++){
  let previous=null;
  for(const p of rows[y]){
   const g=atlas[p.j];
   unaryEnergy+=unary[(y*width+p.x)*n+p.j]*g.columns;
   if(previous){
    const expect=seams.horiz.subarray((y*(width+1)+p.x)*S,(y*(width+1)+p.x+1)*S);
    horizontal+=portMismatch(previous.ports.right,g.ports.left,0,S,expect);
   }
   previous=g;
  }
  if(y>0){
   const above=portStrip(rows[y-1],atlas,width,S,'bottom');
   for(const p of rows[y]){
    const g=atlas[p.j];
    const expected=seams.vert.subarray(y*width*S,(y+1)*width*S);
    vertical+=g.columns*portMismatch(g.ports.top,above,p.x*S,g.columns*S,expected);
   }
  }
 }
 return {
  unary:unaryEnergy,horizontal,vertical,
  total:unaryEnergy+HORIZONTAL_WEIGHT*horizontal+VERTICAL_WEIGHT*vertical
 };
}
export class ArtisanComposer {
 constructor(atlas,sample=10){
  if(!Number.isInteger(sample)||sample<4||sample>10)throw Error('モード4の標本数が不正です');
  this.sample=sample;
  this.atlas=makeArtisanGeometry(atlas,sample);
  if(this.atlas[0].char!==' '||!this.atlas.some(x=>x.char==='／'))
   throw Error('モード4の必須字形が欠落しています');
  this.previousGray=null;this.previousChars=null;
  this.width=0;this.height=0;this.lastDiagnostics=null;
  this.lastFrame=null;this.lastSemanticKey=null;
  this.gpuMatcher=null;this.directComputeMatcher=null;this.exactMatcher=null;
  this.nativeGpuInfo=null;this.acceleration='CPU';this.fullGpuLayout=null;this.nativeContour=null;
  this.lastPerf=null;this.gpuError=null;
 }
 snapshot(){
  if(!this.previousGray)return null;
  return {format:2,sample:this.sample,width:this.width,height:this.height,
   gray:this.previousGray,chars:this.previousChars,
   frame:this.lastFrame,semanticKey:this.lastSemanticKey};
 }
 restore(state){
  if(!state)return;
  if(state.format!==2||state.sample!==this.sample||
    !Number.isInteger(state.width)||state.width<4||
    !Number.isInteger(state.height)||state.height<4||
    !(state.gray instanceof Float32Array)||
    state.gray.length!==state.width*state.height*this.sample*this.sample||
    !Array.isArray(state.chars)||state.chars.length!==state.width*state.height)
   throw Error('モード4の途中保存データが不正です');
  this.width=state.width;this.height=state.height;
  this.previousGray=state.gray;this.previousChars=state.chars;
  this.lastFrame=typeof state.frame==='string'?state.frame:null;
  this.lastSemanticKey=typeof state.semanticKey==='string'?state.semanticKey:null;
 }
 enableExactNative(){
  this.exactMatcher=new Mode4ExactNativeMatcher();
  this.acceleration='PC Native Exact';
 }
 async enablePCBoost(width,height){
  // Windows PC Boost must NEVER depend on WebGPU. The compute work runs in
  // native Direct3D 11 via mode4_directcompute.exe (actual hardware only).
  this.nativeFallbackAvailable=true;
  try{
   const response=await fetch('/health',{cache:'no-store'});
   if(!response.ok)throw Error('PCネイティブGPUの状態を取得できません');
   const health=await response.json();
   if(health.nativeContour)this.nativeContour=new NativeContour(!!health.layoutSoftware);
   if(health.nativeLayout){this.fullGpuLayout=new FullGpuNativeLayout(!!health.layoutSoftware);}
   if(!health.nativeGpu&&!health.nativeLayout)
    throw Error(health.gpuReason||'DirectCompute対応GPUが見つかりません');
   this.directComputeMatcher=new Mode4ExactNativeMatcher('/api/mode4/gpu-score');
   this.nativeGpuInfo={name:health.layoutName||health.gpuName||'DirectCompute GPU',
    identified:true,architecture:'Direct3D 11',software:!!health.layoutSoftware};
   this.acceleration='DirectCompute';
  }catch(e){
   this.gpuError=String(e);
   this.directComputeMatcher=null;
   this.enableExactNative(); // exact original formula on C++ CPU
  }
 }
 async enableWebGPU(width,height){
  try{
   this.gpuMatcher=await Mode4GpuMatcher.create(this.atlas,this.sample,width,height);
   this.acceleration=this.gpuMatcher?'WebGPU':'CPU';
  }catch(e){
   this.gpuError=String(e);
   this.gpuMatcher?.dispose();this.gpuMatcher=null;this.acceleration='CPU';
  }
 }
 convert(pixels,width,height,options={}){
  const start=performance.now();
  const prepared=this._prepare(pixels,width,height,options);
  const prepMs=performance.now()-start;
  if(prepared.cached){
   this.lastPerf={prepareMs:prepMs,gpuMs:0,layoutMs:0,reused:true};
   return prepared.cached;
  }
  this.acceleration='CPU';
  const layoutStart=performance.now();
  const output=this._render(prepared,null,null);
  this.lastPerf={prepareMs:prepMs,gpuMs:0,layoutMs:performance.now()-layoutStart};
  return output;
 }
 async convertAccelerated(pixels,width,height,options={}){
  const start=performance.now();
  const prepared=this.nativeContour?await this._prepareGpu(pixels,width,height,options):this._prepare(pixels,width,height,options);
  const prepMs=performance.now()-start;
  if(prepared.cached){
   this.lastPerf={prepareMs:prepMs,gpuMs:0,layoutMs:0,reused:true};
   return prepared.cached;
  }
  const {field,width:w,height:h,S,oldChars,oldGray}=prepared;
  if(this.fullGpuLayout){
   try{
    const result=await this.fullGpuLayout.compose(prepared,this.atlas);
    this.width=w;this.height=h;this.previousGray=field.gray;this.previousChars=result.chars;
    this.lastFrame=result.frame;this.lastSemanticKey=prepared.semanticKey;
    this.lastDiagnostics={...result.diagnostics,cellCount:w*h,faceGuides:prepared.structural.faceGuides,
     connectedComponents:prepared.structural.components.length,skeletonStrokes:prepared.structural.strokes.length,
     semanticRegions:prepared.structural.regions.map(r=>r.kind)};
    this.acceleration=result.perf.software?'WARP Test Global':'DirectCompute Global';
    this.lastPerf={prepareMs:prepMs,contourStages:this.nativeContour?.timings||null,...result.perf,gpuMs:result.perf.matchingGpuMs,
     layoutMs:result.perf.rowLayoutGpuMs+result.perf.bandLayoutGpuMs+result.perf.criticGpuMs};
    return result.frame;
   }catch(e){this.gpuError=String(e);this.fullGpuLayout=null;}
  }
  let gpuScores=null,gpuMs=0;
  if(this.directComputeMatcher){
   const nativeGpuStart=performance.now();
   try{
    // Real Windows native D3D11 Compute Shader, NO WebGPU. Keep all original
    // Mode 4 field extraction, recognition, seams and 2D composition in JS.
    const orientation=localCellOrientation(field,w,h,S);
    const scores=await this.directComputeMatcher.compute(
     field,this.atlas,w,h,S,oldChars,oldGray,orientation);
    const n=this.atlas.length,cells=w*h;
    let samples=0,bad=0;
    for(let k=0;k<Math.min(128,cells*n);k++){
     const pos=(k*1543)%cells,j=(k*137)%n,x=pos%w,y=Math.floor(pos/w);
     const glyph=this.atlas[j];
     if(x+glyph.columns>w)continue;
     const hist=orientation.subarray(pos*8+(glyph.columns===2?4:0),
      pos*8+(glyph.columns===2?8:4));
     const reference=placementLoss(field,glyph,x,y,S,hist,oldChars?.[pos],oldGray);
     const score=scores[pos*n+j];
     samples++;
     if(!Number.isFinite(reference)){
      if(!Number.isFinite(score)||score<1e18)bad++;
     }else if(!Number.isFinite(score)||score<0||score>=1e18||
        Math.abs(reference-score)>Math.max(.14,.65*Math.abs(reference)))bad++;
    }
    if(samples===0||bad>Math.max(5,Math.ceil(samples*.15)))
     throw Error('DirectCompute文字照合の品質検査で異常: '+bad+'/'+samples);
    gpuScores=scores;
    this.acceleration='DirectCompute';
   }catch(e){
    this.gpuError=String(e);
    this.directComputeMatcher=null;
    this.nativeGpuInfo=null;
    if(!this.exactMatcher)this.enableExactNative();
   }
   gpuMs+=performance.now()-nativeGpuStart;
  }
  if(this.gpuMatcher&&!gpuScores){
   const gpuStart=performance.now();
   try{
    const scores=await this.gpuMatcher.compute(field,oldChars,oldGray);
    // A GPU's float32 arithmetic may legitimately choose different glyphs
    // from JS float64. Reject broken scores, NOT normal precision differences.
    // Keep the original semantic contour and global 2D composition stages.
    const n=this.atlas.length,cells=w*h;
    let checked=0,severelyWrong=0;
    for(let k=0;k<Math.min(128,cells*n);k++){
     const pos=(k*1543)%cells,j=(k*137)%n,x=pos%w,y=Math.floor(pos/w);
     const glyph=this.atlas[j];
     if(x+glyph.columns>w)continue;
     const hist=strokeHistogram(field.target,glyph.columns*S,S,
      (y*S)*field.w+x*S,field.w);
     const cpu=placementLoss(field,glyph,x,y,S,hist,oldChars?.[pos],oldGray);
     const gpu=scores[pos*n+j];
     checked++;
     if(!Number.isFinite(cpu)){
      if(!Number.isFinite(gpu)||gpu<1e18)severelyWrong++;
     }else if(!Number.isFinite(gpu)||gpu<0||gpu>=1e18||
        Math.abs(cpu-gpu)>Math.max(.14,.65*Math.abs(cpu))){
      severelyWrong++;
     }
    }
    if(checked===0||severelyWrong>Math.max(5,Math.ceil(checked*.15)))
     throw Error('GPU文字照合が元の輪郭評価から大幅に逸脱しました: '+severelyWrong+'/'+checked);
    gpuScores=scores;
    this.acceleration='WebGPU';
   }catch(e){
    this.gpuError=String(e);
    this.gpuMatcher?.dispose();this.gpuMatcher=null;
    if(this.nativeFallbackAvailable&&!this.exactMatcher)this.enableExactNative();
   }
   gpuMs+=performance.now()-gpuStart;
  }
  if(this.exactMatcher&&!gpuScores){
   const nativeStart=performance.now();
   try{
    // Native C++ keeps the original formula and uses float64 scores.
    const orientation=localCellOrientation(field,w,h,S);
    const scores=await this.exactMatcher.compute(field,this.atlas,w,h,S,oldChars,oldGray,orientation);
    const n=this.atlas.length,cells=w*h;
    for(let k=0;k<Math.min(160,cells*n);k++){
     const pos=(k*1543)%cells,j=(k*137)%n,x=pos%w,y=Math.floor(pos/w);
     const glyph=this.atlas[j];
     if(x+glyph.columns>w)continue;
     const hist=orientation.subarray(pos*8+(glyph.columns===2?4:0),
      pos*8+(glyph.columns===2?8:4));
     const expected=placementLoss(field,glyph,x,y,S,hist,oldChars?.[pos],oldGray);
     const actual=scores[pos*n+j];
     if(!Number.isFinite(expected)?actual!==Infinity:!Number.isFinite(actual)||
        Math.abs(expected-actual)>1e-9)
      throw Error('Native C++ scoring did not match original Mode 4');
    }
    gpuScores=scores;
    this.acceleration='PC Native Exact';
   }catch(e){
    // Neither the GPU nor C++ may silently substitute a different algorithm.
    this.gpuError=String(e);
    this.exactMatcher=null;
   }
   gpuMs+=performance.now()-nativeStart;
  }
  if(!gpuScores)this.acceleration='CPU';
  const layoutStart=performance.now();
  const output=this._render(prepared,gpuScores,null);
  this.lastPerf={prepareMs:prepMs,gpuMs,layoutMs:performance.now()-layoutStart,
   gpuValidated:!!gpuScores};
  return output;
 }
 async _prepareGpu(pixels,width,height,options){
  const S=this.sample,old=this.previousGray?.length===width*height*S*S?this.previousGray:null;
  try{
   const field=await this.nativeContour.run(1,width*S,height*S,pixels,options);
   let change=0,count=0;
   if(old){const step=Math.max(1,Math.floor(field.gray.length/2500));
    for(let i=0;i<field.gray.length;i+=step){change+=Math.abs(field.gray[i]-old[i]);count++;}}
   field.cut=count>0&&change/count>.18;
   const structure=await this.nativeContour.run(4,field.w,field.h,field.target,options);
   const guided=await this.nativeContour.faces(field,structure,options.semantic);
   guided.dist=await this.nativeContour.run(2,field.w,field.h,guided.target);
   return this._prepare(pixels,width,height,options,field,guided);
  }catch(e){this.gpuError=String(e);this.nativeContour=null;return this._prepare(pixels,width,height,options);}
 }
 _prepare(pixels,width,height,options={},nativeField=null,nativeStructural=null){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<4||height<4)
   throw Error('モード4の画像サイズが不正です');
  const S=this.sample,oldGray=this.previousGray?.length===width*height*S*S
   ?this.previousGray:null;
  const field=nativeField||artisanContourField(pixels,width,height,S,options,oldGray);
  const semanticKey=JSON.stringify((options.semantic||[]).map(r=>[
   r.kind,Math.round(r.x*200),Math.round(r.y*200),
   Math.round(r.w*200),Math.round(r.h*200)]));
  // Still/motionless frames are common in manga and animation. Verify all
  // source pixels before reusing the prior AA: never drop moving details.
  if(oldGray&&!field.cut&&this.lastFrame&&semanticKey===this.lastSemanticKey){
   let identical=true;
   for(let i=0;i<field.gray.length;i++){
    if(Math.abs(field.gray[i]-oldGray[i])>.0005){identical=false;break;}
   }
   if(identical){
    this.lastDiagnostics={...this.lastDiagnostics,reused:true};
    return {cached:this.lastFrame};
   }
  }
  const rawStructure=nativeStructural||parseArtisanStructure(field,options.semantic);
  const structural=nativeStructural||guideArtisanFaces(field,rawStructure,options.semantic);
  field.target=structural.target;
  field.importance=structural.importance;
  field.dist=nativeStructural?.dist||contourDistance(field.target,field.w,field.h);
  field.faces=(options.semantic||[]).filter(x=>x.kind==='face'&&x.confidence>=.6);
  field.columnCount=width;field.rowCount=height;
  const oldChars=this.width===width&&this.height===height&&!field.cut
   ?this.previousChars:null;
  return {width,height,S,field,oldChars,oldGray,semanticKey,structural};
 }
 _render(prepared,gpuScores,orientations){
  const {width,height,S,field,oldChars,oldGray,semanticKey}=prepared;
  const structural=prepared.structural||null;
  const {unary,candidates}=makeCandidates(field,this.atlas,width,height,S,oldChars,oldGray,gpuScores,orientations);
  const seams=sourceSeams(field,width,height,S);
  const rows=new Array(height);
  // Initial layout: data-driven row arrangement without vertical couplings.
  for(let y=0;y<height;y++)rows[y]=solveRow(y,rows,this.atlas,width,S,unary,candidates,seams);
  const initial=measureArtisanLayout(rows,this.atlas,unary,width,S,seams);
  // Coordinate-descent reflow across the WHOLE image; every row is recomputed
  // against both its neighbours. Greedy per-cell matching cannot do this.
  const large=width*height>3000;
  const sweeps=large?2:5;
  let passes=0;
  for(let pass=0;pass<sweeps;pass++){
   if(pass%2===0){
    for(let y=0;y<height;y++)rows[y]=solveRow(y,rows,this.atlas,width,S,unary,candidates,seams);
   }else{
    for(let y=height-1;y>=0;y--)rows[y]=solveRow(y,rows,this.atlas,width,S,unary,candidates,seams);
   }
   passes++;
  }
  // Jointly compose TWO complete adjacent rows at a time with a single
  // coupled beam search. Unlike row reflow, this evaluates motif pairs while
  // choosing them. Accept a block only if the FULL-FRAME objective improves.
  let current=measureArtisanLayout(rows,this.atlas,unary,width,S,seams);
  let blockAttempts=0,blockAccepted=0;
  const big=width*height>3000;
  const rounds=big?1:3;
  for(let round=0;round<rounds;round++){
   for(let parity=0;parity<2;parity++){
    for(let y=parity;y+1<height;y+=2){
     const previousTop=rows[y],previousBottom=rows[y+1];
     const proposed=composeArtisanBand(rows,y,this.atlas,width,S,unary,candidates,seams,
      {beamWidth:big?7:14,maxOptions:big?7:12});
     blockAttempts++;
     rows[y]=proposed[0];rows[y+1]=proposed[1];
     const result=measureArtisanLayout(rows,this.atlas,unary,width,S,seams);
     if(result.total+1e-5<current.total){
      current=result;blockAccepted++;
     }else{
      rows[y]=previousTop;rows[y+1]=previousBottom;
     }
    }
   }
  }
  // Render candidate AA to a single composited bitmap. This independent
  // all-frame critic evaluates glyph ink outside the subject, lost important
  // contours, and drawing continuity. 2x2-block changes are accepted ONLY
  // when this actual rendered global score gets better.
  const critique=refineArtisanLayout(rows,this.atlas,width,S,unary,candidates,seams,
   field,measureArtisanLayout,{
    maxTiles:width*height>3000?16:width*height>1000?28:36,
    limit:width*height>3000?7:10
   });
  const final=measureArtisanLayout(rows,this.atlas,unary,width,S,seams);
  this.width=width;this.height=height;this.previousGray=field.gray;
  this.previousChars=new Array(width*height).fill(null);
  const lines=[];
  for(let y=0;y<height;y++){
   let line='';
   for(const p of rows[y]){
    const glyph=this.atlas[p.j];
    line+=glyph.char;
    this.previousChars[y*width+p.x]=glyph.char;
    for(let dx=1;dx<glyph.columns;dx++)this.previousChars[y*width+p.x+dx]='\0';
   }
   lines.push(line);
  }
  this.lastDiagnostics={initial,final,passes,blockAttempts,blockAccepted,
   critique,faceGuides:structural.faceGuides,
   connectedComponents:structural.components.length,
   skeletonStrokes:structural.strokes.length,
   endpoints:structural.endpoints.length,junctions:structural.junctions.length,
   semanticRegions:structural.regions.map(r=>r.kind),
   cellCount:width*height,used:new Set([...lines.join('')].filter(c=>c!==' ')).size};
  this.lastFrame=lines.join('\r\n')+'\r\n';
  this.lastSemanticKey=semanticKey;
  return this.lastFrame;
 }
}
