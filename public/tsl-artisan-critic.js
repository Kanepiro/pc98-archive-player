// Mode 4: render the ENTIRE ASCII composition back into pixels, criticize it
// against important source contours, then refine real 2x2 character blocks.
// Pixel-space evaluation is independent of the per-glyph matching score.
import {contourDistance} from './tsl-artisan-engine.js';
const H=.23,V=.33;
function match(a,b,expected=null){
 let error=0,n=a.length;
 if(n!==b.length)throw Error('AAの文字境界サイズが一致しません');
 for(let i=0;i<n;i++){
  let nearB=b[i],nearA=a[i];
  if(i>0){nearB=Math.max(nearB,b[i-1]*.73);nearA=Math.max(nearA,a[i-1]*.73);}
  if(i+1<n){nearB=Math.max(nearB,b[i+1]*.73);nearA=Math.max(nearA,a[i+1]*.73);}
  error+=Math.max(0,a[i]-nearB)+Math.max(0,b[i]-nearA);
  if(expected)error+=1.75*expected[i]*(1-Math.min(nearA,nearB));
 }
 return error/(Math.max(1,n)*2);
}
function patternWidth(parts,atlas){return parts.reduce((n,p)=>n+atlas[p.j].columns,0);}
function segment(row,x,len,atlas){
 const end=x+len,parts=[];
 for(const p of row){
  const w=atlas[p.j].columns,r=p.x+w;
  if(r<=x||p.x>=end)continue;
  if(p.x<x||r>end)return null;
  parts.push(p);
 }
 return patternWidth(parts,atlas)===len?parts:null;
}
function patternPorts(parts,atlas,S,side){
 const result=new Float32Array(parts.reduce((n,p)=>n+atlas[p.j].columns*S,0));
 let pos=0;
 for(const p of parts){const v=atlas[p.j].ports[side];result.set(v,pos);pos+=v.length;}
 return result;
}
function verticalRowPorts(row,atlas,x,len,S,side){
 const result=new Float32Array(len*S);
 if(!row)return null;
 for(const p of row){
  const cols=atlas[p.j].columns,from=Math.max(x,p.x),to=Math.min(x+len,p.x+cols);
  if(to<=from)continue;
  const g=atlas[p.j].ports[side];
  result.set(g.subarray((from-p.x)*S,(to-p.x)*S),(from-x)*S);
 }
 return result;
}
function atLeft(row,x,atlas){
 for(const p of row)if(p.x+atlas[p.j].columns===x)return p;
 return null;
}
function atRight(row,x,atlas){return row.find(p=>p.x===x)||null;}
function keepBest(target,proposal,max){
 if(!Number.isFinite(proposal.score))return;
 const old=target.findIndex(z=>z.key===proposal.key);
 if(old>=0){if(target[old].score<=proposal.score)return;target.splice(old,1);}
 let i=target.length;
 while(i>0&&target[i-1].score>proposal.score)i--;
 target.splice(i,0,proposal);
 if(target.length>max)target.pop();
}
function choices(y,x,atlas,width,unary,candidates,original,limit=10){
 const n=atlas.length,choices=[],full=[],one=[],next=[];
 for(const j of candidates[y*width+x]){
  const g=atlas[j],score=unary[(y*width+x)*n+j]*g.columns;
  if(!Number.isFinite(score))continue;
  if(g.columns===2)full.push({j,score});
  else if(g.columns===1)one.push({j,score});
 }
 for(const j of candidates[y*width+x+1]){
  const g=atlas[j],score=unary[(y*width+x+1)*n+j];
  if(g.columns===1&&Number.isFinite(score))next.push({j,score});
 }
 full.sort((a,b)=>a.score-b.score);
 one.sort((a,b)=>a.score-b.score);
 next.sort((a,b)=>a.score-b.score);
 for(const a of full.slice(0,Math.max(4,limit-4))){
  keepBest(choices,{key:'f'+a.j,score:a.score,parts:[{x,j:a.j}]},limit);
 }
 for(const a of one.slice(0,4))for(const b of next.slice(0,4)){
  keepBest(choices,{key:'s'+a.j+'-'+b.j,score:a.score+b.score,
   parts:[{x,j:a.j},{x:x+1,j:b.j}]},limit);
 }
 if(original&&original.length){
  const key=original.map(p=>p.j).join(',');
  if(!choices.some(z=>z.parts.map(p=>p.j).join(',')===key)){
   const score=original.reduce((sum,p)=>sum+unary[(y*width+p.x)*n+p.j]*atlas[p.j].columns,0);
   choices.push({key:'old'+key,score,parts:original});
  }
 }
 return choices;
}
export function rasterizeArtisanRows(rows,atlas,width,S){
 const height=rows.length,w=width*S,h=height*S,ink=new Float32Array(w*h);
 for(let y=0;y<height;y++)for(const part of rows[y]){
  const g=atlas[part.j],gw=g.columns*S;
  for(let gy=0;gy<S;gy++){
   const dst=(y*S+gy)*w+part.x*S,src=gy*gw;
   ink.set(g.mask.subarray(src,src+gw),dst);
  }
 }
 return {ink,w,h};
}
export function criticizeArtisanRows(rows,atlas,width,S,unary,seams,field,measure){
 const {ink,w,h}=rasterizeArtisanRows(rows,atlas,width,S);
 const distToInk=contourDistance(ink,w,h);
 let missing=0,extra=0,squared=0,edge=0,drawn=0;
 for(let i=0;i<ink.length;i++){
  const t=field.target[i],g=ink[i],priority=Math.min(3.4,field.importance?.[i]||1);
  missing+=t*priority*Math.min(3,distToInk[i])/3;
  extra+=g*Math.min(3,field.dist[i])/3;
  squared+=priority*(t-g)*(t-g);
  edge+=t*priority;drawn+=g;
 }
 const scale=S*S;
 const layout=measure(rows,atlas,unary,width,S,seams);
 const pixel=(1.6*missing+.80*extra+.32*squared)/scale;
 return {total:.55*layout.total+.78*pixel,layout:layout.total,
  missing:missing/scale,extra:extra/scale,pixel,edge:edge/scale,drawn:drawn/scale};
}
function actualDraw(parts,atlas,x,S,rowCount=1){
 const image=new Float32Array(2*S*S);
 for(const p of parts){
  const g=atlas[p.j],gw=g.columns*S,px=(p.x-x)*S;
  for(let y=0;y<S;y++)image.set(g.mask.subarray(y*gw,(y+1)*gw),y*2*S+px);
 }
 return image;
}
function patchPixel(y,x,parts,atlas,width,S,field){
 const patch=actualDraw(parts,atlas,x,S),W=width*S;
 let cost=0;
 for(let py=0;py<S;py++)for(let px=0;px<2*S;px++){
  const j=(y*S+py)*W+x*S+px;
  const t=field.target[j],p=field.importance?.[j]||1,m=patch[py*2*S+px];
  const d=field.dist[j];
  cost+=p*.47*(t-m)*(t-m)+.25*m*Math.min(3,d)/3;
 }
 return cost/(S*S);
}
function localScore(y,x,top,bottom,rows,atlas,width,S,unary,seams,field){
 const h=rows.length;
 let score=0;
 const patterns=[top,bottom];
 for(let dy=0;dy<2;dy++){
  const yy=y+dy,parts=patterns[dy];
  for(const p of parts)score+=unary[(yy*width+p.x)*atlas.length+p.j]*atlas[p.j].columns;
  score+=.65*patchPixel(yy,x,parts,atlas,width,S,field);
  for(let k=1;k<parts.length;k++){
   const a=atlas[parts[k-1].j],b=atlas[parts[k].j];
   const port=seams.horiz.subarray((yy*(width+1)+x+1)*S,(yy*(width+1)+x+2)*S);
   score+=H*match(a.ports.right,b.ports.left,port);
  }
  const left=atLeft(rows[yy],x,atlas),right=atRight(rows[yy],x+2,atlas);
  if(left){
   const port=seams.horiz.subarray((yy*(width+1)+x)*S,(yy*(width+1)+x+1)*S);
   score+=H*match(atlas[left.j].ports.right,atlas[parts[0].j].ports.left,port);
  }
  if(right){
   const port=seams.horiz.subarray((yy*(width+1)+x+2)*S,(yy*(width+1)+x+3)*S);
   score+=H*match(atlas[parts[parts.length-1].j].ports.right,atlas[right.j].ports.left,port);
  }
 }
 const ta=patternPorts(top,atlas,S,'top'),tb=patternPorts(top,atlas,S,'bottom');
 const ba=patternPorts(bottom,atlas,S,'top'),bb=patternPorts(bottom,atlas,S,'bottom');
 const middle=seams.vert.subarray((y+1)*width*S+x*S,(y+1)*width*S+(x+2)*S);
 score+=V*2*match(tb,ba,middle);
 if(y>0){
  const other=verticalRowPorts(rows[y-1],atlas,x,2,S,'bottom');
  const port=seams.vert.subarray(y*width*S+x*S,y*width*S+(x+2)*S);
  score+=V*2*match(ta,other,port);
 }
 if(y+2<h){
  const other=verticalRowPorts(rows[y+2],atlas,x,2,S,'top');
  const port=seams.vert.subarray((y+2)*width*S+x*S,(y+2)*width*S+(x+2)*S);
  score+=V*2*match(bb,other,port);
 }
 return score;
}
function updateSegment(row,x,parts,atlas){
 const next=row.filter(p=>p.x>=x+2||p.x+atlas[p.j].columns<=x);
 next.push(...parts);
 next.sort((a,b)=>a.x-b.x);
 return next;
}
export function refineArtisanLayout(rows,atlas,width,S,unary,candidates,seams,field,measure,
 {maxTiles=36,limit=10}={}){
 const height=rows.length,stats={tiles:0,accepted:0,rounds:0};
 let critic=criticizeArtisanRows(rows,atlas,width,S,unary,seams,field,measure);
 const before=critic;
 // Enforce a per-frame work budget. In long videos quality improvement should
 // not hang a phone. Revisit the other parity next frame via content motion.
 let budget=maxTiles;
 for(let pass=0;pass<2&&budget>0;pass++){
  for(let y=pass;y+1<height&&budget>0;y+=2){
   for(let x=pass;x+2<=width&&budget>0;x+=2){
    const top=segment(rows[y],x,2,atlas),bottom=segment(rows[y+1],x,2,atlas);
    if(!top||!bottom)continue;
    const optionsTop=choices(y,x,atlas,width,unary,candidates,top,limit);
    const optionsBottom=choices(y+1,x,atlas,width,unary,candidates,bottom,limit);
    let score=localScore(y,x,top,bottom,rows,atlas,width,S,unary,seams,field),pick=null;
    for(const a of optionsTop)for(const b of optionsBottom){
     const value=localScore(y,x,a.parts,b.parts,rows,atlas,width,S,unary,seams,field);
     if(value+.003<score){score=value;pick=[a.parts,b.parts];}
    }
    budget--;stats.tiles++;
    if(!pick)continue;
    const prevTop=rows[y],prevBottom=rows[y+1];
    rows[y]=updateSegment(prevTop,x,pick[0],atlas);
    rows[y+1]=updateSegment(prevBottom,x,pick[1],atlas);
    const revised=criticizeArtisanRows(rows,atlas,width,S,unary,seams,field,measure);
    if(revised.total+0.001<critic.total){critic=revised;stats.accepted++;}
    else{rows[y]=prevTop;rows[y+1]=prevBottom;}
   }
  }
  stats.rounds++;
 }
 return {before,after:critic,...stats};
}
