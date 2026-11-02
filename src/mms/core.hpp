// Independently written MMS/NAK/PKN reader and player core. No third-party source incorporated.
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <functional>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
namespace mm {
using Bytes=std::vector<uint8_t>;
inline void require(bool ok,const char* msg){if(!ok)throw std::runtime_error(msg);}
inline void require(bool ok,const std::string& msg){if(!ok)throw std::runtime_error(msg);}
struct Reader {
 const Bytes& b; size_t p=0,end;
 Reader(const Bytes& b,size_t p=0,size_t end=0):b(b),p(p),end(end?end:b.size()){}
 uint8_t u8(){if(p>=end)throw std::runtime_error("Unexpected end at byte "+std::to_string(p));return b[p++];}
 uint16_t u16(){int a=u8();return a|(u8()<<8);}
 uint32_t u32(){uint32_t a=u16();return a|(uint32_t(u16())<<16);}
 Bytes take(size_t n){if(n>end-p)throw std::runtime_error("Truncated block at byte "+std::to_string(p));Bytes v(b.begin()+p,b.begin()+p+n);p+=n;return v;}
 void skip(size_t n){require(n<=end-p,"Truncated field");p+=n;}
 std::string str(size_t n){auto v=take(n);return std::string(v.begin(),v.end());}
};
struct Picture {int type,left,top,right,bottom;Bytes data;};
struct Palette {int offset;Bytes rgb;};
struct Sound {std::string name;int type,rate;std::vector<int16_t> pcm;};
struct Block {std::string name,type;size_t offset,size;};
struct Movie {
 std::string scenario,body,version,comment;
 std::vector<std::string> resourceLines,strings;
 std::vector<Picture> pictures;std::vector<Palette> palettes;std::vector<Sound> sounds;
 std::vector<Block> blocks;
};
inline std::string trim(std::string s){while(!s.empty()&&(s.back()=='\r'||s.back()==' '||s.back()=='\t'))s.pop_back();size_t p=s.find_first_not_of(" \t");return p==std::string::npos?"":s.substr(p);}
inline std::vector<int16_t> decodeSound(const Bytes& data,int type){
 require(type>=0&&type<=3,"Unsupported PKN encoding "+std::to_string(type));
 std::vector<int16_t> out;out.reserve(data.size()*2);
 if(!(type&1)){for(auto b:data)out.push_back(int16_t(int8_t(b))*256);return out;}
 // X68000 / MSM6258: 12-bit predictor, 49 adaptive steps, low nibble first.
 constexpr int steps[49]={16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552};
 int predictor=2047,index=0;
 const int adjust[8]={-1,-1,-1,-1,2,4,6,8};
 for(auto b:data)for(int nib:{int(b&15),int(b>>4)}){
  int s=steps[index];int delta=s/8+(nib&1?s/4:0)+(nib&2?s/2:0)+(nib&4?s:0);
  predictor=std::clamp(predictor+(nib&8?-delta:delta),0,4095);
  index=std::clamp(index+adjust[nib&7],0,48);
  out.push_back(int16_t(((predictor>>4)-128)*256)); // Original player output is signed 8-bit, widened to 16-bit.
 }
 return out;
}
inline Movie load(const Bytes& file){
 require(file.size()>=10&&std::memcmp(file.data(),"MMS",3)==0,"Not an M-MASL MMS file");
 Reader r(file);r.skip(8);size_t sl=r.u16();Movie m;m.scenario=r.str(sl);
 require(m.scenario.rfind("MMASL",0)==0,"Missing MMASL scenario signature");
 // Header fields end at three dot-prefixed lines; version may be on a separate line.
 std::istringstream lines(m.scenario);std::string line;int section=0;size_t offset=0,bodyStart=0;
 while(std::getline(lines,line)){
  offset+=line.size()+1;line=trim(line);
  if(!line.empty()&&line[0]=='.'){section++;if(section==3){bodyStart=std::min(offset,m.scenario.size());break;}continue;}
  if(section==0)m.comment+=line+"\n";
  else if(section==1&&!line.empty())m.resourceLines.push_back(line);
  else if(section==2&&!line.empty())m.strings.push_back(line);
 }
 require(section==3,"Incomplete MSC header");m.body=m.scenario.substr(bodyStart);
 size_t vp=m.comment.find_first_of("0123456789");if(vp!=std::string::npos){size_t ve=vp;while(ve<m.comment.size()&&(std::isdigit((unsigned char)m.comment[ve])||m.comment[ve]=='.'))ve++;m.version=m.comment.substr(vp,ve-vp);}
 int imageIndex=0,palIndex=0,soundIndex=0;
 for(auto name:m.resourceLines){
  if(name[0]=='\\'){
   auto assign=[&](const char* p,int& v){if(name.rfind(p,0)==0){v=std::stoi(name.substr(std::strlen(p)));require(v>=0&&v<4096,"Resource index out of range");return true;}return false;};
   require(assign("\\cg",imageIndex)||assign("\\pal",palIndex)||assign("\\pcm",soundIndex),"Unknown resource directive: "+name);continue;
  }
  require(r.p+4<=r.end,"Missing resource block: "+name);
  size_t n=r.u32();if(n==0)n=r.end-r.p;
  require(n<=r.end-r.p,"Invalid resource size: "+name);
  size_t begin=r.p;Reader q(file,begin,begin+n);std::string sig=q.str(8);
  Block block{name,sig.substr(0,3),begin,n};m.blocks.push_back(block);
  q.skip(32);
  bool enabled=true; // No startup options in the simple player UI.
  if(name[0]=='='||name[0]=='|'){
   auto colon=name.find(':');require(colon!=std::string::npos,"Invalid resource option");
   // Every required (=) option is absent in the default option set.
   enabled=name.substr(0,colon).find('=')==std::string::npos;
  }
  while(!name.empty()&&(name[0]=='='||name[0]=='|')){auto c=name.find(':');require(c!=std::string::npos,"Invalid resource option");name=name.substr(c+1);}
  if(sig.rfind("NAK",0)==0){
   int comment=q.u16();q.skip(comment);
   while(q.p<q.end){
    int type=q.u8();int cs=q.u16();
    if(type==0){
     int off=q.u16(),sz=q.u16();require(off%3==0&&sz%3==0&&off+sz<=768,"Invalid palette range");q.skip(cs);
     Palette p{off/3,q.take(sz)};
     if(enabled){if(int(m.palettes.size())<=palIndex)m.palettes.resize(palIndex+1);m.palettes[palIndex++]=std::move(p);}
    }else{
     require(type>=1&&type<=3,"Unknown NAK record "+std::to_string(type));
     int sz=q.u16();Picture p;p.type=type;p.left=q.u16();p.top=q.u16();p.right=q.u16();p.bottom=q.u16();q.skip(cs);p.data=q.take(sz);
     require(sz>=32,"Short NAK image");
     if(enabled){if(int(m.pictures.size())<=imageIndex)m.pictures.resize(imageIndex+1);m.pictures[imageIndex++]=std::move(p);}
    }
   }
  }else if(sig.rfind("PKN",0)==0){
   while(q.p<q.end){Sound s;s.type=q.u8();s.name=q.str(16);s.rate=q.u16();size_t sz=q.u32();s.pcm=decodeSound(q.take(sz),s.type);
    if(enabled){if(int(m.sounds.size())<=soundIndex)m.sounds.resize(soundIndex+1);m.sounds[soundIndex++]=std::move(s);}
   }
  }else throw std::runtime_error("Unknown resource signature");
  r.p=begin+n;
 }
 require(r.p==r.end,"Trailing MMS bytes: "+std::to_string(r.end-r.p));
 return m;
}
// Decode directly into the virtual framebuffer: skip commands retain old pixels,
// so transparent and difference frames cannot be expanded as opaque still images.
inline int drawNak(const Picture& pic,Bytes& vram,int x,int y){
 Reader r(pic.data);auto table=r.take(32);
 int half=-1,round=0;int64_t base=int64_t(y)*640+x,pos=base;
 auto nib=[&](){if(half>=0){int n=half;half=-1;return n;}int n=r.u8();half=n>>4;return n&15;};
 auto get=[&](int64_t i)->uint8_t{return i>=0&&i<int64_t(vram.size())?vram[size_t(i)]:0;};
 auto put=[&](uint8_t v){if(pos>=0&&pos<int64_t(vram.size()))vram[size_t(pos)]=v;pos++;};
 const int distance[16]={2,4,8,16,638,639,640,641,642,1278,1279,1280,1281,1282,2560,5120};
 while(r.p<r.end){
  int op=r.u8();
  if(op<208){
   int k=op%13,count;
   if(k<8)count=k+1;
   else if(k<10)count=nib()*2+k+1;
   else if(k<12)count=r.u8()*2+k+31;
   else count=r.u16();
   int d=distance[op/13];for(int i=0;i<count*2;i++)put(get(pos-d));
  }else if(op<238){
   int code=(op-208)%15;int64_t from=pos-(op<223?2:640);uint8_t a=get(from),b=get(from+1);
   if(code<3){put(code==0?a:b);put(code==1?b:a);}
   else{
    int group=(code-3)/3,kind=(code-3)%3;
    uint8_t value=kind==2?r.u8():table[nib()+kind*16];
    if(group<2){put(group==0?a:b);put(value);}
    else{put(value);put(group==2?b:a);}
   }
  }else if(op<=241){
   int pair=r.u8();put(table[(pair&15)+((op-238)&1)*16]);put(table[(pair>>4)+((op-238)>>1)*16]);
  }else if(op==242){int a=r.u8(),b=r.u8();put(a);put(b);}
  else if(op==243)pos+=r.u8()*2;
  else if(op==244)pos+=r.u16();
  else if(op<=250){
   int group=(op-245)/3,kind=(op-245)%3;int value=kind==2?r.u8():table[nib()+kind*16];
   if(group)pos++;put(value);if(!group)pos++;
  }else if(op<=253){int kind=op-251,value=kind==2?r.u8():table[nib()+kind*16];put(value);put(value);}
  else if(op==254){continue;}
  else {round++;half=-1;base+=64000;pos=base;if(round==5)return r.end-r.p>=2?int16_t(r.u16()):0;}
  require(pos-base>=-384000&&pos-base<=1048576,"NAK destination span out of range");
 }
 throw std::runtime_error("NAK stream without terminator");
}
}
