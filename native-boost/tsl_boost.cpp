// TASL PC Boost: independently implemented native C++ frame-to-TSL engine.
// stdin: stream of RGB24 frames at (ceil(columns/2)*8) x (rows*8).
// All video decoding is delegated to the local FFmpeg process (sequential, no seeks).
// Unlike the browser converter, this path uses a fast contour/glyph-feature algorithm.
#include "glyphs.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

using std::string;
struct Options {
  string output, mode="artisan";
  int width=0,height=0,count=0,ticks=0;
  bool native16=false;
  double brightness=0,contrast=1,gamma=1,edge=0.6;
};
static int toInt(const char* s){return std::stoi(s);}
static double toDouble(const char* s){return std::stod(s);}
static Options parse(int argc,char** argv){
  Options a;
  for(int i=1;i<argc;i++){
    const string key=argv[i];
    if(i+1>=argc)throw std::runtime_error("missing value for "+key);
    const string val=argv[++i];
    if(key=="--output")a.output=val;
    else if(key=="--mode")a.mode=val;
    else if(key=="--width")a.width=toInt(val.c_str());
    else if(key=="--height")a.height=toInt(val.c_str());
    else if(key=="--count")a.count=toInt(val.c_str());
    else if(key=="--ticks")a.ticks=toInt(val.c_str());
    else if(key=="--brightness")a.brightness=toDouble(val.c_str());
    else if(key=="--contrast")a.contrast=toDouble(val.c_str());
    else if(key=="--gamma")a.gamma=toDouble(val.c_str());
    else if(key=="--edge")a.edge=toDouble(val.c_str());
    else if(key=="--native16")a.native16=val=="1";
    else throw std::runtime_error("unrecognized option "+key);
  }
  if(a.output.empty()||a.width<4||a.width>480||a.height<4||a.height>240||
     a.count<1||a.count>10000||a.ticks<a.count||a.ticks>432000||
     (a.mode!="legacy"&&a.mode!="halftone"&&a.mode!="quality"&&a.mode!="artisan")||
     a.brightness<-100||a.brightness>100||a.contrast<.25||a.contrast>3||
     a.gamma<.4||a.gamma>2.5||a.edge<0||a.edge>1)
    throw std::runtime_error("invalid conversion settings");
  return a;
}
static inline float clamp(float x){return std::max(0.0f,std::min(x,1.0f));}
static void header(std::ofstream& o,const Options& a){
  o<<"1.08\r\n"<<a.count<<"\r\n"<<a.width<<"\r\n"<<a.height
    <<"\r\n1\r\n-1\r\nVideo conversion - PC Native Boost\r\n";
  if(a.native16)o<<"# PC98_FONT_16X16\r\n";
  o<<"\f\r\n";
  for(int i=0;i<a.count;i++){
    const int start=(int)std::llround(double(i)*a.ticks/a.count);
    const int end=(int)std::llround(double(i+1)*a.ticks/a.count);
    o<<i+1<<" "<<end-start<<"\r\n";
  }
  o<<"0 0\r\n\f\r\n";
}
static void emitGlyph(std::ofstream& o,int code){
  if(code<0){o.put(' ');return;}
  o.put(char(GLYPHS[code].lead));o.put(char(GLYPHS[code].trail));
}
static int glyphCount(){return (int)(sizeof(GLYPHS)/sizeof(GLYPHS[0]));}
int main(int argc,char** argv){
  try{
    const Options a=parse(argc,argv);
#ifdef _WIN32
    _setmode(_fileno(stdin),_O_BINARY);
#endif
    const int fullWidth=(a.width+1)/2, W=fullWidth*8,H=a.height*8;
    const size_t n=size_t(W)*H,bytes=n*3;
    std::vector<unsigned char> raw(bytes);
    std::vector<float> gray(n),edge(n);
    std::vector<int> prior(size_t(fullWidth)*a.height,-1);
    std::ofstream output(a.output,std::ios::binary);
    if(!output)throw std::runtime_error("cannot open destination");
    header(output,a);
    static constexpr char RAMP[]=" .:|/(%YVO8D@0#$";
    static constexpr unsigned char TONES[5][2]={{0x81,0x40},{0x81,0x42},
      {0x82,0x8f},{0x81,0x9b},{0x81,0x9d}};
    static constexpr int BAYER[16]={0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5};
    float atlas[64][16]={},atlasNorm[64]={},atlasInk[64]={};
    if(glyphCount()>64)throw std::runtime_error("glyph table is too large");
    for(int g=0;g<glyphCount();g++){
      for(int t=0;t<16;t++){
        atlas[g][t]=GLYPHS[g].mask[t]/255.0f;
        atlasNorm[g]+=atlas[g][t]*atlas[g][t];
        atlasInk[g]+=atlas[g][t];
      }
    }
    int complete=0;
    for(int frame=0;frame<a.count;frame++){
      std::cin.read(reinterpret_cast<char*>(raw.data()),std::streamsize(bytes));
      if(std::cin.gcount()!=std::streamsize(bytes)){
        // FFmpeg can emit fewer frames for odd timestamps. Reuse the final decoded
        // image, preserving the duration and the explicit TSL timing schedule.
        if(complete==0)throw std::runtime_error("no complete video frames decoded");
        if(std::cin.gcount()!=0)throw std::runtime_error("truncated RGB frame");
      }else{
        for(size_t i=0;i<n;i++){
          const size_t p=i*3;
          float v=(.2126f*raw[p]+.7152f*raw[p+1]+.0722f*raw[p+2])/255.0f;
          v=clamp((v-.5f)*(float)a.contrast+.5f+(float)(a.brightness/100));
          gray[i]=std::pow(v,(float)a.gamma);
        }
        if(a.mode=="artisan"||a.mode=="quality"){
          for(int y=0;y<H;y++)for(int x=0;x<W;x++){
            const int i=y*W+x,l=y*W+std::max(0,x-1),
                r=y*W+std::min(W-1,x+1),
                t=std::max(0,y-1)*W+x,
                b=std::min(H-1,y+1)*W+x;
            // Preserve chromatic boundaries even when adjacent pixels have
            // similar luminance. This is native, rather than browser WebGPU.
            float lum=std::abs(gray[r]-gray[l])+std::abs(gray[b]-gray[t]);
            float chroma=0;
            for(int c=0;c<3;c++){
              const float dx=std::abs(int(raw[3*r+c])-int(raw[3*l+c]))/255.0f;
              const float dy=std::abs(int(raw[3*b+c])-int(raw[3*t+c]))/255.0f;
              chroma=std::max(chroma,std::max(dx,dy));
            }
            edge[i]=clamp((lum*.85f+chroma*.55f)*2.2f);
          }
        }
      }
      if(a.mode=="legacy"){
        for(int y=0;y<a.height;y++){
          for(int x=0;x<a.width;x++){
            float sum=0;
            for(int dy=0;dy<8;dy++)for(int dx=0;dx<4;dx++)
              sum+=gray[(y*8+dy)*W+x*4+dx];
            const int index=std::max(0,std::min(15,int(std::round(sum/32*15))));
            output.put(RAMP[index]);
          }
          output<<"\r\n";
        }
      }else if(a.mode=="halftone"){
        for(int y=0;y<a.height;y++){
          for(int x=0;x<a.width/2;x++){
            float sum=0;
            for(int dy=0;dy<8;dy++)for(int dx=0;dx<8;dx++)
              sum+=gray[(y*8+dy)*W+x*8+dx];
            float dither=(BAYER[(y%4)*4+(x%4)]-7.5f)/16.0f*.08f;
            const float level=clamp(1.0f-sum/64+dither);
            const int tone=std::min(4,int(level*5));
            output.put(char(TONES[tone][0]));output.put(char(TONES[tone][1]));
          }
          if(a.width%2)output.put(' ');
          output<<"\r\n";
        }
      }else{
        for(int y=0;y<a.height;y++){
          for(int x=0;x<fullWidth;x++){
            float target[16]={};float energy=0;
            for(int ty=0;ty<4;ty++)for(int tx=0;tx<4;tx++){
              float v=0;
              for(int yy=0;yy<2;yy++)for(int xx=0;xx<2;xx++)
                v+=edge[(y*8+ty*2+yy)*W+x*8+tx*2+xx];
              target[ty*4+tx]=v*.25f;
              energy+=v*.25f;
            }
            if(energy<1.0f){output.put(' ');if(!(x==fullWidth-1&&(a.width%2)))output.put(' ');prior[y*fullWidth+x]=-1;continue;}
            float best=std::numeric_limits<float>::max();int chosen=-1;
            float targetNorm=0;
            for(float v:target)targetNorm+=v*v;
            for(int g=0;g<glyphCount();g++){
              float dot=0;
              for(int t=0;t<16;t++)dot+=target[t]*atlas[g][t];
              // Scale-invariant edge-shape matching, with small complexity cost.
              float err=targetNorm-dot*dot/std::max(.01f,atlasNorm[g])
                        +.007f*atlasInk[g];
              const int last=prior[y*fullWidth+x];
              if(g==last)err*=.94f; // weak temporal hysteresis
              if(err<best){best=err;chosen=g;}
            }
            prior[y*fullWidth+x]=chosen;
            // If odd width, reserve the final single terminal column.
            if(x==fullWidth-1&&(a.width%2)){output.put(' ');continue;}
            emitGlyph(output,chosen);
          }
          output<<"\r\n";
        }
      }
      output<<"\f\r\n";
      ++complete;
      if(complete%16==0||complete==a.count)
        std::cerr<<"FRAME "<<complete<<"/"<<a.count<<"\n";
      if(!output)throw std::runtime_error("TSL write failed");
    }
    output.put('\x1a');output.flush();
    if(!output)throw std::runtime_error("TSL final write failed");
    std::cerr<<"DONE "<<complete<<"\n";
    return 0;
  }catch(const std::exception& e){
    std::cerr<<"ERROR "<<e.what()<<"\n";return 1;
  }
}
