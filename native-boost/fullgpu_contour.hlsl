RWStructuredBuffer<uint> A:register(u0);
cbuffer Params:register(b0){
 uint w,h,op,stage;
 uint source,destination,axis,count;
 float brightness,contrast,gamma,reserved;
};
uint o(uint k){return A[k];}
float v(uint slot,uint k){return asfloat(A[o(slot)+k]);}
void sf(uint slot,uint k,float f){A[o(slot)+k]=asuint(f);}
[numthreads(128,1,1)]
void normalize(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;uint p=A[o(0)+i],n=w*h;
 float3 rgb=float3(p&255,(p>>8)&255,(p>>16)&255)/255;
 rgb=pow(saturate((rgb-.5)*contrast+.5+brightness/100),gamma.xxx);
 float g=dot(rgb,float3(.2126,.7152,.0722));
 sf(1,i,rgb.x);sf(1,n+i,rgb.y);sf(1,n*2+i,rgb.z);sf(1,n*3+i,g);sf(3,i,g);
}
[numthreads(128,1,1)]
void blur(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128,n=w*h;if(i>=n*count)return;
 uint c=i/n,p=i%n,x=p%w,y=p/w;
 uint left=axis==0?y*w+max(1,x)-1:max(1,y)*w-w+x;
 uint right=axis==0?y*w+min(w-1,x+1):min(h-1,y+1)*w+x;
 sf(destination,i,(v(source,c*n+left)+2*v(source,i)+v(source,c*n+right))*.25);
}
[numthreads(128,1,1)]
void grayCopy(uint3 id:SV_DispatchThreadID){uint i=id.x+id.y*65535*128;if(i<w*h)sf(4,i,v(1,3*w*h+i));}
float2 sobel(uint c,uint i){
 uint n=w*h;float a=v(1,c*n+i-w-1),b=v(1,c*n+i-w),cc=v(1,c*n+i-w+1);
 float d=v(1,c*n+i-1),f=v(1,c*n+i+1),g=v(1,c*n+i+w-1),hh=v(1,c*n+i+w),j=v(1,c*n+i+w+1);
 return float2(cc+2*f+j-a-2*d-g,g+2*hh+j-a-2*b-cc)*.125;
}
[numthreads(128,1,1)]
void gradient(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;uint x=i%w,y=i/w;
 if(x==0||y==0||x+1==w||y+1==h){sf(5,i,0);return;}
 float best=0;float2 direction=0;
 for(uint k=0;k<4;k++){
  uint c=k==0?3:k-1;float2 d=sobel(c,i);float m=dot(d,d);
  if(m>best){best=m;direction=d;}
 }
 float mag=sqrt(best);sf(5,i,mag);InterlockedMax(A[o(13)],asuint(mag));
 float angle=fmod(atan2(direction.y,direction.x)*57.2957795131+180,180);
 A[o(6)+i]=angle<22.5||angle>=157.5?0:angle<67.5?1:angle<112.5?2:3;
}
[numthreads(128,1,1)]
void peaks(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;uint x=i%w,y=i/w;float m=v(5,i);
 float low=max(.036,min(.095,v(13,0)*.13));
 uint direction=A[o(6)+i],delta=direction==0?1:direction==1?w+1:direction==2?w:w-1;
 bool peak=x>0&&y>0&&x+1<w&&y+1<h&&m>=low&&m>=v(5,i-delta)&&m>=v(5,i+delta);
 A[o(7)+i]=peak?i:0xffffffff;A[o(8)+i]=0;A[o(9)+i]=0;
}
uint root(uint i){
 for(uint k=0;k<64;k++){uint p=A[o(7)+i];if(p==i||p==0xffffffff)return p;i=p;}
 return i;
}
[numthreads(128,1,1)]
void connect(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h||A[o(7)+i]==0xffffffff)return;
 uint x=i%w,y=i/w;
 for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){
  int xx=int(x)+dx,yy=int(y)+dy;if(op==4?(xx<0||yy<0||xx>=int(w)||yy>=int(h)):(xx<=0||yy<=0||xx>=int(w)-1||yy>=int(h)-1))continue;
  uint j=yy*w+xx;if(A[o(7)+j]==0xffffffff)continue;
  uint a=root(i),b=root(j);if(a!=b){
   uint prior;InterlockedMin(A[o(7)+max(a,b)],min(a,b),prior);
   if(prior>min(a,b))InterlockedOr(A[o(13)+1],1);
  }
 }
}
[numthreads(128,1,1)]
void compress(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h||A[o(7)+i]==0xffffffff)return;
 uint r=root(i),prior;InterlockedMin(A[o(7)+i],r,prior);
 if(prior>r)InterlockedOr(A[o(13)+1],1);
}
[numthreads(128,1,1)]
void componentStats(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;uint r=A[o(7)+i];if(r==0xffffffff)return;
 InterlockedAdd(A[o(8)+r],1);
 float high=max(.105,min(.21,v(13,0)*.31));
 if(v(5,i)>=high)InterlockedOr(A[o(9)+r],1);
}
[numthreads(128,1,1)]
void target(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;uint r=A[o(7)+i];
 bool connected=r!=0xffffffff&&A[o(8)+r]>=3&&A[o(9)+r]!=0;
 float dog=max(0,abs(v(1,3*w*h+i)-v(4,i))-.016)*5.5;
 float edge=connected?max(.76,saturate(v(5,i)*4)):0;
 float value=max(edge,dog*.70);sf(10,i,value<.18?0:min(1,value));
}
[numthreads(128,1,1)]
void distanceField(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;int x=i%w,y=i/w;float d=5;
 for(int dy=-4;dy<=4;dy++)for(int dx=-4;dx<=4;dx++){
  int xx=x+dx,yy=y+dy;
  float metric=max(abs(dx),abs(dy))+.41421356*min(abs(dx),abs(dy));
  if(xx>=0&&yy>=0&&xx<int(w)&&yy<int(h)&&metric<d&&v(10,yy*w+xx)>.22)d=metric;
 }
 sf(11,i,d);
}
[numthreads(128,1,1)]
void thin(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;uint x=i%w,y=i/w;
 uint value=A[o(source)+i];bool remove=false;
 if(stage!=2&&value&&x>0&&y>0&&x+1<w&&y+1<h){
  uint p2=A[o(source)+i-w],p3=A[o(source)+i-w+1],p4=A[o(source)+i+1],p5=A[o(source)+i+w+1];
  uint p6=A[o(source)+i+w],p7=A[o(source)+i+w-1],p8=A[o(source)+i-1],p9=A[o(source)+i-w-1];
  uint neighbours=p2+p3+p4+p5+p6+p7+p8+p9;
  uint cross=(!p2&&p3)+(!p3&&p4)+(!p4&&p5)+(!p5&&p6)+(!p6&&p7)+(!p7&&p8)+(!p8&&p9)+(!p9&&p2);
  remove=neighbours>=2&&neighbours<=6&&cross==1&&
   (stage==0?(!p2||!p4||!p6)&&(!p4||!p6||!p8):(!p2||!p4||!p8)&&(!p2||!p6||!p8));
 }
 A[o(destination)+i]=remove?0:value;
}

#include "fullgpu_topology.hlsl"
