// Mode 4 global composition. Native D3D11 cs_5_0, no browser GPU API.
// Arena offsets and integer values are stored as uint; scalar values as fp32 bits.
RWStructuredBuffer<uint> M : register(u0);
cbuffer Parameters : register(b0) {
 uint W,H,S,G;
 uint passKind,firstRow,rowStride,rowCount;
 uint tileX,tileY,beamWidth,maxOptions;
 uint spare0,spare1,spare2,spare3;
};
#define CAND 40
#define INF 1e20
// Header offsets: target, importance, dist, gray, oldGray, oldIds,
// glyphCols, glyphShape, glyphPenalty, glyphOrient, mask, expanded, faces,
// unary, candidates, rows, proposed, dp, hseams, vseams, ports,
// beamHistory, diagnostics, candidateCounts, orientation
uint base(uint k){return M[k];}
float f(uint a){return asfloat(M[a]);}
void put(uint a,float v){M[a]=asuint(v);}
float data(uint k,uint a){return f(base(k)+a);}
uint ui(uint k,uint a){return M[base(k)+a];}
uint cols(uint g){return ui(6,g);}
float mask(uint g,uint x,uint y){return data(10,g*2*S*S+y*cols(g)*S+x);}
float gp(uint g,uint side,uint x){return data(20,g*8*S+side*2*S+x);}
float hp(uint y,uint x,uint i){return data(18,(y*(W+1)+x)*S+i);}
float vp(uint y,uint x){return data(19,y*W*S+x);}
float nearPort(uint g,uint side,uint i,uint start,uint len) {
 float v=gp(g,side,start+i);
 if(i>0)v=max(v,gp(g,side,start+i-1)*.73);
 if(i+1<len)v=max(v,gp(g,side,start+i+1)*.73);
 return v;
}
float hjoin(uint a,uint b,uint y,uint x){
 float e=0;
 for(uint i=0;i<S;i++){
  float av=gp(a,1,i),bv=gp(b,0,i);
  float na=nearPort(a,1,i,0,S),nb=nearPort(b,0,i,0,S);
  e+=max(0,av-nb)+max(0,bv-na)+1.75*hp(y,x,i)*(1-min(na,nb));
 }
 return e/(2*S);
}
uint glyphAt(uint y,uint x,out uint start){
 start=x;uint g=ui(15,y*W+x);
 if(g==0xffffffff){start=x-1;g=ui(15,y*W+start);}
 return g;
}
float rowPort(uint y,uint px,uint side){
 uint start,g=glyphAt(y,px/S,start);
 return gp(g,side,px-start*S);
}
float vjoin(uint g,uint side,uint yOther,uint otherSide,uint x,uint seamY){
 uint n=cols(g)*S;float e=0;
 for(uint i=0;i<n;i++){
  uint px=x*S+i;
  float a=gp(g,side,i),b=rowPort(yOther,px,otherSide),na=a,nb=b;
  if(i>0){na=max(na,gp(g,side,i-1)*.73);nb=max(nb,rowPort(yOther,px-1,otherSide)*.73);}
  if(i+1<n){na=max(na,gp(g,side,i+1)*.73);nb=max(nb,rowPort(yOther,px+1,otherSide)*.73);}
  e+=max(0,a-nb)+max(0,b-na)+1.75*vp(seamY,px)*(1-min(na,nb));
 }
 return e/(2*n);
}
float unary(uint y,uint x,uint g){return data(13,(y*W+x)*G+g);}
float rowBase(uint y,uint x,uint g){
 float v=unary(y,x,g)*cols(g);
 if(passKind!=0){
  if(y>0)v+=.33*cols(g)*vjoin(g,2,y-1,3,x,y);
  if(y+1<H)v+=.33*cols(g)*vjoin(g,3,y+1,2,x,y+1);
 }
 return v;
}
float rowEnergy(uint y,uint rowBuffer){
 float v=0;uint previous=0xffffffff;
 for(uint x=0;x<W;x++){
  uint g=ui(rowBuffer,y*W+x);if(g==0xffffffff)continue;
  v+=rowBase(y,x,g);
  if(previous!=0xffffffff)v+=.23*hjoin(previous,g,y,x);
  previous=g;
 }
 return v;
}
float histValue(uint x,uint y,uint cw,uint bin){
 int2 a[4]={int2(-1,0),int2(-1,-1),int2(0,-1),int2(1,-1)};
 float result=0;
 for(uint py=0;py<S;py++)for(uint px=0;px<cw*S;px++){
  uint k=(y*S+py)*W*S+x*S+px;float t=data(0,k);if(t<.16)continue;
  float ab=0;
  for(int sign=-1;sign<=1;sign+=2){
   int2 q=int2(px,py)+a[bin]*sign;
   if(q.x>=0&&q.x<int(cw*S)&&q.y>=0&&q.y<int(S))
    ab+=data(0,(y*S+q.y)*W*S+x*S+q.x);
  }
  result+=t*min(1,ab*.65);
 }
 return result;
}
[numthreads(64,1,1)]
void prepare(uint3 id:SV_DispatchThreadID){
 uint cell=id.x;if(cell>=W*H)return;
 uint x=cell%W,y=cell/W;
 for(uint c=1;c<=2;c++){
  float4 hs=0;
  if(x+c<=W)for(uint k=0;k<4;k++)hs[k]=histValue(x,y,c,k);
  float sum=dot(hs,1.0.xxxx);
  if(sum>0)hs/=sum;
  for(uint k=0;k<4;k++)put(base(24)+cell*8+(c-1)*4+k,hs[k]);
 }
 if(x>0)for(uint py=0;py<S;py++){
  uint k=(y*S+py)*W*S+x*S;
  float a=max(data(0,k-1),data(0,k-2)*.7);
  float b=max(data(0,k),data(0,k+1)*.7);
  put(base(18)+(y*(W+1)+x)*S+py,min(a,b));
 }
 if(y>0)for(uint px=0;px<S;px++){
  uint k=y*S*W*S+x*S+px;
  float a=max(data(0,k-W*S),data(0,k-2*W*S)*.7);
  float b=max(data(0,k),data(0,k+W*S)*.7);
  put(base(19)+y*W*S+x*S+px,min(a,b));
 }
 M[base(15)+cell]=0;
}
[numthreads(64,1,1)]
void score(uint3 id:SV_DispatchThreadID){
 uint index=id.x+id.y*65535*64;if(index>=W*H*G)return;
 uint g=index%G,cell=index/G,x=cell%W,y=cell/W,c=cols(g);
 if(x+c>W){put(base(13)+index,INF);return;}
 float sum=0,missing=0,extra=0,direct=0,drift=0;
 for(uint py=0;py<S;py++)for(uint px=0;px<c*S;px++){
  uint k=(y*S+py)*W*S+x*S+px,mi=g*2*S*S+py*c*S+px;
  float t=data(0,k),p=data(1,k);if(p==0)p=1;
  float m=data(10,mi);
  sum+=t*p;missing+=p*t*(1-data(11,mi));
  extra+=min(1.9,p)*m*min(1,data(2,k)/2.4);
  direct+=p*(t-m)*(t-m);
  if(spare1)drift+=abs(data(3,k)-data(4,k));
 }
 float density=sum/(c*S*S);
 if(g!=0&&density<.008){put(base(13)+index,INF);return;}
 float v=(1.85*missing+.62*extra+.19*direct)/(c*S*S);
 if(g!=0){
  if(sum>.5){
   float e=0;for(uint k=0;k<4;k++)e+=abs(data(9,g*4+k)-data(24,cell*8+(c-1)*4+k));
   v+=.038*min(1,density*13)*e;
  }
  v+=.0025+data(8,g);
  if(!ui(7,g))for(uint k=0;k<spare0;k++){
   float fx=data(12,k*4),fy=data(12,k*4+1),fw=data(12,k*4+2),fh=data(12,k*4+3);
   float cx=(x+c*.5)/W,cy=(y+.5)/H;
   if(cx>=fx-fw*.15&&cx<=fx+fw*1.15&&cy>=fy-fh*.2&&cy<=fy+fh*1.25){v+=.07;break;}
  }
 }
 if(!spare2&&spare1&&ui(5,cell)==g&&drift/(c*S*S)<.065&&density>.025)v-=.004;
 put(base(13)+index,max(0,v));
}
[numthreads(64,1,1)]
void candidates(uint3 id:SV_DispatchThreadID){
 uint p=id.x;if(p>=W*H)return;
 uint selected[40];float values[40];uint count=0;
 for(uint c=1;c<=2;c++){
  uint start=count,limit=c==1?14:24;
  for(uint g=0;g<G;g++){
   if(cols(g)!=c)continue;
   float v=data(13,p*G+g);if(v>=INF)continue;
   uint n=count-start;if(n>=limit&&v>=values[count-1])continue;
   uint at=count;
   while(at>start&&values[at-1]>v){if(at<40){selected[at]=selected[at-1];values[at]=values[at-1];}at--;}
   selected[at]=g;values[at]=v;
   if(n<limit)count++;
  }
 }
 uint old=ui(5,p);bool hasBlank=false,hasOld=false;
 for(uint k=0;k<count;k++){if(selected[k]==0)hasBlank=true;if(selected[k]==old)hasOld=true;}
 if(old<G&&!hasOld&&data(13,p*G+old)<INF)selected[count++]=old;
 if(!hasBlank)selected[count++]=0;
 M[base(23)+p]=count;
 for(uint k=0;k<40;k++)M[base(14)+p*40+k]=k<count?selected[k]:0xffffffff;
}
groupshared float dpScore[120];
groupshared float reduction[128];
groupshared uint argmin[128];
[numthreads(64,1,1)]
void solveRows(uint3 group:SV_GroupID,uint tid:SV_GroupIndex){
 uint y=firstRow+group.x*rowStride;if(group.x>=rowCount||y>=H)return;
 for(uint k=tid;k<120;k+=64)dpScore[k]=INF;
 GroupMemoryBarrierWithGroupSync();
 for(uint x=0;x<W;x++){
  uint p=y*W+x,g=tid<40?ui(14,p*40+tid):0xffffffff;
  float best=INF;uint prior=0xffffffff;
  if(g<G){
   float b=rowBase(y,x,g);
   if(x==0){best=b;}
   else for(uint step=1;step<=2;step++){
    if(x<step)continue;
    uint pp=y*W+x-step;
    for(uint k=0;k<ui(23,pp);k++){
     uint pg=ui(14,pp*40+k);if(cols(pg)!=step)continue;
     float v=dpScore[((x-step)%3)*40+k]+b+.23*hjoin(pg,g,y,x);
     if(v<best){best=v;prior=(x-step)*40+k;}
    }
   }
   M[base(17)+p*40+tid]=prior;
  }
  GroupMemoryBarrierWithGroupSync();
  if(tid<40)dpScore[(x%3)*40+tid]=best;
  GroupMemoryBarrierWithGroupSync();
 }
 float best=INF;uint key=0xffffffff;
 if(tid<40)for(uint step=1;step<=2;step++){
  uint x=W-step,p=y*W+x,g=ui(14,p*40+tid);
  if(g<G&&cols(g)==step&&dpScore[(x%3)*40+tid]<best){best=dpScore[(x%3)*40+tid];key=x*40+tid;}
 }
 reduction[tid]=best;argmin[tid]=key;
 GroupMemoryBarrierWithGroupSync();
 for(uint stride=32;stride>0;stride/=2){
  if(tid<stride&&reduction[tid+stride]<reduction[tid]){reduction[tid]=reduction[tid+stride];argmin[tid]=argmin[tid+stride];}
  GroupMemoryBarrierWithGroupSync();
 }
 if(tid==0){
  for(uint x=0;x<W;x++)M[base(16)+y*W+x]=0xffffffff;
  uint k=argmin[0];
  for(uint guard=0;k!=0xffffffff&&guard<W;guard++){
   uint x=k/40,ci=k%40,p=y*W+x;
   M[base(16)+p]=ui(14,p*40+ci);k=ui(17,p*40+ci);
  }
  if(passKind==0||rowEnergy(y,16)<=rowEnergy(y,15)+.00001)
   for(uint x=0;x<W;x++)M[base(15)+y*W+x]=ui(16,y*W+x);
 }
}
// Two-row beam search is defined in the companion include.
#include "fullgpu_band.hlsl"
#include "fullgpu_critic.hlsl"
