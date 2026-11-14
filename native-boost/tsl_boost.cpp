// TASL PC Boost: independently implemented native C++ frame-to-TSL engine.
// stdin: stream of RGB24 frames at (ceil(columns/2)*8) x (rows*8).
// All video decoding is delegated to the local FFmpeg process (sequential, no seeks).
// Unlike the browser converter, this path uses a fast contour/glyph-feature algorithm.
#include "glyphs.hpp"
#include <algorithm>
#include <array>
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
  int width=0,height=0,count=0,ticks=0,startFrame=0;
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
    else if(key=="--start-frame")a.startFrame=toInt(val.c_str());
    else if(key=="--ticks")a.ticks=toInt(val.c_str());
    else if(key=="--brightness")a.brightness=toDouble(val.c_str());
    else if(key=="--contrast")a.contrast=toDouble(val.c_str());
    else if(key=="--gamma")a.gamma=toDouble(val.c_str());
    else if(key=="--edge")a.edge=toDouble(val.c_str());
    else if(key=="--native16")a.native16=val=="1";
    else throw std::runtime_error("unrecognized option "+key);
  }
  if(a.output.empty()||a.width<4||a.width>480||a.height<4||a.height>240||
     a.count<1||a.count>10000||a.startFrame<0||a.startFrame>=a.count||
     a.ticks<a.count||a.ticks>432000||
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
    std::vector<float> gray(n),smooth(n),edge(n);
    std::vector<int> prior(size_t(fullWidth)*a.height,-1);
    std::ofstream output(a.output,std::ios::binary|
      (a.startFrame?std::ios::app:std::ios::trunc));
    if(!output)throw std::runtime_error("cannot open destination");
    if(!a.startFrame)header(output,a);
    static constexpr char RAMP[]=" .:|/(%YVO8D@0#$";
    static constexpr unsigned char TONES[5][2]={{0x81,0x40},{0x81,0x42},
      {0x82,0x8f},{0x81,0x9b},{0x81,0x9d}};
    static constexpr int BAYER[16]={0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5};
    if(glyphCount()!=272)throw std::runtime_error("the exact 272 glyph atlas is missing");
    struct Features {
      std::array<float,16> coarse{};
      std::array<float,64> fine{};
      float coarseNorm=0, fineNorm=0, ink=0;
    };
    std::vector<Features> atlas(glyphCount());
    for(int g=0;g<glyphCount();g++){
      auto& f=atlas[g];
      for(int t=0;t<16;t++){
        f.coarse[t]=GLYPHS[g].coarse[t]/255.0f;
        f.coarseNorm+=f.coarse[t]*f.coarse[t];
        f.ink+=f.coarse[t];
      }
      for(int t=0;t<64;t++){
        f.fine[t]=GLYPHS[g].fine[t]/255.0f;
        f.fineNorm+=f.fine[t]*f.fine[t];
      }
      f.coarseNorm=std::max(.01f,f.coarseNorm);
      f.fineNorm=std::max(.01f,f.fineNorm);
    }
    // Five CP932 glyphs in increasing visual density. This second layer
    // preserves soft, low-edge silhouettes that a contour-only render loses.
    const auto findGlyph=[&](int lead,int trail)->int{
      for(int i=0;i<glyphCount();i++)
        if(GLYPHS[i].lead==lead&&GLYPHS[i].trail==trail)return i;
      throw std::runtime_error("an essential CP932 shading glyph is missing");
    };
    const std::array<int,5> shades={
      findGlyph(0x81,0x45), // ・
      findGlyph(0x88,0xea), // 一
      findGlyph(0x8c,0xfb), // 口
      findGlyph(0x93,0x63), // 田
      findGlyph(0x95,0x69)  // 品
    };
    std::array<float,256> toneLUT{};
    for(int i=0;i<256;i++){
      const float v=clamp((i/255.0f-.5f)*(float)a.contrast+.5f+(float)(a.brightness/100));
      toneLUT[i]=std::pow(v,(float)a.gamma);
    }
    int complete=a.startFrame;
    for(int frame=a.startFrame;frame<a.count;frame++){
      std::cin.read(reinterpret_cast<char*>(raw.data()),std::streamsize(bytes));
      if(std::cin.gcount()!=std::streamsize(bytes)){
        // FFmpeg can emit fewer frames for odd timestamps. Reuse the final decoded
        // image, preserving the duration and the explicit TSL timing schedule.
        if(complete==a.startFrame)throw std::runtime_error("no complete video frames decoded");
        if(std::cin.gcount()!=0)throw std::runtime_error("truncated RGB frame");
      }else{
        for(size_t i=0;i<n;i++){
          const size_t p=i*3;
          const int lum=(54*int(raw[p])+183*int(raw[p+1])+19*int(raw[p+2])+128)>>8;
          gray[i]=toneLUT[std::min(255,lum)];
        }
        if(a.mode=="artisan"||a.mode=="quality"){
          // Separable, edge-preserving-in-practice Gaussian approximation: reject
          // small video codec blocks and fabric texture, keep large silhouettes.
          for(int y=0;y<H;y++)for(int x=0;x<W;x++){
            const int left=std::max(x-1,0),right=std::min(x+1,W-1);
            smooth[y*W+x]=(gray[y*W+left]+2*gray[y*W+x]+gray[y*W+right])*.25f;
          }
          for(int y=0;y<H;y++)for(int x=0;x<W;x++){
            const int top=std::max(y-1,0),bottom=std::min(y+1,H-1);
            edge[y*W+x]=(smooth[top*W+x]+2*smooth[y*W+x]+smooth[bottom*W+x])*.25f;
          }
          std::swap(edge,smooth); // smooth now contains the blurred luminance
          for(int y=0;y<H;y++)for(int x=0;x<W;x++){
            const int i=y*W+x,l=y*W+std::max(0,x-2),
                r=y*W+std::min(W-1,x+2),
                t=std::max(0,y-2)*W+x,
                b=std::min(H-1,y+2)*W+x;
            const float lum=std::abs(smooth[r]-smooth[l])+
                            std::abs(smooth[b]-smooth[t]);
            float chroma=0;
            for(int c=0;c<3;c++){
              const float dx=std::abs(int(raw[3*r+c])-int(raw[3*l+c]))/255.0f;
              const float dy=std::abs(int(raw[3*b+c])-int(raw[3*t+c]))/255.0f;
              chroma=std::max(chroma,std::max(dx,dy));
            }
            const float strength=(a.mode=="artisan"?.085f:.12f);
            edge[i]=clamp(std::max(0.f,lum-strength)*4.0f+
                          std::max(0.f,chroma-.22f)*1.2f);
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
            if(x==fullWidth-1&&(a.width%2)){output.put(' ');continue;}
            std::array<float,64> targetFine{};
            std::array<float,16> target{};
            float energy=0, targetNorm=0, targetFineNorm=0;
            for(int ty=0;ty<8;ty++)for(int tx=0;tx<8;tx++){
              const float v=edge[(y*8+ty)*W+x*8+tx];
              targetFine[ty*8+tx]=v;
              targetFineNorm+=v*v;
              target[(ty/2)*4+tx/2]+=v*.25f;
            }
            for(float v:target){energy+=v;targetNorm+=v*v;}
            // Empty solid-color areas remain empty rather than noisy glyph soup.
            if(energy<(a.mode=="artisan"?1.8f:2.3f)){
              if(a.mode=="artisan"){
                float light=0,saturation=0;
                for(int dy=0;dy<8;dy++)for(int dx=0;dx<8;dx++){
                  const size_t pi=size_t(y*8+dy)*W+x*8+dx, rgb=pi*3;
                  light+=gray[pi];
                  const int r=raw[rgb],g=raw[rgb+1],b=raw[rgb+2];
                  saturation+=(std::max({r,g,b})-std::min({r,g,b}))/255.0f;
                }
                float tone=(light*.83f+saturation*.38f)/64;
                tone+=(BAYER[(y%4)*4+x%4]-7.5f)/16*.04f;
                const int level=tone<.23f?0:tone<.36f?1:
                  tone<.48f?2:tone<.61f?3:tone<.76f?4:5;
                if(level)emitGlyph(output,shades[level-1]);
                else {output.put(' ');output.put(' ');}
              }else {output.put(' ');output.put(' ');}
              prior[y*fullWidth+x]=-1;continue;
            }
            // Coarse geometric matching over all 272 allowed glyphs; refine the
            // best 6 at full 8x8 resolution. Expensive shape matching stays native.
            constexpr int TOP=6;
            std::array<int,TOP> choices; choices.fill(-1);
            std::array<float,TOP> scores;
            scores.fill(std::numeric_limits<float>::max());
            const int last=prior[y*fullWidth+x];
            const int candidates=a.mode=="quality"?128:glyphCount();
            for(int g=0;g<candidates;g++){
              float dot=0;
              const auto& glyph=atlas[g];
              for(int t=0;t<16;t++)dot+=target[t]*glyph.coarse[t];
              float err=targetNorm-dot*dot/glyph.coarseNorm+.04f*glyph.ink;
              if(g==last)err*=.94f;
              if(err>=scores[TOP-1])continue;
              int pos=TOP-1;
              while(pos>0&&err<scores[pos-1]){
                scores[pos]=scores[pos-1];choices[pos]=choices[pos-1];--pos;
              }
              scores[pos]=err;choices[pos]=g;
            }
            float best=std::numeric_limits<float>::max();int chosen=choices[0];
            for(int c=0;c<TOP;c++){
              const int g=choices[c];if(g<0)break;
              const auto& glyph=atlas[g];
              float dot=0;
              for(int t=0;t<64;t++)dot+=targetFine[t]*glyph.fine[t];
              float err=targetFineNorm-dot*dot/glyph.fineNorm+.055f*glyph.ink;
              if(g==last)err*=.92f;
              if(err<best){best=err;chosen=g;}
            }
            prior[y*fullWidth+x]=chosen;
            emitGlyph(output,chosen);
          }
          output<<"\r\n";
        }
      }
      output<<"\f\r\n";
      ++complete;
      if(complete%16==0||complete==a.count){
        output.flush();
        std::cerr<<"FRAME "<<complete<<"/"<<a.count<<"\n";
      }
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
