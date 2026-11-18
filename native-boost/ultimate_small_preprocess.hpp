#pragma once
#include <algorithm>
#include <atomic>
#include <cmath>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>
#include <emmintrin.h>
#include <chrono>

struct RowPool {
 std::vector<std::thread> workers;
 std::mutex mutex; std::condition_variable ready,finished;
 std::function<void(int)> fn; std::atomic<int> next{0};
 int count=0,pending=0; unsigned generation=0; bool stop=false;
 explicit RowPool(int n) {
  for(int t=1;t<n;t++)workers.emplace_back([this]{
   unsigned seen=0; std::unique_lock<std::mutex> lk(mutex);
   for(;;){ready.wait(lk,[&]{return stop||generation!=seen;});if(stop)return;
    seen=generation;lk.unlock();run();lk.lock();if(--pending==0)finished.notify_one();
   }
  });
 }
 void run(){for(int i;(i=next.fetch_add(1,std::memory_order_relaxed))<count;)fn(i);}
 void each(int n,const std::function<void(int)>& f){
  {std::lock_guard<std::mutex> lk(mutex);fn=f;count=n;next=0;pending=int(workers.size());++generation;}
  ready.notify_all();run();
  std::unique_lock<std::mutex> lk(mutex);finished.wait(lk,[&]{return pending==0;});fn={};
 }
 ~RowPool(){{std::lock_guard<std::mutex> lk(mutex);stop=true;}ready.notify_all();for(auto& t:workers)t.join();}
};
inline int clampi(int x,int hi){return std::max(0,std::min(hi,x));}
struct Prepared {std::vector<float> features;std::vector<uint32_t> counts;double grayMs=0,blurMs=0,edgeMs=0,descriptorMs=0;};
struct SmallPreprocessor {
 int cell=40,minComponent=8; double inkSigma=.65,inkGain=1.9;
 RowPool pool;
 std::vector<float> gray,tmp,small,mag,thin,edges,filtered,ink,blurTemp;
 std::vector<uint8_t> direction,seen;
 std::vector<int> labels,stack,component,sizes;
 bool simd;
 std::function<void(const std::vector<float>&,int,int,const std::vector<float>&,std::vector<float>&)> blurOverride;
 explicit SmallPreprocessor(int threads,bool vectorized=true):pool(threads),simd(vectorized){}
 static std::vector<float> kernel(double sigma){
  int r=int(std::ceil(sigma*3));std::vector<float> k(2*r+1);double sum=0;
  for(int i=0;i<int(k.size());i++){double x=(i-r)/sigma;k[i]=float(std::exp(-.5*x*x));sum+=k[i];}
  for(float& v:k)v=float(v/sum);return k;
 }
 void half(int w,int h,const std::vector<float>& k){
  if(blurOverride){blurOverride(gray,w,h,k,small);return;}
  int ow=w/2,oh=h/2,r=(int(k.size())-1)/2;
  std::vector<double> taps(k.size()+1);
  for(int j=0;j<int(taps.size());j++)taps[j]=((j<int(k.size())?double(k[j]):0)+(j?double(k[j-1]):0))*.5;
  tmp.resize(ow*h);small.resize(ow*oh);
  pool.each(h,[&](int y){int x=0;
   for(;x<ow;x++){
    int base=x*2-r;if(simd&&x+1<ow&&base>=0&&base+int(taps.size())+2<=w)break;
    double s=0;for(int j=0;j<int(taps.size());j++)s+=gray[y*w+clampi(base+j,w-1)]*taps[j];tmp[y*ow+x]=float(s);
   }
   for(;simd&&x+1<ow&&x*2-r+int(taps.size())+2<=w;x+=2){
    int base=x*2-r;__m128d s=_mm_setzero_pd();
    for(int j=0;j<int(taps.size());j++)s=_mm_add_pd(s,_mm_mul_pd(_mm_set_pd(gray[y*w+base+j+2],gray[y*w+base+j]),_mm_set1_pd(taps[j])));
    double v[2];_mm_storeu_pd(v,s);tmp[y*ow+x]=float(v[0]);tmp[y*ow+x+1]=float(v[1]);
   }
   for(;x<ow;x++){double s=0;int base=x*2-r;for(int j=0;j<int(taps.size());j++)s+=gray[y*w+clampi(base+j,w-1)]*taps[j];tmp[y*ow+x]=float(s);}
  });
  pool.each(oh,[&](int y){int base=y*2-r,x=0;
   for(;simd&&x+1<ow;x+=2){__m128d s=_mm_setzero_pd();
    for(int j=0;j<int(taps.size());j++){const float* p=&tmp[clampi(base+j,h-1)*ow+x];s=_mm_add_pd(s,_mm_mul_pd(_mm_set_pd(p[1],p[0]),_mm_set1_pd(taps[j])));}
    double v[2];_mm_storeu_pd(v,s);small[y*ow+x]=float(v[0]);small[y*ow+x+1]=float(v[1]);
   }
   for(;x<ow;x++){double s=0;for(int j=0;j<int(taps.size());j++)s+=tmp[clampi(base+j,h-1)*ow+x]*taps[j];small[y*ow+x]=float(s);}
  });
 }
 void broaden(int w,int h){
  auto k=kernel(inkSigma);int r=(int(k.size())-1)/2;blurTemp.resize(w*h);ink.resize(w*h);
  pool.each(h,[&](int y){for(int x=0;x<w;x++){int i=y*w+x;double s=double(filtered[i])*k[r];
   for(int d=1;d<=r;d++)s+=(double(filtered[y*w+clampi(x-d,w-1)])+filtered[y*w+clampi(x+d,w-1)])*k[r+d];blurTemp[i]=float(s);
  }});
  pool.each(h,[&](int y){for(int x=0;x<w;x++){int i=y*w+x;double s=double(blurTemp[i])*k[r];
   for(int d=1;d<=r;d++)s+=(double(blurTemp[clampi(y-d,h-1)*w+x])+blurTemp[clampi(y+d,h-1)*w+x])*k[r+d];
   ink[i]=float(std::min(1.,double(float(s))*inkGain));
  }});
 }
 template<int CHANNELS=4> Prepared compute(const uint8_t* rgba,int W,int H,const double* options,const std::vector<float>& gaussian){
  using Clock=std::chrono::steady_clock;auto start=Clock::now();auto ms=[](auto a,auto b){return std::chrono::duration<double,std::milli>(b-a).count();};
  const int w=W/2,h=H/2,n=w*h,halfCell=cell/2,cols=W/cell,rows=H/cell;gray.resize(W*H);
  pool.each(H,[&](int y){for(int x=0;x<W;x++){int i=y*W+x,j=i*CHANNELS;double a=CHANNELS==3?1.:rgba[j+3]/255.;
   double l=(.2126*rgba[j]+.7152*rgba[j+1]+.0722*rgba[j+2])*a+255*(1-a);
   double v=std::min(1.,std::max(0.,((l-127.5)*options[0]+127.5+options[1]*2.55)/255.));
   gray[i]=float(options[2]==1?v:std::pow(v,options[2]));
  }});
  auto a=Clock::now();if(options[3]==0){small.resize(n);pool.each(h,[&](int y){for(int x=0;x<w;x++){int i=y*2*W+x*2;small[y*w+x]=float((double(gray[i])+gray[i+1]+gray[i+W]+gray[i+W+1])*.25);}});}else half(W,H,gaussian);
  auto b=Clock::now();mag.assign(n,0);direction.assign(n,0);thin.assign(n,0);edges.assign(n,0);seen.assign(n,0);
  pool.each(h-2,[&](int yy){int y=yy+1;for(int x=1;x<w-1;x++){int i=y*w+x;double gx=(double(small[i+1])-small[i-1])/2,gy=(double(small[i+w])-small[i-w])/2;
   mag[i]=float(std::hypot(gx,gy));
   // Same angular bins; only ambiguous boundary values call atan2.
   // The 1e-12 relative guard exceeds double product/constant roundoff.
   double ax=std::abs(gx),ay=std::abs(gy),low=ax*0.4142135623730950488,high=ax*2.414213562373095049;
   double guard=std::max(ax,ay)*1e-12;
   if(std::abs(ay-low)>guard&&std::abs(ay-high)>guard)
    direction[i]=ay<low?0:ay>high?2:(std::signbit(gx)==std::signbit(gy)?1:3);
   else{
    double angle=std::fmod(std::atan2(gy,gx)*180/3.141592653589793+180,180);
    direction[i]=angle<22.5||angle>=157.5?0:angle<67.5?1:angle<112.5?2:3;
   }
  }});
  const int steps[]={1,w+1,w,w-1};double high=options[4],low=options[5];
  pool.each(h-2,[&](int yy){int y=yy+1;for(int x=1;x<w-1;x++){int i=y*w+x,d=steps[direction[i]];float v=mag[i];if(v>=low&&v>=mag[i-d]&&v>=mag[i+d])thin[i]=v;}});
  labels.assign(n,0);sizes.assign(1,0);int label=0;
  for(int i=0;i<n;i++)if(thin[i]>=high&&!seen[i]){
   stack.clear();component.clear();stack.push_back(i);seen[i]=1;
   while(!stack.empty()){int p=stack.back();stack.pop_back();component.push_back(p);int x=p%w,y=p/w;
    for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;int nx=x+dx,ny=y+dy;if(nx<=0||nx>=w-1||ny<=0||ny>=h-1)continue;int j=ny*w+nx;if(!seen[j]&&thin[j]>=low){seen[j]=1;stack.push_back(j);}}
   }if(component.size()>=size_t(minComponent)){++label;sizes.push_back(int(component.size()));for(int p:component){edges[p]=1;labels[p]=label;}}
  }
  filtered.assign(n,0);
  pool.each(cols*rows,[&](int cell){
   int cx=cell%cols,cy=cell/cols;uint8_t visited[900]={};int todo[900],list[900],best[900],bestN=0;double bestImportance=-1;
   for(int q=0;q<halfCell*halfCell;q++){
    int gx=cx*halfCell+q%halfCell,gy=cy*halfCell+q/halfCell;if(visited[q]||!edges[gy*w+gx])continue;
    int sp=1,len=0;todo[0]=q;visited[q]=1;
    while(sp){int at=todo[--sp];list[len++]=at;int x=at%halfCell,y=at/halfCell;
     for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){int nx=x+dx,ny=y+dy;if(nx<0||nx>=halfCell||ny<0||ny>=halfCell)continue;int j=ny*halfCell+nx;if(!visited[j]&&edges[(cy*halfCell+ny)*w+cx*halfCell+nx]){visited[j]=1;todo[sp++]=j;}}
    }
    double importance=len*(1+.25*std::log1p(sizes[labels[gy*w+gx]]));
    if(importance>bestImportance){bestImportance=importance;bestN=len;std::copy(list,list+len,best);}
   }
   for(int i=0;i<bestN;i++){int q=best[i];filtered[(cy*halfCell+q/halfCell)*w+cx*halfCell+q%halfCell]=1;}
  });
  broaden(w,h);auto c=Clock::now();Prepared out;out.features.resize(cols*rows*1152);out.counts.resize(cols*rows);
  pool.each(cols*rows,[&](int cell){
   int cx=cell%cols,cy=cell/cols;float weights[576],distance[576];double sum=0;uint32_t count=0;
   for(int y=0;y<halfCell;y++)for(int x=0;x<halfCell;x++)count+=uint32_t(filtered[(cy*halfCell+y)*w+cx*halfCell+x]);out.counts[cell]=count;
   if(options[7]==0&&count<options[6]){std::fill_n(&out.features[cell*1152],1152,0.f);return;}
   for(int y=0;y<24;y++)for(int x=0;x<24;x++){
    const double ratio=double(halfCell)/24;double x0=x*ratio,x1=(x+1)*ratio,y0=y*ratio,y1=(y+1)*ratio,s=0;
    for(int yy=int(std::floor(y0));yy<int(std::ceil(y1));yy++)for(int xx=int(std::floor(x0));xx<int(std::ceil(x1));xx++)s+=ink[(cy*halfCell+yy)*w+cx*halfCell+xx]*(std::min(x1,double(xx+1))-std::max(x0,double(xx)))*(std::min(y1,double(yy+1))-std::max(y0,double(yy)));
    int i=y*24+x;float v=float(s/(ratio*ratio));weights[i]=v>=.18?v:0;sum+=weights[i];distance[i]=weights[i]?0:100;
   }
   constexpr double diag=1.4142135623730951;
   for(int y=0;y<24;y++)for(int x=0;x<24;x++){int i=y*24+x;double v=distance[i];
    if(x)v=std::min(v,double(distance[i-1])+1);if(y)v=std::min(v,double(distance[i-24])+1);
    if(x&&y)v=std::min(v,double(distance[i-25])+diag);if(x<23&&y)v=std::min(v,double(distance[i-23])+diag);distance[i]=float(v);
   }
   for(int y=23;y>=0;y--)for(int x=23;x>=0;x--){int i=y*24+x;double v=distance[i];
    if(x<23)v=std::min(v,double(distance[i+1])+1);if(y<23)v=std::min(v,double(distance[i+24])+1);
    if(x<23&&y<23)v=std::min(v,double(distance[i+25])+diag);if(x&&y<23)v=std::min(v,double(distance[i+23])+diag);distance[i]=float(v);
   }
   float* f=&out.features[cell*1152];for(int i=0;i<576;i++){f[i]=sum?float(weights[i]/sum):0;f[576+i]=float(1.3*std::min(2.,std::max(0.,double(distance[i])-.5)/2.5));}
  });
  auto d=Clock::now();out.grayMs=ms(start,a);out.blurMs=ms(a,b);out.edgeMs=ms(b,c);out.descriptorMs=ms(c,d);return out;
 }
};
