// Windows DirectCompute: original Modes 1/2 tone rules and Mode 3 XDoG,
// connected edges, glyph loss, temporal stabilization and variable-width row DP.
RWStructuredBuffer<uint> A : register(u0);
cbuffer Params : register(b0) {
 uint W,H,S,Mode; uint G,hasOld,src,dst;
 uint axis,channels,K,reserved;
 float brightness,contrast,gamma,edge;
};
uint O(uint slot){return A[slot];}
float F(uint slot,uint i){return asfloat(A[O(slot)+i]);}
void SF(uint slot,uint i,float value){A[O(slot)+i]=asuint(value);}
uint threadIndex(uint3 id){return id.x+id.y*65535*128;}
static const float Bayer[16]={0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5};
[numthreads(128,1,1)]
void average(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),C=W*H;if(i>=C)return;
 uint x=i%W,y=i/W,w=W*S;float3 rgb=0;
 for(uint py=0;py<S;py++)for(uint px=0;px<S;px++){
  uint p=A[O(0)+(y*S+py)*w+x*S+px];
  rgb+=float3(p&255,(p>>8)&255,(p>>16)&255)*(float(p>>24)/255);
 }
 rgb/=float(S*S);SF(1,i*4,rgb.x);SF(1,i*4+1,rgb.y);SF(1,i*4+2,rgb.z);
 SF(1,i*4+3,dot(rgb,float3(.2126,.7152,.0722)));
}
[numthreads(128,1,1)]
void tones(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),C=W*H;if(i>=C)return;
 if(Mode==2){
  uint D=W/2;if(i>=D*H)return;uint x=i%D,y=i/D;
  float lum=(F(1,(y*W+x*2)*4+3)+F(1,(y*W+x*2+1)*4+3))/510;
  float value=pow(saturate((lum-.5)*contrast+.5+brightness/100),gamma);
  // Same measured, tagged glyph masks and local interval dithering as JavaScript.
  const float levels24[5]={0,0.213543843854,0.569375221068,0.805074118139,1};
  const float levels16[5]={0,0.218713395493,0.568757906574,0.799559574568,1};
  float dither=(Bayer[(y%4)*4+x%4]-7.5)/16*.25;
  uint selected=0;
  for(uint k=0;k<4;k++){
   float lo=reserved==16?levels16[k]:levels24[k],hi=reserved==16?levels16[k+1]:levels24[k+1];
   if(value>=(lo+hi)*.5-dither*(hi-lo))selected=k+1;
  }
  A[O(25)+i]=selected;
 }else{
  uint x=i%W,y=i/W;float value=clamp((F(1,i*4+3)-127.5)*contrast+127.5+brightness*2.55,0,255);
  float difference=0;
  for(uint c=0;c<3;c++){
   if(x>0)difference=max(difference,abs(F(1,i*4+c)-F(1,(i-1)*4+c)));
   if(y>0)difference=max(difference,abs(F(1,i*4+c)-F(1,(i-W)*4+c)));
  }
  float outline=36*edge*saturate((difference-24)/112);
  value=clamp(value+(value<128?outline:-outline),0,255);
  A[O(25)+i]=min(15,(uint)floor(pow(value/255,gamma)*15+.5));
 }
}
[numthreads(128,1,1)]
void normalizeQuality(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),N=W*H*S*S;if(i>=N)return;uint p=A[O(0)+i];
 float3 rgb=pow(saturate((float3(p&255,(p>>8)&255,(p>>16)&255)/255-.5)*contrast+.5+brightness/100),gamma.xxx);
 float gray=dot(rgb,float3(.2126,.7152,.0722));
 SF(1,i,rgb.r);SF(1,N+i,rgb.g);SF(1,N*2+i,rgb.b);SF(1,N*3+i,gray);SF(14,i,gray);
}
[numthreads(128,1,1)]
void gaussianQuality(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),w=W*S,h=H*S,N=w*h;if(i>=N*channels)return;
 uint c=i/N,p=i%N,x=p%w,y=p/w;float sigma=K==0?.75:K==1?.8:1.85;
 int radius=(int)ceil(2.4*sigma);float sum=0,total=0;
 for(int k=-radius;k<=radius;k++){
  float weight=exp(-float(k*k)/(2*sigma*sigma));
  uint q=axis==0?y*w+(uint)clamp(int(x)+k,0,int(w)-1):(uint)clamp(int(y)+k,0,int(h)-1)*w+x;
  sum+=F(src,c*N+q)*weight;total+=weight;
 }
 SF(dst,i,sum/total);
}
[numthreads(128,1,1)]
void gradientQuality(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),w=W*S,h=H*S,N=w*h;if(i>=N)return;uint x=i%w,y=i/w;
 if(x==0||y==0||x+1==w||y+1==h){SF(7,i,0);return;}
 float best=0;float2 direction=0;
 for(uint k=0;k<4;k++){
  uint c=k==0?3:k-1;
  float2 v=float2(F(3,c*N+i+1)-F(3,c*N+i-1),F(3,c*N+i+w)-F(3,c*N+i-w));
  float mag=dot(v,v);if(mag>best){best=mag;direction=v;}
 }
 SF(7,i,sqrt(best));float degree=fmod(atan2(direction.y,direction.x)*57.2957795131+180,180);
 A[O(8)+i]=degree<22.5||degree>=157.5?0:degree<67.5?1:degree<112.5?2:3;
}
[numthreads(128,1,1)]
void peaksQuality(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),w=W*S,h=H*S,N=w*h;if(i>=N)return;uint x=i%w,y=i/w;
 bool peak=false;float m=F(7,i);
 if(x>0&&y>0&&x+1<w&&y+1<h&&m>=.10){uint d=A[O(8)+i];uint delta=d==0?1:d==1?w+1:d==2?w:w-1;peak=m>=F(7,i-delta)&&m>=F(7,i+delta);}
 A[O(9)+i]=peak?i:0xffffffff;A[O(10)+i]=0;A[O(11)+i]=0;
}
uint rootQuality(uint i){for(uint k=0;k<64;k++){uint p=A[O(9)+i];if(p==i||p==0xffffffff)return p;i=p;}return i;}
[numthreads(128,1,1)]
void connectQuality(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),w=W*S,h=H*S,N=w*h;if(i>=N||A[O(9)+i]==0xffffffff)return;uint x=i%w,y=i/w;
 for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){
  int xx=int(x)+dx,yy=int(y)+dy;if(xx<=0||yy<=0||xx>=int(w)-1||yy>=int(h)-1)continue;
  uint j=yy*w+xx;if(A[O(9)+j]==0xffffffff)continue;
  uint a=rootQuality(i),b=rootQuality(j);if(a!=b){uint before;InterlockedMin(A[O(9)+max(a,b)],min(a,b),before);if(before>min(a,b))InterlockedOr(A[O(26)],1);}
 }
}
[numthreads(128,1,1)]
void compressQuality(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),N=W*H*S*S;if(i>=N||A[O(9)+i]==0xffffffff)return;
 uint r=rootQuality(i),before;InterlockedMin(A[O(9)+i],r,before);if(before>r)InterlockedOr(A[O(26)],1);
}
[numthreads(128,1,1)]
void componentsQuality(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),N=W*H*S*S;if(i>=N)return;uint r=A[O(9)+i];if(r==0xffffffff)return;
 InterlockedAdd(A[O(10)+r],1);if(F(7,i)>=.24)InterlockedOr(A[O(11)+r],1);
}
[numthreads(128,1,1)]
void connectedQuality(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),N=W*H*S*S;if(i>=N)return;uint r=A[O(9)+i];
 A[O(12)+i]=r!=0xffffffff&&A[O(10)+r]>=3&&A[O(11)+r]!=0?1:0;
}
[numthreads(128,1,1)]
void targetQuality(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),w=W*S,h=H*S,N=w*h;if(i>=N)return;uint x=i%w,y=i/w;bool connected=A[O(12)+i]!=0;
 if(!connected&&x>=2&&y>=2&&x+2<w&&y+2<h&&F(7,i)>=.06){
  connected=(A[O(12)+i-1]&&A[O(12)+i+1])||(A[O(12)+i-w]&&A[O(12)+i+w])||
   (A[O(12)+i-w-1]&&A[O(12)+i+w+1])||(A[O(12)+i-w+1]&&A[O(12)+i+w-1]);
 }
 float xdog=saturate((abs(F(4,i)-F(5,i))-.014)*7),value=max(connected?.98:0,xdog*.95);
 SF(13,i,value<.17?0:value);
}
[numthreads(1,1,1)]
void sceneQuality(uint3 id:SV_DispatchThreadID){
 uint N=W*H*S*S,step=max(1,N/2000);float change=0;
 if(hasOld)for(uint i=0;i<N;i+=step)change+=abs(F(14,i)-F(16,i));
 A[O(27)]=hasOld&&change/ceil(float(N)/step)>.18?1:0;
}
[numthreads(128,1,1)]
void cellsQuality(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),C=W*H;if(i>=C)return;uint x=i%W,y=i/W,w=W*S;
 float energy=0,change=0,cur=0,prior=0,both=0;
 for(uint py=0;py<S;py++)for(uint px=0;px<S;px++){
  uint j=(y*S+py)*w+x*S+px;float v=F(13,j);energy+=v*v;
  if(hasOld&&!A[O(27)]){float old=F(15,j);bool a=v>.22,b=old>.22;change+=abs(v-old);cur+=a?1:0;prior+=b?1:0;both+=a&&b?1:0;}
 }
 SF(21,i*6,energy);SF(21,i*6+1,change/(S*S));SF(21,i*6+2,cur);SF(21,i*6+3,prior);SF(21,i*6+4,both);
}
[numthreads(128,1,1)]
void scoreQuality(uint3 id:SV_DispatchThreadID){
 uint i=threadIndex(id),C=W*H;if(i>=C*G)return;uint cell=i/G,j=i%G,x=cell%W,y=cell/W,cols=A[O(17)+j];
 float loss=1e20;if(x+cols<=W){
  bool noInk=F(21,cell*6)/(S*S)<.014&&(cols==1||F(21,(cell+1)*6)/(S*S)<.014);
  if(noInk&&j!=reserved){SF(22,i,loss);return;}
  float dotValue=0;uint total=cols*S*S,w=W*S;
  for(uint py=0;py<S;py++)for(uint px=0;px<cols*S;px++)dotValue+=F(13,(y*S+py)*w+x*S+px)*F(18,j*2*S*S+py*cols*S+px);
  float energy=F(21,cell*6)+(cols==2?F(21,(cell+1)*6):0);
  bool blank=j==reserved;
  bool empty=F(21,cell*6)/(S*S)<.014&&(cols==1||F(21,(cell+1)*6)/(S*S)<.014);
  if(!empty||blank){
   loss=max(0,(energy+F(19,j)-2*dotValue)/total)+(blank?0:.006);
   uint old=A[O(20)+cell];
   if(!empty&&hasOld&&!A[O(27)]&&old<G&&old!=j){
    float cur=F(21,cell*6+2),prior=F(21,cell*6+3),both=F(21,cell*6+4),change=F(21,cell*6+1);
    if(cols==2){cur+=F(21,(cell+1)*6+2);prior+=F(21,(cell+1)*6+3);both+=F(21,(cell+1)*6+4);change+=F(21,(cell+1)*6+1);}
    float overlap=both/max(1,cur+prior-both);change/=cols;
    if(overlap>.72&&change<.1)loss+=.055*saturate((overlap-.72)/.28)*saturate((.1-change)/.1);
   }
   loss*=cols;
  }
 }
 SF(22,i,loss);
}
groupshared float rowDp[481];
groupshared uint rowChoice[481];
groupshared float rowLoss1[128],rowLoss2[128];
groupshared uint rowGlyph1[128],rowGlyph2[128];
[numthreads(128,1,1)]
void rowsQuality(uint3 group:SV_GroupID,uint lane:SV_GroupIndex){
 uint y=group.x;if(y>=H)return;
 for(uint initX=lane;initX<=W;initX+=128){rowDp[initX]=initX==0?0:1e20;rowChoice[initX]=0xffffffff;}
 GroupMemoryBarrierWithGroupSync();
 for(uint x=0;x<W;x++){
  float prior=rowDp[x],v1=1e20,v2=1e20;uint g1=0xffffffff,g2=0xffffffff;
  for(uint chunk=0;chunk<G;chunk+=128){
   uint j=chunk+lane;
   if(j<G&&prior<1e19){uint cols=A[O(17)+j];
    if(x+cols<=W){float value=prior+F(22,(y*W+x)*G+j);
     if(cols==1){if(value<v1||(value==v1&&j<g1)){v1=value;g1=j;}}
     else if(value<v2||(value==v2&&j<g2)){v2=value;g2=j;}
    }
   }
  }
  rowLoss1[lane]=v1;rowLoss2[lane]=v2;rowGlyph1[lane]=g1;rowGlyph2[lane]=g2;
  GroupMemoryBarrierWithGroupSync();
  for(uint stride=64;stride>0;stride/=2){
   if(lane<stride){uint other=lane+stride;
    if(rowLoss1[other]<rowLoss1[lane]||(rowLoss1[other]==rowLoss1[lane]&&rowGlyph1[other]<rowGlyph1[lane])){rowLoss1[lane]=rowLoss1[other];rowGlyph1[lane]=rowGlyph1[other];}
    if(rowLoss2[other]<rowLoss2[lane]||(rowLoss2[other]==rowLoss2[lane]&&rowGlyph2[other]<rowGlyph2[lane])){rowLoss2[lane]=rowLoss2[other];rowGlyph2[lane]=rowGlyph2[other];}
   }
   GroupMemoryBarrierWithGroupSync();
  }
  if(lane==0){
   if(rowLoss1[0]<rowDp[x+1]){rowDp[x+1]=rowLoss1[0];rowChoice[x+1]=rowGlyph1[0];}
   if(x+2<=W&&rowLoss2[0]<rowDp[x+2]){rowDp[x+2]=rowLoss2[0];rowChoice[x+2]=rowGlyph2[0];}
  }
  GroupMemoryBarrierWithGroupSync();
 }
 if(lane==0){uint backX=W;for(uint step=0;step<W&&backX>0;step++){
  uint glyph=rowChoice[backX];if(glyph>=G){A[O(25)+y*W]=0xfffffffe;return;}
  uint cols=A[O(17)+glyph];backX-=cols;A[O(25)+y*W+backX]=glyph;
  if(cols==2)A[O(25)+y*W+backX+1]=0xffffffff;
 }}
}

