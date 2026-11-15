cbuffer Grid : register(b0){uint Cells,Glyphs,Features,Unused;};
StructuredBuffer<float> targets:register(t0);
StructuredBuffer<float> glyphs:register(t1);
RWStructuredBuffer<float> scores:register(u0);
[numthreads(128,1,1)]
void main(uint3 tid:SV_DispatchThreadID){
 uint i=tid.x;if(i>=Cells*Glyphs)return;
 uint c=i/Glyphs,g=i%Glyphs;float loss=0;
 for(uint j=0;j<Features;j++){float d=targets[c*Features+j]-glyphs[g*Features+j];loss+=d*d;}
 scores[i]=loss;
}
