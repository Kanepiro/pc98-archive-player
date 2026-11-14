StructuredBuffer<uint> atlas:register(t0);
StructuredBuffer<uint> cells:register(t1);
RWStructuredBuffer<uint> pixels:register(u0);
cbuffer Params:register(b0){
 uint W,H,CW,CH;uint wordCount,groupsX,OW,OH;
 uint fitW,fitH,left,top;uint nv12,byteCount,pad0,pad1;
};
uint samplePixel(uint x,uint y){
 if(x<left||y<top||x>=left+fitW||y>=top+fitH)return 0x00080d12;
 x=min(W*CW-1,(uint)((x-left+.5)*(W*CW)/fitW));
 y=min(H*CH-1,(uint)((y-top+.5)*(H*CH)/fitH));
 uint code=cells[(y/CH)*W+x/CW],glyph=code/2,half=code%2;
 return atlas[glyph*2*CW*CH+(y%CH)*2*CW+half*CW+x%CW];
}
float3 rgb(uint x,uint y){uint c=samplePixel(x,y);return float3((c>>16)&255,(c>>8)&255,c&255);}
uint videoByte(uint i){
 if(i>=byteCount)return 0;
 uint n=OW*OH;
 if(i<n){float3 c=rgb(i%OW,i/OW);return (uint)clamp(round(16+dot(c,float3(.256788,.504129,.097906))),16,235);}
 uint k=i-n,x=(k%OW)&~1,y=(k/OW)*2;
 float3 c=(rgb(x,y)+rgb(x+1,y)+rgb(x,y+1)+rgb(x+1,y+1))*.25;
 float value=128+dot(c,(k&1)?float3(.439216,-.367788,-.071427):float3(-.148223,-.290993,.439216));
 return (uint)clamp(round(value),16,240);
}
[numthreads(128,1,1)]
void main(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*groupsX*128;if(i>=wordCount)return;
 if(!nv12)pixels[i]=samplePixel(i%OW,i/OW);
 else pixels[i]=videoByte(i*4)|(videoByte(i*4+1)<<8)|(videoByte(i*4+2)<<16)|(videoByte(i*4+3)<<24);
}
