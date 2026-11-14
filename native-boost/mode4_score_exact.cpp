// Exact native scorer for the original TS(L) Mode 4, NOT a replacement algorithm.
// The authoritative _prepare(), MediaPipe, geometry, candidate selection, row
// solver, multi-row beam search and pixel-space critic remain JavaScript.
// This module accelerates ONLY placementLoss() in tsl-artisan-engine.js.
// It uses IEEE double precision (as JS Number does), preserves accumulation
// order, and returns unrounded scores. The browser validates against the
// original implementation; on any discrepancy it falls back to JS.
//
// Transport is a strict little-endian fixed-size binary frame, stdin -> stdout.
// Build: g++ -std=c++17 -O3 -pthread mode4_score_exact.cpp -o mode4_score_exact
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <exception>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <thread>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

template<class T> static std::vector<T> readItems(size_t n){
 if(n>10000000)throw std::runtime_error("native scorer excessive array");
 std::vector<T> a(n);
 if(n){
  if(n>size_t(std::numeric_limits<std::streamsize>::max())/sizeof(T))
   throw std::runtime_error("native scorer oversized frame");
  std::cin.read((char*)a.data(), std::streamsize(n*sizeof(T)));
  if(!std::cin)throw std::runtime_error("native scorer truncated input");
 }
 return a;
}
static uint32_t read32(){
 uint32_t value=0;
 std::cin.read((char*)&value,4);
 if(!std::cin)throw std::runtime_error("native scorer missing header");
 return value;
}

struct Payload{
 int W=0,H=0,S=0,G=0,hasOld=0,cut=0,F=0;
 size_t n=0,cells=0,maskSize=0;
 std::vector<float> target,importance,dist,gray,oldGray,orient,face,penalty,glyphOrient,mask,expanded;
 std::vector<int32_t> oldIndex,columns,shape;
 Payload(){
  const uint32_t magic=read32(),version=read32();
  if(magic!=0x4353344d||version!=1)throw std::runtime_error("unknown Mode4 exact scoring protocol");
  W=(int)read32();H=(int)read32();S=(int)read32();G=(int)read32();
  hasOld=(int)read32();cut=(int)read32();F=(int)read32();
  if(W<4||W>480||H<4||H>240||S<4||S>10||G<2||G>512||
     (hasOld!=0&&hasOld!=1)||(cut!=0&&cut!=1)||F<0||F>8)
   throw std::runtime_error("invalid Mode4 scoring dimensions");
  cells=size_t(W)*H;n=cells*S*S;
  if(cells*size_t(G)>6000000||n>3000000)
   throw std::runtime_error("Mode4 scoring exceeds native acceleration safety limit");
  maskSize=size_t(2)*S*S;
  // Field arrays keep original JS Float32Array values unchanged.
  target=readItems<float>(n);
  importance=readItems<float>(n);
  dist=readItems<float>(n);
  gray=readItems<float>(n);
  oldGray=readItems<float>(n);
  orient=readItems<float>(cells*8);
  oldIndex=readItems<int32_t>(cells);
  face=readItems<float>(size_t(F)*4);
  columns=readItems<int32_t>(G);
  shape=readItems<int32_t>(G);
  penalty=readItems<float>(G);
  glyphOrient=readItems<float>(size_t(G)*4);
  mask=readItems<float>(size_t(G)*maskSize);
  expanded=readItems<float>(size_t(G)*maskSize);
  if(columns[0]!=1)throw std::runtime_error("Mode4 atlas must start with a 1-cell blank");
  for(int i=0;i<G;i++)if(columns[i]!=1&&columns[i]!=2)
   throw std::runtime_error("Mode4 atlas contains invalid glyph width");
 }
 double compute(int x,int y,int g)const{
  const int cols=columns[g],S2=S*S;
  if(x+cols>W)return std::numeric_limits<double>::infinity();
  const int count=cols*S2;
  const size_t glyph=size_t(g)*maskSize;
  const int stride=W*S;
  const size_t top=(size_t(y)*S)*stride+x*S;
  double sum=0, missing=0, extra=0, direct=0;
  for(int sy=0;sy<S;sy++){
   const size_t row=top+size_t(sy)*stride;
   const size_t mi=glyph+size_t(sy)*cols*S;
   for(int sx=0;sx<cols*S;sx++){
    const size_t k=row+sx;
    const double t=target[k],m=mask[mi+sx];
    const double priority=(importance[k]!=0?importance[k]:1.0);
    sum+=t*priority;
    missing+=priority*t*(1.0-expanded[mi+sx]);
    extra+=std::min(1.9,priority)*m*std::min(1.0,double(dist[k])/2.4);
    direct+=priority*(t-m)*(t-m);
   }
  }
  const double density=sum/count;
  if(g!=0&&density<.008)return std::numeric_limits<double>::infinity();
  double score=(1.85*missing+.62*extra+.19*direct)/count;
  if(g!=0&&sum>.5){
   double err=0;
   const size_t h=(size_t(y)*W+x)*8+(cols==1?0:4);
   for(int i=0;i<4;i++)err+=std::abs(double(glyphOrient[size_t(g)*4+i])-orient[h+i]);
   score+=.038*std::min(1.0,density*13.0)*err;
  }
  if(g!=0){
   score+=.0025+penalty[g];
   if(!shape[g]&&F){
    const double cx=(x+cols*.5)/W,cy=(y+.5)/H;
    for(int j=0;j<F;j++){
     const double fx=face[j*4],fy=face[j*4+1],fw=face[j*4+2],fh=face[j*4+3];
     if(cx>=fx-fw*.15&&cx<=fx+fw*1.15&&cy>=fy-fh*.2&&cy<=fy+fh*1.25){
      score+=.07;break;
     }
    }
   }
  }
  if(!cut&&hasOld&&oldIndex[size_t(y)*W+x]==g){
   double drift=0;
   for(int sy=0;sy<S;sy++){
    const size_t row=top+size_t(sy)*stride;
    for(int sx=0;sx<cols*S;sx++)
     drift+=std::abs(double(gray[row+sx])-oldGray[row+sx]);
   }
   if(drift/count<.065&&density>.025)score-=.004;
  }
  return std::max(0.0,score);
 }
};

int main(){
 try{
#ifdef _WIN32
  _setmode(_fileno(stdin),_O_BINARY);
  _setmode(_fileno(stdout),_O_BINARY);
#endif
  Payload p;
  std::vector<double> results(p.cells*size_t(p.G));
  const unsigned cores=std::thread::hardware_concurrency();
  const unsigned workers=std::max(1u,std::min(8u,cores?cores:2u));
  std::vector<std::thread> threads;
  auto work=[&](size_t from,size_t to){
   for(size_t cell=from;cell<to;cell++){
    const int x=int(cell%p.W),y=int(cell/p.W);
    for(int g=0;g<p.G;g++)
     results[cell*size_t(p.G)+g]=p.compute(x,y,g);
   }
  };
  const size_t step=(p.cells+workers-1)/workers;
  for(unsigned k=1;k<workers;k++){
   const size_t from=k*step;if(from>=p.cells)break;
   threads.emplace_back(work,from,std::min(p.cells,from+step));
  }
  work(0,std::min(p.cells,step));
  for(auto& t:threads)t.join();
  std::cout.write((const char*)results.data(),std::streamsize(results.size()*8));
  if(!std::cout)throw std::runtime_error("native scoring result pipe failed");
  return 0;
 }catch(const std::exception& error){
  std::cerr<<"EXACT_SCORER_ERROR "<<error.what()<<'\n';
  return 1;
 }
}