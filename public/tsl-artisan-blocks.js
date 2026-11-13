// True two-row/variable-width block composer for Mode 4.
// A beam over BOTH rows selects glyph pairs together, rather than
// alternating single-row fixes. It respects CP932 1/2-column footprints.
const H=.23,V=.33;
const valid=a=>a&&Number.isFinite(a.score);
function mismatch(a,b,offset=0,length=a.length,expected=null){
 let error=0;const end=offset+length;
 for(let i=0;i<length;i++){
  const q=offset+i,av=a[i],bv=b[q];
  let nb=bv,na=av;
  if(q>offset)nb=Math.max(nb,b[q-1]*.73);
  if(q+1<end)nb=Math.max(nb,b[q+1]*.73);
  if(i>0)na=Math.max(na,a[i-1]*.73);
  if(i+1<length)na=Math.max(na,a[i+1]*.73);
  error+=Math.max(0,av-nb)+Math.max(0,bv-na);
  if(expected)error+=1.75*expected[q]*(1-Math.min(na,nb));
 }
 return error/(2*Math.max(1,length));
}
function ports(row,atlas,width,S,side){
 if(!row)return null;
 const result=new Float32Array(width*S);
 for(const p of row)result.set(atlas[p.j].ports[side],p.x*S);
 return result;
}
function shortlist(candidates,unary,atlas,pos,width,S,limit=12){
 const n=atlas.length,at=pos*n;
 const half=[],full=[];
 for(const j of candidates[pos]){
  const score=unary[at+j],g=atlas[j];
  if(!Number.isFinite(score)||pos%width+g.columns>width)continue;
  (g.columns===1?half:full).push({j,score});
 }
 half.sort((a,b)=>a.score-b.score);full.sort((a,b)=>a.score-b.score);
 const selected=[...half.slice(0,Math.max(3,Math.floor(limit*.38))),
  ...full.slice(0,Math.max(5,Math.ceil(limit*.62)))];
 if(!selected.some(p=>p.j===0))selected.push({j:0,score:unary[at]});
 selected.sort((a,b)=>a.score-b.score);
 return selected;
}
function topState(states,item,max){
 const index=states.findIndex(s=>s.key===item.key);
 if(index>=0){
  if(states[index].score<=item.score)return;
  states.splice(index,1);
 }
 if(states.length>=max&&item.score>=states[states.length-1].score)return;
 let p=states.length;
 while(p>0&&states[p-1].score>item.score)p--;
 states.splice(p,0,item);
 if(states.length>max)states.pop();
}
// Exact joint strip score: horizontal ports on both rows, source-conditioned
// vertical join BETWEEN the rows, and source-conditioned fixed neighbours.
export function composeArtisanBand(rows,y,atlas,width,S,unary,candidates,seams,
 {beamWidth=14,maxOptions=12}={}){
 if(y<0||y+1>=rows.length)throw Error('AAブロックの行が不正です');
 const height=rows.length,n=atlas.length;
 const above=ports(rows[y-1],atlas,width,S,'bottom');
 const below=ports(rows[y+2],atlas,width,S,'top');
 const beam=[{score:0,top:null,bottom:null,lastTop:-1,lastBottom:-1,
  topRow:[],bottomRow:[],key:'initial'}];
 let states=beam;
 // Positions are half-width columns. A glyph that spans the next column
 // remains active there; it cannot be overwritten or truncated.
 for(let x=0;x<width;x++){
  const next=[];
  const expectH0=seams.horiz.subarray((y*(width+1)+x)*S,(y*(width+1)+x+1)*S);
  const expectH1=seams.horiz.subarray(((y+1)*(width+1)+x)*S,((y+1)*(width+1)+x+1)*S);
  const expectMiddle=seams.vert.subarray((y+1)*width*S+x*S,(y+1)*width*S+(x+1)*S);
  const upperExpected=seams.vert.subarray(y*width*S,(y+1)*width*S);
  const lowerExpected=seams.vert.subarray((y+2)*width*S,(y+3)*width*S);
  const availableTop=shortlist(candidates,unary,atlas,y*width+x,width,S,maxOptions);
  const availableBottom=shortlist(candidates,unary,atlas,(y+1)*width+x,width,S,maxOptions);
  for(const state of states){
   const tActive=state.top?.end>x,bActive=state.bottom?.end>x;
   const tOptions=tActive?[null]:availableTop;
   const bOptions=bActive?[null]:availableBottom;
   for(const tPick of tOptions){
    const t=tPick?{j:tPick.j,start:x,end:x+atlas[tPick.j].columns}:state.top;
    const tGlyph=atlas[t.j];
    let tCost=tPick?tPick.score*tGlyph.columns:0;
    if(tPick){
     if(state.lastTop>=0)tCost+=H*mismatch(atlas[state.lastTop].ports.right,tGlyph.ports.left,0,S,expectH0);
     if(above)tCost+=V*tGlyph.columns*mismatch(tGlyph.ports.top,above,x*S,tGlyph.columns*S,upperExpected);
    }
    for(const bPick of bOptions){
     const b=bPick?{j:bPick.j,start:x,end:x+atlas[bPick.j].columns}:state.bottom;
     const bGlyph=atlas[b.j];
     let score=state.score+tCost+(bPick?bPick.score*bGlyph.columns:0);
     if(bPick){
      if(state.lastBottom>=0)score+=H*mismatch(atlas[state.lastBottom].ports.right,bGlyph.ports.left,0,S,expectH1);
      if(below)score+=V*bGlyph.columns*mismatch(bGlyph.ports.bottom,below,x*S,bGlyph.columns*S,lowerExpected);
     }
     const topPort=tGlyph.ports.bottom.subarray((x-t.start)*S,(x-t.start+1)*S);
     const bottomPort=bGlyph.ports.top.subarray((x-b.start)*S,(x-b.start+1)*S);
     score+=V*mismatch(topPort,bottomPort,0,S,expectMiddle);
     const key=t.j+'/'+t.end+'/'+b.j+'/'+b.end;
     const item={score,top:t,bottom:b,
      lastTop:t.j,lastBottom:b.j,
      topRow:tPick?[...state.topRow,{x,j:t.j}]:state.topRow,
      bottomRow:bPick?[...state.bottomRow,{x,j:b.j}]:state.bottomRow,key};
     topState(next,item,beamWidth);
    }
   }
  }
  if(!next.length)throw Error('モード4のブロック最適化に失敗しました');
  states=next;
 }
 const best=states[0];
 const widthOf=row=>row.reduce((sum,p)=>sum+atlas[p.j].columns,0);
 if(widthOf(best.topRow)!==width||widthOf(best.bottomRow)!==width)
  throw Error('AAブロックの半角幅が不一致');
 return [best.topRow,best.bottomRow];
}
