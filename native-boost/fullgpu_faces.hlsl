[numthreads(128,1,1)]
void clearFace(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;if(i>=w*h)return;uint x=i%w,y=i/w;
 float bx=v(21,0),by=v(21,1),bw=v(21,2),bh=v(21,3);
 if(x>=max(0,floor(bx-bw*.10))&&x<min(w,ceil(bx+bw*1.1))&&y>=max(0,floor(by-bh*.10))&&y<min(h,ceil(by+bh*1.13))){
  float d=pow((x-v(21,4))/v(21,6),2)+pow((y-v(21,5))/v(21,7),2);
  if(d<.77){sf(10,i,v(10,i)*.07);sf(15,i,min(v(15,i),1.2));}
 }
}
[numthreads(128,1,1)]
void drawFace(uint3 id:SV_DispatchThreadID){
 uint p=id.x+id.y*65535*128;if(p>=count)return;
 float x=v(21,8+p*4),y=v(21,9+p*4),strength=v(21,10+p*4),priority=v(21,11+p*4);
 for(int yy=max(0,(int)floor(y-2));yy<min((int)h,(int)ceil(y+3));yy++)
 for(int xx=max(0,(int)floor(x-2));xx<min((int)w,(int)ceil(x+3));xx++){
  float d=length(float2(xx+.5-x,yy+.5-y)),s=strength*saturate(1.55-d);
  InterlockedMax(A[o(10)+yy*w+xx],asuint(s));
  InterlockedMax(A[o(15)+yy*w+xx],asuint(priority*clamp(2.5-d*.5,.2,1)));
 }
}
float3 rgbAt(int x,int y,bool border){
 if(border&&(x<0||y<0||x>=int(w)||y>=int(h)))return 0;
 uint pixel=A[o(0)+clamp(y,0,int(h)-1)*w+clamp(x,0,int(w)-1)];
 return float3(pixel&255,(pixel>>8)&255,(pixel>>16)&255);
}
[numthreads(128,1,1)]
void visionPreprocess(uint3 id:SV_DispatchThreadID){
 uint i=id.x+id.y*65535*128;
 if(i<128*128){
  float scale=128.0/max(w,h),tx=(128-w*scale)*.5,ty=(128-h*scale)*.5;
  float2 uv=(float2(i%128,i/128)-float2(tx,ty))/scale;
  // OpenCV INTER_LINEAR affine uses a 1/32-pixel interpolation table.
  uv=round(uv*32)/32;int2 base=(int2)floor(uv);float2 f=uv-base;
  float3 rgb=lerp(lerp(rgbAt(base.x,base.y,true),rgbAt(base.x+1,base.y,true),f.x),
   lerp(rgbAt(base.x,base.y+1,true),rgbAt(base.x+1,base.y+1,true),f.x),f.y);
  rgb=floor(rgb+.5)/127.5-1;
  sf(3,i*3,rgb.x);sf(3,i*3+1,rgb.y);sf(3,i*3+2,rgb.z);
 }
 if(i<320*320){
  float2 uv=(float2(i%320,i/320)+.5)*float2(w,h)/320-.5;
  int2 base=(int2)floor(uv);float2 f=uv-base;
  float3 rgb=lerp(lerp(rgbAt(base.x,base.y,false),rgbAt(base.x+1,base.y,false),f.x),
   lerp(rgbAt(base.x,base.y+1,false),rgbAt(base.x+1,base.y+1,false),f.x),f.y);
  uint3 c=(uint3)floor(rgb+.5);A[o(10)+i]=c.x|(c.y<<8)|(c.z<<16)|0xff000000;
 }
}
