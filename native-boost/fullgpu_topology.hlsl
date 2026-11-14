// Original semantic priority and connected-component pruning on the GPU.
float region(uint r,uint k){return v(21,r*24+k);}
[numthreads(128,1,1)]
void semanticPriority(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;
 uint x=i%w,y=i/w;bool hasFace=false,hasSubject=false;int mainFace=-1;float confidence=-1;
 for(uint r=0;r<count;r++){
  uint kind=(uint)region(r,0);hasFace|=kind==1;hasSubject|=kind==1||kind==2;
  if(kind==1&&region(r,5)>=.6&&region(r,5)>confidence){mainFace=r;confidence=region(r,5);}
 }
 float value=v(10,i),priority=hasSubject?.24:.70;
 if(mainFace>=0){
  uint r=mainFace;float cx=(region(r,1)+region(r,3)*.5)*w,cy=(region(r,2)+region(r,4)*.71)*h;
  float rx=max(4,region(r,3)*w*1.02),ry=max(4,region(r,4)*h*1.52);
  float d=pow((x-cx)/rx,2)+pow((y-cy)/ry,2);
  if(d>1.4){value*=.06;priority=min(priority,.22);}else if(d>1){value*=.30;priority*=.60;}
 }
 for(uint r=0;r<count;r++){
  uint kind=(uint)region(r,0);if(hasSubject&&kind==0)continue;
  float bx=region(r,1),by=region(r,2),bw=region(r,3),bh=region(r,4);
  int x0=max(0,(int)floor((bx-.035)*w)),x1=min((int)w,(int)ceil((bx+bw+.035)*w));
  int y0=max(0,(int)floor((by-.035)*h)),y1=min((int)h,(int)ceil((by+bh+.035)*h));
  if(int(x)>=x0&&int(x)<x1&&int(y)>=y0&&int(y)<y1){
   float dx=(x-(bx+bw*.5)*w)/max(2,bw*w*.7),dy=(y-(by+bh*.5)*h)/max(2,bh*h*.7);
   float env=saturate(1.35-dx*dx-dy*dy);
   float base=kind==1?1.35:kind==2&&region(r,7)==1&&hasFace?.46:.68;
   float boost=kind==1?2.4:kind==2&&region(r,7)==1&&hasFace?.52:1.35;
   priority=max(priority,base+boost*env);
  }
  if(kind==1){
   float rr=max(2,min(bw*w,bh*h)*.095);
   for(uint k=0;k<(uint)region(r,8);k++){
    float px=region(r,9+k*2)*w,py=region(r,10+k*2)*h;
    if(x>=max(0,floor(px-rr*2))&&x<min(w,ceil(px+rr*2))&&y>=max(0,floor(py-rr*2))&&y<min(h,ceil(py+rr*2))){
     float d=(pow(x-px,2)+pow(y-py,2))/(rr*rr);priority=max(priority,1.25+2.4*exp(-d*.9));
    }
   }
  }
 }
 sf(10,i,value);sf(15,i,priority);
 A[o(7)+i]=value>.22?i:0xffffffff;A[o(8)+i]=0;A[o(16)+i]=0;A[o(23)+i]=0;
 A[o(17)+i]=w;A[o(18)+i]=h;A[o(19)+i]=0;A[o(20)+i]=0;
}
[numthreads(128,1,1)]
void topologyStats(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;uint r=A[o(7)+i];if(r==0xffffffff)return;
 InterlockedAdd(A[o(8)+r],1);
 uint amount=(uint)round(v(15,i)*4096),before;InterlockedAdd(A[o(16)+r],amount,before);
 if(before>0xffffffff-amount)InterlockedAdd(A[o(23)+r],1);
 InterlockedMin(A[o(17)+r],i%w);InterlockedMin(A[o(18)+r],i/w);
 InterlockedMax(A[o(19)+r],i%w);InterlockedMax(A[o(20)+r],i/w);
}
[numthreads(128,1,1)]
void pruneTopology(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;uint r=A[o(7)+i];bool major=false;
 if(r!=0xffffffff){
  uint size=A[o(8)+r],span=max(A[o(19)+r]-A[o(17)+r],A[o(20)+r]-A[o(18)+r])+1;
  float priority=(float(A[o(16)+r])+float(A[o(23)+r])*4294967296.0)/(4096*float(size));
  major=(size>=max(8,(uint)floor(min(w,h)*.085))&&span>=max(7,(uint)floor(min(w,h)*.058)))||(priority>=2.1&&size>=3);
  if(major){sf(15,i,v(15,i)*(1+min(.55,span/max(1,min(w,h)*.7))));}
  else sf(10,i,0);
 }
 A[o(22)+i]=major?1:0;
 // Roots used only for diagnostics; no CPU connected-component walk.
 if(major&&r==i)InterlockedAdd(A[o(13)+2],1);
}
uint degree(uint i){return A[o(7)+i-w]+A[o(7)+i-w+1]+A[o(7)+i+1]+A[o(7)+i+w+1]+A[o(7)+i+w]+A[o(7)+i+w-1]+A[o(7)+i-1]+A[o(7)+i-w-1];}
[numthreads(128,1,1)]
void junctionPriority(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;uint x=i%w,y=i/w;float priority=v(15,i);
 for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){
  int xx=int(x)+dx,yy=int(y)+dy;if(xx<=0||yy<=0||xx>=int(w)-1||yy>=int(h)-1)continue;
  uint j=yy*w+xx;if(!A[o(7)+j])continue;uint d=degree(j);
  if(d<=1||d>=3)priority=max(priority,d<=1?1.38:1.45);
 }
 sf(15,i,priority);
}
