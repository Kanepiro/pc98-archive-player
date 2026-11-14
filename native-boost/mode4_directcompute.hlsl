// TASL Mode 4 DIRECTCOMPUTE — candidate placementLoss from the ORIGINAL
// tsl-artisan-engine.js. GPU float32 glyph scores may differ from CPU float64.
// No alternate grayscale/character-ramp or text composition is implemented.
// cs_5_0 is supported by NVIDIA GeForce GTX 1050 Ti (Pascal).
StructuredBuffer<float> frame : register(t0);
StructuredBuffer<float> orientations : register(t1);
StructuredBuffer<int> previousGlyph : register(t2);
StructuredBuffer<float> faceRegions : register(t3);
StructuredBuffer<int> glyphMeta : register(t4);
StructuredBuffer<float> glyphMetaFloat : register(t5);
StructuredBuffer<float> glyphMasks : register(t6);
RWStructuredBuffer<float> outScores : register(u0);

cbuffer Params : register(b0) {
 uint W, H, S, G;
 uint N, C, F, hasOld;
 uint cut, groupsX, perGlyph, unused;
};

[numthreads(64,1,1)]
void main(uint3 thread : SV_DispatchThreadID) {
 uint idx=thread.y * groupsX * 64u + thread.x;
 uint total=C*G;
 if(idx>=total)return;
 uint g=idx%G;
 uint cell=idx/G;
 uint x=cell%W, y=cell/W;
 uint cols=(uint)glyphMeta[g];
 if(x+cols>W){outScores[idx]=1e20;return;}
 uint count=cols*S*S;
 uint glyphBase=g*perGlyph;
 uint rowStart=y*S*(W*S)+x*S;
 float sum=0.0,missing=0.0,extra=0.0,direct=0.0;
 [loop] for(uint sy=0;sy<S;sy++){
  uint row=rowStart+sy*W*S;
  uint mrow=glyphBase+sy*cols*S;
  [loop]for(uint sx=0;sx<cols*S;sx++){
   uint pos=row+sx,mid=mrow+sx;
   float t=frame[pos];
   float m=glyphMasks[mid];
   float importance=frame[N+pos];
   float priority=importance!=0?importance:1.0;
   float distance=frame[2u*N+pos];
   float expanded=glyphMasks[G*perGlyph+mid];
   sum+=t*priority;
   missing+=priority*t*(1.0-expanded);
   extra+=min(1.9,priority)*m*min(1.0,distance/2.4);
   direct+=priority*(t-m)*(t-m);
  }
 }
 float density=sum/(float)count;
 if(g!=0 && density<.008){outScores[idx]=1e20;return;}
 float score=(1.85*missing+.62*extra+.19*direct)/(float)count;
 if(g!=0 && sum>.5){
  float delta=0.0;
  uint h=cell*8u+(cols==2u?4u:0u);
  [unroll]for(uint j=0;j<4;j++)
   delta+=abs(glyphMetaFloat[G+4*g+j]-orientations[h+j]);
  score+=.038*min(1.0,density*13.0)*delta;
 }
 if(g!=0){
  score+=.0025+glyphMetaFloat[g];
  if(glyphMeta[G+g]==0 && F>0){
   float cx=((float)x+(float)cols*.5)/(float)W;
   float cy=((float)y+.5)/(float)H;
   [loop]for(uint j=0;j<F;j++){
    float fx=faceRegions[j*4],fy=faceRegions[j*4+1];
    float fw=faceRegions[j*4+2],fh=faceRegions[j*4+3];
    if(cx>=fx-fw*.15 && cx<=fx+fw*1.15 &&
       cy>=fy-fh*.2 && cy<=fy+fh*1.25){score+=.07;break;}
   }
  }
 }
 if(cut==0&&hasOld!=0&&previousGlyph[cell]==int(g)){
  float drift=0.0;
  [loop]for(uint py=0;py<S;py++){
   uint row=rowStart+py*W*S;
   [loop]for(uint px=0;px<cols*S;px++){
    uint pos=row+px;
    drift+=abs(frame[3u*N+pos]-frame[4u*N+pos]);
   }
  }
  if(drift/(float)count<.065&&density>.025)score-=.004;
 }
 outScores[idx]=max(0.0,score);
}
