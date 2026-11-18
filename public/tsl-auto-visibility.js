import {halftoneIndex} from './tsl-halftone.js';
// Auto-settings only. Never imported by the ordinary conversion hot path.
// Scores the actual selected glyphs against a fixed, unadjusted source reference.
export const AUTO_LIMITS=Object.freeze({primary:40,candidates:6,scenes:5});
const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
export const neutralTone=()=>({brightness:0,contrast:1,gamma:1});
const adjustment=s=>Math.abs(s.brightness)/100+Math.abs(s.contrast-1)*.25+Math.abs(s.gamma-1)*.25;
const tone=(v,s)=>Math.pow(clamp((v-.5)*s.contrast+.5+s.brightness/100),s.gamma);
export function quantile(values,p){
 if(!values.length)return 0;const a=Array.from(values).sort((a,b)=>a-b);return a[Math.floor((a.length-1)*p)];
}
export function robustScore(scores){
 const a=[...scores].sort((a,b)=>a-b);
 return .50*mean(a)+.30*mean(a.slice(0,Math.max(1,Math.ceil(a.length/3))))+.20*a[0];
}
function box(a,w,h){
 const b=new Float32Array(a.length),c=new Float32Array(a.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)b[y*w+x]=(a[y*w+Math.max(0,x-1)]+2*a[y*w+x]+a[y*w+Math.min(w-1,x+1)])*.25;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)c[y*w+x]=(b[Math.max(0,y-1)*w+x]+2*b[y*w+x]+b[Math.min(h-1,y+1)*w+x])*.25;
 return c;
}
export function sampleSource(pixels,pw,ph,w,h){
 if(pixels.length!==pw*ph*4||w<1||h<1)throw Error('解析画像サイズが不正です');
 const gray=new Float32Array(w*h),rgb=[0,1,2].map(()=>new Float32Array(w*h));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const x0=Math.floor(x*pw/w),x1=Math.max(x0+1,Math.floor((x+1)*pw/w)),y0=Math.floor(y*ph/h),y1=Math.max(y0+1,Math.floor((y+1)*ph/h));
  let r=0,g=0,b=0,n=0;
  for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){const i=(yy*pw+xx)*4;r+=pixels[i];g+=pixels[i+1];b+=pixels[i+2];n++;}
  const i=y*w+x;rgb[0][i]=r/n/255;rgb[1][i]=g/n/255;rgb[2][i]=b/n/255;gray[i]=(.2126*r+.7152*g+.0722*b)/n/255;
 }
 return {gray,rgb,w,h};
}
// Only persistent, uniform edge strips are excluded. The image and crop are never changed.
export function detectActiveBounds(frames,w,h){
 const uniform=(f,axis,pos)=>{
  const values=[];for(let k=0;k<(axis===0?w:h);k++)values.push(f.gray[axis===0?pos*w+k:k*w+pos]);
  const low=Math.min(...values),high=Math.max(...values);
  return high-low<.025&&(high<.055||low>.945)?mean(values):null;
 };
 const edge=(axis,fromEnd)=>{
  const n=axis===0?h:w,limit=Math.floor(n*.45);let count=0,base=null;
  for(let j=0;j<limit;j++){
   const vals=frames.map(f=>uniform(f,axis,fromEnd?n-1-j:j));
   if(vals.some(v=>v===null)||Math.max(...vals)-Math.min(...vals)>.035)break;
   const value=mean(vals);if(base!==null&&Math.abs(value-base)>.025)break;base??=value;count++;
  }return count>=2?count:0;
 };
 const top=edge(0,false),bottom=edge(0,true),left=edge(1,false),right=edge(1,true);
 return {left:left/w,top:top/h,right:1-right/w,bottom:1-bottom/h};
}
export function activeMask(w,h,bounds={left:0,top:0,right:1,bottom:1}){
 const out=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if((x+.5)/w>=bounds.left&&(x+.5)/w<bounds.right&&(y+.5)/h>=bounds.top&&(y+.5)/h<bounds.bottom)out[y*w+x]=1;
 return out;
}
export function frameStats(frame,bounds){
 const valid=activeMask(frame.w,frame.h,bounds),values=Array.from(frame.gray).filter((v,i)=>valid[i]);
 let detail=0;
 for(let y=1;y<frame.h;y++)for(let x=1;x<frame.w;x++){const i=y*frame.w+x;if(valid[i]&&valid[i-1]&&valid[i-frame.w])detail+=Math.abs(frame.gray[i]-frame.gray[i-1])+Math.abs(frame.gray[i]-frame.gray[i-frame.w]);}
 return {mean:mean(values),p10:quantile(values,.1),p90:quantile(values,.9),detail:detail/Math.max(1,values.length)};
}
// Cheap histogram search supplies one diverse candidate; only the final six
// candidates run through the production AA converters. Unlike the old analyzer,
// Mode 2 uses the actual measured glyph levels in their production direction.
function histogramCandidate(frames,mode,bounds,native16){
 const histograms=frames.map(f=>{const h=new Uint32Array(64),valid=activeMask(f.w,f.h,bounds);for(let i=0;i<f.gray.length;i++)if(valid[i])h[Math.min(63,f.gray[i]*64|0)]++;return h;});
 const entropy=h=>{const n=h.reduce((a,b)=>a+b,0);let e=0;for(const c of h)if(c){const p=c/n;e-=p*Math.log2(p);}return e;};
 const classes=mode==='halftone'?5:16;let best={score:-Infinity,settings:neutralTone()};
 for(let bi=-25;bi<=40;bi+=5)for(let ci=7;ci<=18;ci++)for(let gi=12;gi<=26;gi++){
  const settings={brightness:bi,contrast:ci/10,gamma:gi/20},counts=histograms.map(()=>new Float64Array(classes)),global=new Float64Array(classes);
  for(let bin=0;bin<64;bin++){
   const value=tone((bin+.5)/64,settings),distribution=new Float64Array(classes);
   if(mode==='halftone'){for(let y=0;y<4;y++)for(let x=0;x<4;x++)distribution[halftoneIndex(value,x,y,native16)]+=1/16;}
   else distribution[Math.min(15,value*16|0)]=1;
   for(let j=0;j<histograms.length;j++)if(histograms[j][bin])for(let k=0;k<classes;k++){const n=histograms[j][bin]*distribution[k];counts[j][k]+=n;global[k]+=n;}
  }
  const es=counts.map(entropy),total=global.reduce((a,b)=>a+b,0);
  let score=.48*mean(es)+.52*Math.min(...es)-.0015*(Math.abs(bi)/5+Math.abs(settings.contrast-1)/.1+Math.abs(settings.gamma-1)/.05);
  score-=mode==='halftone'?.8*Math.max(0,(global[0]+global[4])/Math.max(1,total)-.50):.8*Math.max(0,(global[0]+global[15])/Math.max(1,total)-.32);
  if(score>best.score)best={settings,score};
 }
 return best.settings;
}
export function shortlist(frames,mode,bounds,native16=false){
 const candidates=[neutralTone()];
 for(const brightness of [-10,0,10])for(const contrast of [.85,1.1,1.4,1.7])for(const gamma of [.75,1,1.25])candidates.push({brightness,contrast,gamma});
 const all=frames.flatMap(f=>{const mask=activeMask(f.w,f.h,bounds);return Array.from(f.gray).filter((v,i)=>mask[i]);});
 const p10=quantile(all,.1),p90=quantile(all,.9),contrast=clamp(.78/Math.max(.15,p90-p10),.8,1.7);
 candidates.push({brightness:Math.round(clamp((.5-(p10+p90)*.5)*contrast*100,-20,20)/5)*5,contrast:+contrast.toFixed(2),gamma:1});
 const evaluate=s=>frames.map(f=>{
  const valid=activeMask(f.w,f.h,bounds),levels=Float32Array.from(f.gray,v=>tone(v,s)),hist=new Uint32Array(mode==='halftone'?5:16);
  let lost=0,energy=0,clip=0,total=0,contrastGain=0;
  for(let y=0;y<f.h;y++)for(let x=0;x<f.w;x++){
   const i=y*f.w+x;if(!valid[i])continue;const v=levels[i];total++;hist[mode==='halftone'?halftoneIndex(v,x,y,native16):Math.min(hist.length-1,Math.floor(v*hist.length))]++;
   if((v<.005||v>.995)&&f.gray[i]>.025&&f.gray[i]<.975)clip++;
   for(const j of [x?i-1:-1,y?i-f.w:-1])if(j>=0&&valid[j]){
    const original=Math.abs(f.gray[i]-f.gray[j]),delta=Math.abs(v-levels[j]);
    if(original>.025){energy+=original;lost+=Math.max(0,original*.7-delta);contrastGain+=Math.min(original*.5,Math.max(0,delta-original));}
   }
  }
  const edge=1-lost/Math.max(.001,energy),gain=contrastGain/Math.max(.001,energy);
  let entropy=0;for(const n of hist){const p=n/Math.max(1,total);if(p)entropy-=p*Math.log2(p);}
  return (mode==='quality'||mode==='artisan')?edge+.35*gain-.7*clip/Math.max(1,total):edge+.12*entropy/Math.log2(hist.length)-.55*clip/Math.max(1,total);
 });
 const ranked=candidates.map(settings=>({settings,scores:evaluate(settings)})).map(c=>({...c,score:robustScore(c.scores)-.015*adjustment(c.settings)})).sort((a,b)=>b.score-a.score);
 const histogram=histogramCandidate(frames,mode,bounds,native16);
 const selected=[ranked.find(c=>adjustment(c.settings)===0)];
 const mid=(p10+p90)*.5,centerContrast=clamp(Math.min(.78/Math.max(.05,p90-p10),.95/Math.max(.01,Math.abs(mid-.5))),.8,3),centered={brightness:Math.round(clamp((.5-mid)*centerContrast*100,-100,100)/5)*5,contrast:+centerContrast.toFixed(2),gamma:1};
 if(adjustment(histogram)>0){const scores=evaluate(histogram);selected.push({settings:histogram,scores,score:robustScore(scores)});}
 if(adjustment(centered)>0){const scores=evaluate(centered);selected.push({settings:centered,scores,score:robustScore(scores)});}
 for(const c of ranked){
  if(selected.length>=AUTO_LIMITS.candidates)break;
  if(selected.some(a=>Math.abs(a.settings.brightness-c.settings.brightness)/10+Math.abs(a.settings.contrast-c.settings.contrast)/.25+Math.abs(a.settings.gamma-c.settings.gamma)/.2<1.15))continue;
  selected.push(c);
 }
 return {candidates:selected,primaryCount:candidates.length+2,histogramCandidates:2520};
}
export function selectScenes(frames,bounds,count=AUTO_LIMITS.scenes){
 const stats=frames.map(f=>frameStats(f,bounds)),chosen=new Set();
 const sorted=(key)=>stats.map((s,i)=>({v:s[key],i})).sort((a,b)=>a.v-b.v).map(s=>s.i);
 const light=sorted('mean'),detail=sorted('detail');
 chosen.add(light[0]);chosen.add(light.at(-1));chosen.add(detail.at(-1));chosen.add(light[Math.floor(light.length/2)]);
 while(chosen.size<Math.min(count,frames.length)){
  let best=-1,distance=-1;
  for(let i=0;i<frames.length;i++)if(!chosen.has(i)){
   const d=Math.min(...[...chosen].map(j=>Math.abs(stats[i].mean-stats[j].mean)+3*Math.abs(stats[i].detail-stats[j].detail)+.05*Math.abs(i-j)/frames.length));
   if(d>distance){distance=d;best=i;}
  }chosen.add(best);
 }
 return [...chosen].sort((a,b)=>a-b);
}
function components(mask,w,h,min=1){
 const seen=new Uint8Array(mask.length),out=[];
 for(let i=0;i<mask.length;i++)if(mask[i]&&!seen[i]){
  const list=[i];seen[i]=1;
  for(let k=0;k<list.length;k++){const at=list[k],x=at%w,y=at/w|0;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const p=ny*w+nx;
    if(mask[p]&&!seen[p]){seen[p]=1;list.push(p);}
   }
  }if(list.length>=min)out.push(list);
 }return out;
}
export function makeReference(pixels,pw,ph,w,h,bounds,mode){
 const f=sampleSource(pixels,pw,ph,w,h),valid=activeMask(w,h,bounds);
 const channels=(mode==='artisan'?[f.gray]:f.rgb).map(c=>box(box(c,w,h),w,h));
 const mag=new Float32Array(w*h),dirs=new Uint8Array(w*h),nonzero=[];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x;if(!valid[i])continue;let dx=0,dy=0,best=0;
  for(const c of channels){const gx=(c[i+1]-c[i-1])*.5,gy=(c[i+w]-c[i-w])*.5,m=Math.hypot(gx,gy);if(m>best){best=m;dx=gx;dy=gy;}}
  mag[i]=best;if(best>.002)nonzero.push(best);const a=(Math.atan2(dy,dx)*180/Math.PI+180)%180;dirs[i]=a<22.5||a>=157.5?0:a<67.5?1:a<112.5?2:3;
 }
 const high=clamp(quantile(nonzero,.65)*.65,.006,.08),low=high*.45,thin=new Uint8Array(w*h),steps=[1,w+1,w,w-1];
 for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){const i=y*w+x,d=steps[dirs[i]];if(valid[i]&&valid[i-2]&&valid[i+2]&&valid[i-2*w]&&valid[i+2*w]&&mag[i]>=low&&mag[i]>=mag[i-d]&&mag[i]>=mag[i+d])thin[i]=1;}
 const chains=components(thin,w,h,mode==='artisan'?5:4).filter(c=>c.some(i=>mag[i]>=high)),edges=new Uint8Array(w*h);
 for(const c of chains)for(const i of c)edges[i]=1;
 return {...f,valid,edges,chains,mag,high};
}
function dilate(mask,w,h,r=1){
 const a=new Uint8Array(mask.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x])for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<w&&ny<h)a[ny*w+nx]=1;}
 return a;
}
export function scoreContour(reference,ink,occupancy){
 const {w,h,valid,edges,chains}=reference;
 const actual=Uint8Array.from(ink,(v,i)=>+(v>.16&&valid[i])),nearInk=dilate(actual,w,h,1),nearSource=dilate(edges,w,h,2);
 let n=0,matched=0;for(let i=0;i<actual.length;i++)if(actual[i]){n++;matched+=nearSource[i];}
 const precision=n?matched/n:(chains.length?0:1);
 let hits=0,weights=0,continuity=0,chainWeight=0;
 for(const c of chains){
  const importance=Math.sqrt(c.length),covered=c.reduce((s,i)=>s+nearInk[i],0)/c.length;
  hits+=importance*covered;weights+=importance;continuity+=importance*covered*covered;chainWeight+=importance;
 }
 const recall=weights?hits/weights:(n?0:1),connected=chainWeight?continuity/chainWeight:1;
 const f=precision+recall?2*precision*recall/(precision+recall):0;
 const pieces=components(actual,w,h),tiny=pieces.filter(c=>c.length<=2).reduce((s,c)=>s+c.length,0)/Math.max(1,n);
 // False strokes cost more than merely increasing the number of nonblank cells.
 const score=.52*f+.23*recall+.17*connected+.08*precision-.12*tiny;
 return {score,precision,recall,continuity:connected,noise:tiny,occupancy,referenceChains:chains.length};
}
export function scoreTones(reference,levels,classes){
 const {gray,w,h,valid}=reference,hist=new Uint32Array(classes);let total=0,error=0,clip=0,shape=0,weight=0;
 const values=Array.from(gray).filter((v,i)=>valid[i]),lo=quantile(values,.04),hi=quantile(values,.96),span=Math.max(.20,hi-lo);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;if(!valid[i])continue;const a=levels[i],target=clamp((gray[i]-lo)/span);total++;hist[Math.round(a*(classes-1))]++;
  error+=Math.abs(a-target);
  if((a===0&&target>.15)||(a===1&&target<.85))clip++;
  for(const j of [x?i-1:-1,y?i-w:-1])if(j>=0&&valid[j]){
   const d=(gray[i]-gray[j])/span,ad=a-levels[j],v=Math.abs(d);
   if(v>.025){weight+=v;shape+=v*(1-clamp(Math.abs(ad-d)/(v+.08)));}
  }
 }
 let entropy=0;for(const n of hist){const p=n/Math.max(1,total);if(p)entropy-=p*Math.log2(p);}
 const shapeRetention=shape/Math.max(.001,weight),saturation=clip/Math.max(1,total),mae=error/Math.max(1,total),usage=entropy/Math.log2(classes);
 return {score:.55*shapeRetention+.30*(1-mae)+.15*usage-.25*saturation,shapeRetention,saturation,mae,usage,distribution:[...hist],occupancy:1-hist[0]/Math.max(1,total)};
}
export function chooseResult(trials){
 if(!trials.length)throw Error('完成AAの評価結果がありません');
 const neutral=trials.find(c=>adjustment(c.settings)===0)||trials[0];
 const ranked=trials.map(c=>({...c,score:robustScore(c.metrics.map(m=>m.score))-.008*adjustment(c.settings)})).sort((a,b)=>b.score-a.score);
 const neutralScore=robustScore(neutral.metrics.map(m=>m.score));
 // Reject a gain that destroys a sampled scene, or falls inside metric noise.
 const winner=ranked.find(c=>robustScore(c.metrics.map(m=>m.score))>neutralScore+.006&&c.metrics.every((m,i)=>m.score>=neutral.metrics[i].score-.055))||neutral;
 return {...winner,aggregate:robustScore(winner.metrics.map(m=>m.score)),neutralScore};
}
