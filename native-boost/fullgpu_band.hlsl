// Joint two-row beam. All candidate costs, beam reductions and traceback are GPU work.
groupshared float beamScores[14],nextScores[14],pairScores[2744];
groupshared uint bt[14],bb[14],et[14],eb[14];
groupshared uint nt[14],nb[14],net[14],neb[14];
groupshared uint topOptions[14],bottomOptions[14],topCount,bottomCount,live;
groupshared uint chosenIndex;
void makeOptions(uint p,bool top){
 uint a[14],count=0,n1=0,n2=0;
 uint lim1=max(3,(uint)floor(maxOptions*.38)),lim2=max(5,(uint)ceil(maxOptions*.62));
 bool blank=false;
 for(uint k=0;k<ui(23,p);k++){
  uint g=ui(14,p*40+k);uint c=cols(g);
  if(data(13,p*G+g)>=INF)continue;
  if(c==1){if(n1>=lim1)continue;n1++;}else{if(n2>=lim2)continue;n2++;}
  a[count++]=g;if(g==0)blank=true;
 }
 if(!blank)a[count++]=0;
 for(uint i=1;i<count;i++){
  uint g=a[i],j=i;float s=data(13,p*G+g);
  while(j>0&&data(13,p*G+a[j-1])>s){a[j]=a[j-1];j--;}a[j]=g;
 }
 if(top){topCount=count;for(uint i=0;i<count;i++)topOptions[i]=a[i];}
 else{bottomCount=count;for(uint i=0;i<count;i++)bottomOptions[i]=a[i];}
}
uint4 pairKey(uint index,uint x){
 uint b=index/(topCount*bottomCount),ti=(index/bottomCount)%topCount,bi=index%bottomCount;
 bool ta=et[b]>x,ba=eb[b]>x;
 uint t=ta?bt[b]:topOptions[ti],v=ba?bb[b]:bottomOptions[bi];
 return uint4(t,ta?et[b]:x+cols(t),v,ba?eb[b]:x+cols(v));
}
float pairCost(uint index,uint y,uint x){
 uint b=index/(topCount*bottomCount),ti=(index/bottomCount)%topCount,bi=index%bottomCount;
 if(b>=live)return INF;
 bool ta=et[b]>x,ba=eb[b]>x;
 if((ta&&ti>0)||(ba&&bi>0))return INF;
 uint4 key=pairKey(index,x);uint t=key.x,v=key.z;
 float s=beamScores[b];
 if(!ta){
  s+=unary(y,x,t)*cols(t);
  if(bt[b]!=0xffffffff)s+=.23*hjoin(bt[b],t,y,x);
  if(y>0)s+=.33*cols(t)*vjoin(t,2,y-1,3,x,y);
 }
 if(!ba){
  s+=unary(y+1,x,v)*cols(v);
  if(bb[b]!=0xffffffff)s+=.23*hjoin(bb[b],v,y+1,x);
  if(y+2<H)s+=.33*cols(v)*vjoin(v,3,y+2,2,x,y+2);
 }
 uint ts=(x+cols(t)-key.y)*S,bs=(x+cols(v)-key.w)*S;
 float e=0;
 for(uint i=0;i<S;i++){
  float a=gp(t,3,ts+i),bval=gp(v,2,bs+i);
  float na=nearPort(t,3,i,ts,S),nv=nearPort(v,2,i,bs,S);
  e+=max(0,a-nv)+max(0,bval-na)+1.75*vp(y+1,x*S+i)*(1-min(na,nv));
 }
 return s+.33*e/(2*S);
}
float bandEnergy(uint y){
 float v=rowEnergy(y,15)+rowEnergy(y+1,15);
 // rowEnergy counts the internal join twice; the full-frame objective counts once.
 for(uint x=0;x<W;x++){
  uint g=ui(15,(y+1)*W+x);if(g==0xffffffff)continue;
  v-=.33*cols(g)*vjoin(g,2,y,3,x,y+1);
 }
 return v;
}
[numthreads(128,1,1)]
void solveBands(uint3 group:SV_GroupID,uint tid:SV_GroupIndex){
 uint y=firstRow+group.x*rowStride;if(group.x>=rowCount||y+1>=H)return;
 if(tid==0){live=1;beamScores[0]=0;bt[0]=bb[0]=0xffffffff;et[0]=eb[0]=0;}
 GroupMemoryBarrierWithGroupSync();
 for(uint x=0;x<W;x++){
  if(tid==0){makeOptions(y*W+x,true);makeOptions((y+1)*W+x,false);}
  GroupMemoryBarrierWithGroupSync();
  uint total=live*topCount*bottomCount;
  for(uint i=tid;i<total;i+=128)pairScores[i]=pairCost(i,y,x);
  GroupMemoryBarrierWithGroupSync();
  for(uint rank=0;rank<beamWidth;rank++){
   float best=INF;uint bestIndex=0xffffffff;
   for(uint i=tid;i<total;i+=128)if(pairScores[i]<best){best=pairScores[i];bestIndex=i;}
   reduction[tid]=best;argmin[tid]=bestIndex;
   GroupMemoryBarrierWithGroupSync();
   for(uint stride=64;stride>0;stride/=2){
    if(tid<stride&&(reduction[tid+stride]<reduction[tid]||
      (reduction[tid+stride]==reduction[tid]&&argmin[tid+stride]<argmin[tid]))){
     reduction[tid]=reduction[tid+stride];argmin[tid]=argmin[tid+stride];
    }
    GroupMemoryBarrierWithGroupSync();
   }
   if(tid==0){
    chosenIndex=argmin[0];nextScores[rank]=reduction[0];
    if(chosenIndex!=0xffffffff){
     uint4 key=pairKey(chosenIndex,x);nt[rank]=key.x;net[rank]=key.y;nb[rank]=key.z;neb[rank]=key.w;
     uint prior=chosenIndex/(topCount*bottomCount),at=base(21)+(y*W+x)*14*3+rank*3;
     M[at]=prior;M[at+1]=et[prior]>x?0xffffffff:key.x;M[at+2]=eb[prior]>x?0xffffffff:key.z;
    }
   }
   GroupMemoryBarrierWithGroupSync();
   if(chosenIndex!=0xffffffff){
    uint4 key=pairKey(chosenIndex,x);
    for(uint i=tid;i<total;i+=128)if(all(pairKey(i,x)==key))pairScores[i]=INF;
   }
   GroupMemoryBarrierWithGroupSync();
  }
  if(tid==0){live=0;for(uint i=0;i<beamWidth;i++)if(nextScores[i]<INF)live++;}
  if(tid<beamWidth){beamScores[tid]=nextScores[tid];bt[tid]=nt[tid];bb[tid]=nb[tid];et[tid]=net[tid];eb[tid]=neb[tid];}
  GroupMemoryBarrierWithGroupSync();
 }
 if(tid==0&&live>0){
  for(uint x=0;x<W;x++){M[base(16)+y*W+x]=0xffffffff;M[base(16)+(y+1)*W+x]=0xffffffff;}
  uint state=0;
  for(int x=int(W)-1;x>=0;x--){
   uint at=base(21)+(y*W+x)*14*3+state*3;
   if(M[at+1]!=0xffffffff)M[base(16)+y*W+x]=M[at+1];
   if(M[at+2]!=0xffffffff)M[base(16)+(y+1)*W+x]=M[at+2];
   state=M[at];
  }
  float old=bandEnergy(y);
  for(uint x=0;x<2*W;x++){
   uint at=y*W+x,tmp=ui(15,at);M[base(15)+at]=ui(16,at);M[base(16)+at]=tmp;
  }
  float revised=bandEnergy(y);
  if(!(revised+.00001<old))
   for(uint x=0;x<2*W;x++)M[base(15)+y*W+x]=ui(16,y*W+x);
  else InterlockedAdd(M[base(22)+1],1);
  InterlockedAdd(M[base(22)],1);
 }
}
