// Structural parsing for AA: connected boundary components, a thinned graph
// of strokes/junctions, and subject-aware priority on the original pixels.
// The semantic regions come from local on-device MediaPipe inference.
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));

function skeletonize(bits,w,h){
 const data=Uint8Array.from(bits),remove=[];
 // Zhang–Suen thinning retains one-pixel stroke skeletons and junctions.
 for(let pass=0;pass<12;pass++){
  let changed=false;
  for(let stage=0;stage<2;stage++){
   remove.length=0;
   for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const k=y*w+x;if(!data[k])continue;
    const p2=data[k-w],p3=data[k-w+1],p4=data[k+1],p5=data[k+w+1],
     p6=data[k+w],p7=data[k+w-1],p8=data[k-1],p9=data[k-w-1];
    const n=p2+p3+p4+p5+p6+p7+p8+p9;
    if(n<2||n>6)continue;
    const crossings=(!p2&&p3)+(!p3&&p4)+(!p4&&p5)+(!p5&&p6)+
     (!p6&&p7)+(!p7&&p8)+(!p8&&p9)+(!p9&&p2);
    if(crossings!==1)continue;
    if(stage===0?(!p2||!p4||!p6)&&(!p4||!p6||!p8)
     :(!p2||!p4||!p8)&&(!p2||!p6||!p8))remove.push(k);
   }
   for(const k of remove){data[k]=0;changed=true;}
  }
  if(!changed)break;
 }
 return data;
}
export function buildArtisanTopology(field,semantic=[]){
 const {target,w,h}=field,n=w*h;
 if(target.length!==n)throw Error('AAの輪郭データ長が不正です');
 const regions=Array.isArray(semantic)?semantic.filter(r=>
  [r.x,r.y,r.w,r.h,r.importance].every(Number.isFinite)&&r.w>0&&r.h>0).slice(0,8):[];
 const importance=new Float32Array(n),source=Float32Array.from(target);
 const hasFace=regions.some(r=>r.kind==='face');
 const hasSubject=regions.some(r=>['face','person','cat','dog','bird','horse','sheep','cow'].includes(r.kind));
 // Detection increases the priority of real contours; it never masks away
 // other people, hands, body movement or background outside the main face.
 importance.fill(.70);
 const mask=new Uint8Array(n),visited=new Uint8Array(n);
 for(let i=0;i<n;i++)if(source[i]>.22)mask[i]=1;
 // Foreground regions and facial feature landmarks are detected independently
 // of raw pixel complexity. No arbitrary 'skin-colored means face' heuristic.
 for(const r of regions){
  if(hasSubject&&!['face','person','cat','dog','bird','horse','sheep','cow','bear','rabbit'].includes(r.kind))continue;
  const x0=Math.max(0,Math.floor((r.x-.035)*w)),
    x1=Math.min(w,Math.ceil((r.x+r.w+.035)*w)),
    y0=Math.max(0,Math.floor((r.y-.035)*h)),
    y1=Math.min(h,Math.ceil((r.y+r.h+.035)*h));
  const cx=(r.x+r.w*.5)*w,cy=(r.y+r.h*.5)*h;
  const rx=Math.max(2,r.w*w*.7),ry=Math.max(2,r.h*h*.7);
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
   const dx=(x-cx)/rx,dy=(y-cy)/ry,dist=dx*dx+dy*dy;
   const envelope=clamp(1.35-dist);
   const j=y*w+x;
   const base=r.kind==='face'?1.35:r.kind==='person'&&hasFace?.46:.68;
   const boost=r.kind==='face'?2.4:r.kind==='person'&&hasFace?.52:1.35;
   const priority=base+boost*envelope;
   importance[j]=Math.max(importance[j],priority);
  }
  if(r.kind==='face'&&Array.isArray(r.landmarks)){
   const rr=Math.max(2,Math.min(r.w*w,r.h*h)*.095);
   for(const p of r.landmarks){
    const px=p.x*w,py=p.y*h;
    for(let y=Math.max(0,Math.floor(py-rr*2));y<Math.min(h,Math.ceil(py+rr*2));y++)
     for(let x=Math.max(0,Math.floor(px-rr*2));x<Math.min(w,Math.ceil(px+rr*2));x++){
      const d=((x-px)**2+(y-py)**2)/(rr*rr);
      importance[y*w+x]=Math.max(importance[y*w+x],1.25+2.4*Math.exp(-d*.9));
     }
   }
  }
 }
 const components=[],stack=[];
 for(let i=0;i<n;i++){
  if(!mask[i]||visited[i])continue;
  let xmin=w,ymin=h,xmax=0,ymax=0,score=0;
  const nodes=[];
  visited[i]=1;stack.push(i);
  while(stack.length){
   const k=stack.pop(),x=k%w,y=Math.floor(k/w);
   nodes.push(k);score+=importance[k];
   xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);
   ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    if(!dx&&!dy)continue;
    const xx=x+dx,yy=y+dy;
    if(xx<0||xx>=w||yy<0||yy>=h)continue;
    const j=yy*w+xx;
    if(mask[j]&&!visited[j]){visited[j]=1;stack.push(j);}
   }
  }
  const span=Math.max(xmax-xmin,ymax-ymin)+1;
  const priority=score/nodes.length;
  // Major connected contours and important small facial strokes are retained.
  const major=(nodes.length>=Math.max(8,Math.floor(Math.min(w,h)*.085))&&
     span>=Math.max(7,Math.floor(Math.min(w,h)*.058)))
    ||(priority>=2.1&&nodes.length>=3);
  if(!major){
   for(const j of nodes){source[j]=0;mask[j]=0;}
  }else{
   const weight=1+Math.min(.55,span/Math.max(1,Math.min(w,h)*.7));
   for(const j of nodes)importance[j]*=weight;
   components.push({size:nodes.length,span,box:[xmin,ymin,xmax,ymax],
    importance:priority});
  }
 }
 return {mask,source,importance,components,regions};
}
export function finishArtisanTopology(field,topology,skeleton){
 const {w,h}=field,n=w*h;
 const {source,importance,components,regions}=topology;
 const junctions=[],endpoints=[];
 const offsets=[-w,-w+1,1,w+1,w,w-1,-1,-w-1];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x;if(!skeleton[i])continue;
  let degree=0;
  for(const delta of offsets)degree+=skeleton[i+delta];
  if(degree<=1)endpoints.push(i);
  if(degree>=3)junctions.push(i);
  if(degree<=1||degree>=3){
   const bump=degree<=1?1.38:1.45;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const j=i+dy*w+dx;if(j>=0&&j<n)importance[j]=Math.max(importance[j],bump);
   }
  }
 }
 // Structural polylines: follow the skeleton from endpoints/junctions until
 // the next branch or terminal. Used by global and block-level scoring.
 const special=new Set([...junctions,...endpoints]),edges=[],seen=new Set();
 const connectedNeighbors=i=>{
  const x=i%w,y=Math.floor(i/w),out=[];
  for(const [dx,dy] of [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]){
   const nx=x+dx,ny=y+dy;
   if(nx<0||nx>=w||ny<0||ny>=h)continue;
   const j=ny*w+nx;if(skeleton[j])out.push(j);
  }
  return out;
 };
 for(const start of special){
  for(const next of connectedNeighbors(start)){
   const edgeKey=(a,b)=>a<b?a*n+b:b*n+a;
   if(seen.has(edgeKey(start,next)))continue;
   const points=[start],limit=n;let prev=start,curr=next;
   for(let t=0;t<limit;t++){
    seen.add(edgeKey(prev,curr));points.push(curr);
    if(special.has(curr))break;
    const candidates=connectedNeighbors(curr).filter(q=>q!==prev);
    if(!candidates.length)break;
    let best=candidates[0],bestScore=-1e9;
    for(const q of candidates){
     const score=source[q]+importance[q]*.07;
     if(score>bestScore){best=q;bestScore=score;}
    }
    prev=curr;curr=best;
   }
   if(points.length>=3)edges.push({length:points.length,
    from:points[0],to:points[points.length-1],points});
  }
 }
 return {target:source,importance,components,skeleton,
  endpoints,junctions,strokes:edges,regions};
}

export function parseArtisanStructure(field,semantic=[]){
 const topology=buildArtisanTopology(field,semantic);
 return finishArtisanTopology(field,topology,skeletonize(topology.mask,field.w,field.h));
}
