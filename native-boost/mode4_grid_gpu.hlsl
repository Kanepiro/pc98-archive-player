cbuffer Grid : register(b0){uint Cells,Glyphs,Features,Unused;};
StructuredBuffer<float> targets:register(t0);
StructuredBuffer<float> glyphs:register(t1);
RWStructuredBuffer<float> scores:register(u0);
[numthreads(128,1,1)]
void main(uint3 tid:SV_DispatchThreadID){
 uint i=tid.x;if(i>=Cells*Glyphs)return;
 uint c=i/Glyphs,g=i%Glyphs;float loss=0;
 if(Features==1152){
  for(uint j=0;j<576;j++)loss+=.65*glyphs[g*Features+j]*targets[c*Features+j+576]+.35*targets[c*Features+j]*glyphs[g*Features+j+576];
 }else for(uint j=0;j<Features;j++){float d=targets[c*Features+j]-glyphs[g*Features+j];loss+=d*d;}
 scores[i]=loss;
}
