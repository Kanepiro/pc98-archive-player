RWStructuredBuffer<uint> A:register(u0);
cbuffer Parameters:register(b0){uint nf,no,inputOffset,outputOffset;};
groupshared float bestScore[128];
groupshared uint bestId[128];
groupshared float weights[128];
groupshared float weighted[2048];
groupshared uint selected,finished,resultCount;
groupshared float selectedScore;
float read(uint i){return asfloat(A[i]);}
float overlap(uint base,uint dim,uint a,uint b){
 float2 ac=float2(read(base+a*dim),read(base+a*dim+1)),asize=float2(read(base+a*dim+2),read(base+a*dim+3));
 float2 bc=float2(read(base+b*dim),read(base+b*dim+1)),bs=float2(read(base+b*dim+2),read(base+b*dim+3));
 float2 lo=max(ac-asize*.5,bc-bs*.5),hi=min(ac+asize*.5,bc+bs*.5);
 float2 extent=max(0,hi-lo);float area=extent.x*extent.y;
 return area/max(1e-9,asize.x*asize.y+bs.x*bs.y-area);
}
[numthreads(128,1,1)]
void main(uint tid:SV_GroupIndex,uint3 group:SV_GroupID){
 bool face=group.x==0;uint count=face?nf:no,dim=face?16:4;
 uint base=inputOffset+(face?0:nf*17),scores=base+count*dim,classes=scores+count;
 uint outBase=outputOffset+2+(face?0:nf*17),maxResults=face?nf:6;
 float threshold=face?.55:.36;
 if(tid==0){resultCount=0;finished=0;}GroupMemoryBarrierWithGroupSync();
 for(uint round=0;round<maxResults;round++){
  float score=-1;uint index=0xffffffff;
  for(uint k=tid;k<count;k+=128){float s=read(scores+k);if(s>=threshold&&(s>score||(s==score&&k<index))){score=s;index=k;}}
  bestScore[tid]=score;bestId[tid]=index;GroupMemoryBarrierWithGroupSync();
  for(uint stride=64;stride>0;stride/=2){
   if(tid<stride&&(bestScore[tid+stride]>bestScore[tid]||(bestScore[tid+stride]==bestScore[tid]&&bestId[tid+stride]<bestId[tid]))){
    bestScore[tid]=bestScore[tid+stride];bestId[tid]=bestId[tid+stride];
   }GroupMemoryBarrierWithGroupSync();
  }
  if(tid==0){selected=bestId[0];selectedScore=bestScore[0];finished=selected==0xffffffff;}
  GroupMemoryBarrierWithGroupSync();
  if(finished)break;
  if(face){
   float sumWeight=0,values[16];for(uint d=0;d<16;d++)values[d]=0;
   for(uint k=tid;k<count;k+=128){
    float s=read(scores+k);
    if(s>=threshold&&(k==selected||overlap(base,dim,selected,k)>.3)){
     sumWeight+=s;for(uint d=0;d<16;d++)values[d]+=read(base+k*dim+d)*s;
     A[scores+k]=asuint(-1.0);
    }
   }
   weights[tid]=sumWeight;for(uint d=0;d<16;d++)weighted[d*128+tid]=values[d];
   GroupMemoryBarrierWithGroupSync();
   for(uint stride=64;stride>0;stride/=2){
    if(tid<stride){weights[tid]+=weights[tid+stride];for(uint d=0;d<16;d++)weighted[d*128+tid]+=weighted[d*128+tid+stride];}
    GroupMemoryBarrierWithGroupSync();
   }
   if(tid<16)A[outBase+resultCount*17+tid]=asuint(weighted[tid*128]/max(weights[0],1e-9));
   if(tid==0)A[outBase+resultCount*17+16]=asuint(selectedScore);
  }else{
   if(tid<4)A[outBase+resultCount*6+tid]=A[base+selected*4+tid];
   if(tid==0){A[outBase+resultCount*6+4]=asuint(selectedScore);A[outBase+resultCount*6+5]=A[classes+selected];}
   for(uint k=tid;k<count;k+=128)if(k==selected||overlap(base,dim,selected,k)>.3)A[scores+k]=asuint(-1.0);
  }
  DeviceMemoryBarrierWithGroupSync();
  if(tid==0)resultCount++;GroupMemoryBarrierWithGroupSync();
 }
 if(tid==0)A[outputOffset+group.x]=resultCount;
}
