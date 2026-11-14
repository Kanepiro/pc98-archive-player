// Whole-frame raster critic, including lost contours and actual glyph ink.
groupshared uint2 patternsT[11],patternsB[11];
groupshared uint countT,countB,validTile;
groupshared float patScores[11];
uint2 originalPattern(uint y,uint x){return uint2(ui(15,y*W+x),ui(15,y*W+x+1));}
float patUnary(uint2 p,uint y,uint x){
 return unary(y,x,p.x)*cols(p.x)+(p.y!=0xffffffff?unary(y,x+1,p.y):0);
}
void addPattern(inout uint2 options[11],inout float vals[11],inout uint count,uint2 p,float v,uint limit){
 for(uint k=0;k<count;k++)if(all(options[k]==p))return;
 if(count>=limit&&v>=vals[count-1])return;
 uint at=count;
 while(at>0&&vals[at-1]>v){if(at<11){options[at]=options[at-1];vals[at]=vals[at-1];}at--;}
 options[at]=p;vals[at]=v;if(count<limit)count++;
}
void patternOptions(uint y,uint x,bool top){
 uint2 options[11];float vals[11];uint count=0;
 uint ones[4],nexts[4],nc=0,nn=0,nf=0;
 uint limit=W*H>3000?7:10;
 for(uint k=0;k<ui(23,y*W+x);k++){
  uint g=ui(14,(y*W+x)*40+k);
  if(cols(g)==1){if(nc<4)ones[nc++]=g;}
  else if(nf<max(4,limit-4)){
   addPattern(options,vals,count,uint2(g,0xffffffff),unary(y,x,g)*2,limit);nf++;
  }
 }
 for(uint k=0;k<ui(23,y*W+x+1)&&nn<4;k++){
  uint g=ui(14,(y*W+x+1)*40+k);if(cols(g)==1)nexts[nn++]=g;
 }
 for(uint a=0;a<nc;a++)for(uint b=0;b<nn;b++){
  uint2 p=uint2(ones[a],nexts[b]);addPattern(options,vals,count,p,patUnary(p,y,x),limit);
 }
 uint2 original=originalPattern(y,x);bool found=false;
 for(uint k=0;k<count;k++)if(all(options[k]==original))found=true;
 if(!found)options[count++]=original;
 if(top){countT=count;for(uint k=0;k<count;k++)patternsT[k]=options[k];}
 else{countB=count;for(uint k=0;k<count;k++)patternsB[k]=options[k];}
}
float pport(uint2 p,uint side,uint px){
 if(cols(p.x)==2||px<S)return gp(p.x,side,px);
 return gp(p.y,side,px-S);
}
float pmask(uint2 p,uint px,uint py){
 if(cols(p.x)==2||px<S)return mask(p.x,px,py);
 return mask(p.y,px-S,py);
}
float patchCost(uint2 p,uint y,uint x){
 float cost=0;
 for(uint py=0;py<S;py++)for(uint px=0;px<2*S;px++){
  uint k=(y*S+py)*W*S+x*S+px;float t=data(0,k),q=data(1,k),m=pmask(p,px,py);
  if(q==0)q=1;
  cost+=q*.47*(t-m)*(t-m)+.25*m*min(3,data(2,k))/3;
 }
 return cost/(S*S);
}
float patternJoin(uint2 a,uint2 b,uint seamY,uint x){
 float e=0;uint n=2*S;
 for(uint i=0;i<n;i++){
  float av=pport(a,3,i),bv=pport(b,2,i),na=av,nb=bv;
  if(i>0){na=max(na,pport(a,3,i-1)*.73);nb=max(nb,pport(b,2,i-1)*.73);}
  if(i+1<n){na=max(na,pport(a,3,i+1)*.73);nb=max(nb,pport(b,2,i+1)*.73);}
  e+=max(0,av-nb)+max(0,bv-na)+1.75*vp(seamY,x*S+i)*(1-min(na,nb));
 }
 return e/(2*n);
}
float patternOutside(uint2 p,uint side,uint otherY,uint otherSide,uint seamY,uint x){
 float e=0;uint n=2*S;
 for(uint i=0;i<n;i++){
  float av=pport(p,side,i),bv=rowPort(otherY,x*S+i,otherSide),na=av,nb=bv;
  if(i>0){na=max(na,pport(p,side,i-1)*.73);nb=max(nb,rowPort(otherY,x*S+i-1,otherSide)*.73);}
  if(i+1<n){na=max(na,pport(p,side,i+1)*.73);nb=max(nb,rowPort(otherY,x*S+i+1,otherSide)*.73);}
  e+=max(0,av-nb)+max(0,bv-na)+1.75*vp(seamY,x*S+i)*(1-min(na,nb));
 }
 return e/(2*n);
}
float localPattern(uint2 t,uint2 b,uint y,uint x){
 float score=0;uint2 p;
 for(uint dy=0;dy<2;dy++){
  p=dy==0?t:b;uint yy=y+dy,last=p.y==0xffffffff?p.x:p.y;
  score+=patUnary(p,yy,x)+.65*patchCost(p,yy,x);
  if(p.y!=0xffffffff)score+=.23*hjoin(p.x,p.y,yy,x+1);
  if(x>0){uint start,left=glyphAt(yy,x-1,start);score+=.23*hjoin(left,p.x,yy,x);}
  if(x+2<W)score+=.23*hjoin(last,ui(15,yy*W+x+2),yy,x+2);
 }
 score+=.33*2*patternJoin(t,b,y+1,x);
 if(y>0)score+=.33*2*patternOutside(t,2,y-1,3,y,x);
 if(y+2<H)score+=.33*2*patternOutside(b,3,y+2,2,y+2,x);
 return score;
}
[numthreads(128,1,1)]
void criticPropose(uint tid:SV_GroupIndex){
 uint y=tileY,x=tileX;
 if(tid==0){
  validTile=0;
  if(ui(22,2)<spare3&&x+2<=W&&y+1<H&&
   ui(15,y*W+x)!=0xffffffff&&ui(15,(y+1)*W+x)!=0xffffffff&&
   (x+2==W||(ui(15,y*W+x+2)!=0xffffffff&&ui(15,(y+1)*W+x+2)!=0xffffffff))){
   validTile=1;patternOptions(y,x,true);patternOptions(y+1,x,false);
   InterlockedAdd(M[base(22)+2],1);
  }
  M[base(22)+15]=0;
 }
 GroupMemoryBarrierWithGroupSync();
 if(validTile==0)return;
 float best=INF;uint pick=0xffffffff;
 for(uint k=tid;k<countT*countB;k+=128){
  float value=localPattern(patternsT[k/countB],patternsB[k%countB],y,x);
  if(value<best){best=value;pick=k;}
 }
 reduction[tid]=best;argmin[tid]=pick;
 GroupMemoryBarrierWithGroupSync();
 for(uint stride=64;stride>0;stride/=2){
  if(tid<stride&&reduction[tid+stride]<reduction[tid]){reduction[tid]=reduction[tid+stride];argmin[tid]=argmin[tid+stride];}
  GroupMemoryBarrierWithGroupSync();
 }
 if(tid==0&&reduction[0]+.003<localPattern(originalPattern(y,x),originalPattern(y+1,x),y,x)){
  uint2 a=patternsT[argmin[0]/countB],b=patternsB[argmin[0]%countB];
  for(uint k=0;k<2*W;k++)M[base(16)+y*W+k]=ui(15,y*W+k);
  M[base(15)+y*W+x]=a.x;M[base(15)+y*W+x+1]=a.y;
  M[base(15)+(y+1)*W+x]=b.x;M[base(15)+(y+1)*W+x+1]=b.y;
  M[base(22)+15]=1;
 }
}
float inkAt(int px,int py){
 if(px<0||py<0||px>=int(W*S)||py>=int(H*S))return 0;
 uint start,g=glyphAt(py/S,px/S,start);
 return mask(g,px-start*S,py%S);
}
[numthreads(64,1,1)]
void evaluate(uint3 id:SV_DispatchThreadID){
 uint cell=id.x;if(cell>=W*H)return;
 if(passKind==3&&ui(22,15)==0)return;
 uint x=cell%W,y=cell/W,g=ui(15,cell);
 float layout=0,missing=0,extra=0,squared=0,edge=0,drawn=0;
 if(g!=0xffffffff){
  layout=unary(y,x,g)*cols(g);
  if(x>0){uint st,prev=glyphAt(y,x-1,st);layout+=.23*hjoin(prev,g,y,x);}
  if(y>0)layout+=.33*cols(g)*vjoin(g,2,y-1,3,x,y);
 }
 for(uint py=0;py<S;py++)for(uint px=0;px<S;px++){
  int xx=x*S+px,yy=y*S+py;uint k=yy*W*S+xx;
  float t=data(0,k),v=inkAt(xx,yy),p=data(1,k);if(p==0)p=1;p=min(3.4,p);
  float dist=3;
  for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++){
   float metric=max(abs(dx),abs(dy))+.41421356*min(abs(dx),abs(dy));
   if(metric<dist&&inkAt(xx+dx,yy+dy)>.22)dist=metric;
  }
  missing+=t*p*dist/3;extra+=v*min(3,data(2,k))/3;
  squared+=p*(t-v)*(t-v);edge+=t*p;drawn+=v;
 }
 uint at=base(25)+cell*6;
 put(at,layout);put(at+1,missing/(S*S));put(at+2,extra/(S*S));
 put(at+3,squared/(S*S));put(at+4,edge/(S*S));put(at+5,drawn/(S*S));
}
groupshared float sums[768];
groupshared uint criticActive;
[numthreads(128,1,1)]
void reduceCritic(uint tid:SV_GroupIndex){
 if(tid==0)criticActive=(passKind!=3||ui(22,15)!=0)?1:0;
 GroupMemoryBarrierWithGroupSync();
 if(!criticActive)return;
 for(uint j=0;j<6;j++){float s=0;for(uint i=tid;i<W*H;i+=128)s+=data(25,i*6+j);sums[j*128+tid]=s;}
 GroupMemoryBarrierWithGroupSync();
 for(uint stride=64;stride>0;stride/=2){
  if(tid<stride)for(uint j=0;j<6;j++)sums[j*128+tid]+=sums[j*128+tid+stride];
  GroupMemoryBarrierWithGroupSync();
 }
 if(tid==0){
  float pixel=1.6*sums[128]+.80*sums[256]+.32*sums[384],total=.55*sums[0]+.78*pixel;
  if(passKind==3&&!(total+.001<data(22,4))){
   for(uint k=0;k<2*W;k++)M[base(15)+tileY*W+k]=ui(16,tileY*W+k);
  }else{
   if(passKind==3)InterlockedAdd(M[base(22)+3],1);
   put(base(22)+4,total);put(base(22)+5,sums[0]);put(base(22)+6,pixel);
   for(uint j=1;j<6;j++)put(base(22)+6+j,sums[j*128]);
   if(passKind==2)put(base(22)+12,total);
  }
 }
}
