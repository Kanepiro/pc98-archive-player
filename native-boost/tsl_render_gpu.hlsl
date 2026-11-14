StructuredBuffer<uint> atlas:register(t0);
StructuredBuffer<uint> cells:register(t1);
RWStructuredBuffer<uint> pixels:register(u0);
cbuffer Params:register(b0){uint W,H,CW,CH;uint pixelCount,groupsX,pad0,pad1;};
[numthreads(128,1,1)]
void main(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*groupsX*128;if(i>=pixelCount)return;
 uint width=W*CW,x=i%width,y=i/width;
 uint code=cells[(y/CH)*W+x/CW],glyph=code/2,half=code%2;
 pixels[i]=atlas[glyph*2*CW*CH+(y%CH)*2*CW+half*CW+x%CW];
}
