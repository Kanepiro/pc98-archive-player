#ifndef SCORE_GROUP
#define SCORE_GROUP 128
#endif
#ifndef SCORING_STRATEGY
#define SCORING_STRATEGY 2
#endif
#ifndef SAFE_PRUNE
#define SAFE_PRUNE 1
#endif
cbuffer Params:register(b0){uint Cells,Glyphs,Features;float Cutoff;};
StructuredBuffer<float> targets:register(t0);
StructuredBuffer<float> glyphs:register(t1);
RWStructuredBuffer<float> scores:register(u0);
RWStructuredBuffer<uint2> winners:register(u1);
groupshared float targetCache[1152];
[numthreads(SCORE_GROUP,1,1)]
void score(uint3 group:SV_GroupID,uint lane:SV_GroupIndex){
 uint groupLinear=group.x+group.y*65535,groups=(Glyphs+SCORE_GROUP-1)/SCORE_GROUP;
 uint c=groupLinear/groups,g=(groupLinear%groups)*SCORE_GROUP+lane;if(c>=Cells)return;
 if(SCORING_STRATEGY==2){for(uint j=lane;j<1152;j+=SCORE_GROUP)targetCache[j]=targets[c*1152+j];GroupMemoryBarrierWithGroupSync();}
 if(g>=Glyphs)return;float loss=0;
 for(uint j=0;j<576;j++){
  float w=SCORING_STRATEGY==1?glyphs[g*Features+j]:glyphs[j*2048+g];
  float d=SCORING_STRATEGY==1?glyphs[g*Features+j+576]:glyphs[(j+576)*2048+g];
  float tw=SCORING_STRATEGY==2?targetCache[j]:targets[c*Features+j];
  float td=SCORING_STRATEGY==2?targetCache[j+576]:targets[c*Features+j+576];
  loss+=.5*w*td+.5*tw*d;
#if SAFE_PRUNE
  // Every term is nonnegative. A rejected partial sum cannot become accepted.
  // Diagnostics use +infinity and retain the full original score and tie order.
  if((j&15)==15&&loss>Cutoff)break;
#endif
 }
 scores[c*Glyphs+g]=loss;
}
groupshared float bestLoss[256];
groupshared uint bestIndex[256];
[numthreads(256,1,1)]
void reduce(uint3 group:SV_GroupID,uint lane:SV_GroupIndex){
 uint c=group.x,id=0xffffffff;float best=3.402823466e+38;
 for(uint g=lane;g<Glyphs;g+=256){float v=scores[c*Glyphs+g];if(v<best||(v==best&&g<id)){best=v;id=g;}}
 bestLoss[lane]=best;bestIndex[lane]=id;GroupMemoryBarrierWithGroupSync();
 for(uint step=128;step;step/=2){if(lane<step){float v=bestLoss[lane+step];uint i=bestIndex[lane+step];if(v<bestLoss[lane]||(v==bestLoss[lane]&&i<bestIndex[lane])){bestLoss[lane]=v;bestIndex[lane]=i;}}GroupMemoryBarrierWithGroupSync();}
 if(lane==0)winners[c]=uint2(bestIndex[0],asuint(bestLoss[0]));
}
