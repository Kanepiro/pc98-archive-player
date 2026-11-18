#pragma once
// Canonical Noto 104px masks, unscaled in fixed 120px cells.
#include <map>
inline const std::vector<unsigned char>& grid120Masks(int cell=120){
 static std::map<int,std::vector<unsigned char>> cache;
 if(cache.count(cell))return cache.at(cell);
 auto masks=[cell](){
  std::vector<wchar_t> exe(32768);DWORD n=GetModuleFileNameW(nullptr,exe.data(),DWORD(exe.size()));
  auto dir=std::filesystem::path(std::wstring(exe.data(),n)).parent_path();
  if(cell!=30&&cell!=40&&cell!=60&&cell!=120)throw std::runtime_error("Invalid cell size");
  const auto name=cell==120?std::wstring(L"mode4-atlas.bin"):L"mode4-atlas"+std::to_wstring(cell)+L".bin";
  auto path=dir/L"app"/name;
  if(!std::filesystem::is_regular_file(path))path=dir/name;
  std::ifstream f(path,std::ios::binary);if(!f)throw std::runtime_error("Mode4 canonical masks missing");
  std::vector<unsigned char> b((std::istreambuf_iterator<char>(f)),{});
  if(b.size()!=170*cell*cell)throw std::runtime_error("Mode4 canonical mask size invalid");
  return b;
 }();return cache.emplace(cell,std::move(masks)).first->second;
}
inline int grid120Id(unsigned code){
 static const unsigned codes[]={0x81a8,0x81a9,0x81aa,0x81ab,0x81b8,0x81b9,0x8e52,0x81bc,0x81bd,0x81bf,0x8274,0x997b,0x81c8,0x81da,0x8799,0x8275,0x83a2,0x8352,0x9981,0x99b7,0x9963,0x8cc8,0x8145,0x8146,0x8164,0x8163,0x8188,0x81e6,0x8150,0x8151,0x815c,0x815e,0x815f,0x8162,0x84a3,0x84a4,0x8473,0x84a1,0x84a2,0x84a5,0x84a6,0x84a7,0x84a8,0x81db,0x8273,0x8798,0x8277,0x83b0,0x8347,0x89a4,0x8ab1,0x84a9,0x9286,0x9379,0x8eb5,0x96d8,0x8160,0x8161,0x9c4f,0x8267,0x826b,0x8279,0x8276,0x83aa,0x8449,0x83ab,0x8343,0x836d,0x836e,0x8371,0x8374,0x82d6,0x837e,0x8381,0x8388,0x838c,0x838a,0x838f,0x8393,0x8350,0x8358,0x835e,0x88ea,0x93f1,0x8e4f,0x8754,0x8755,0x8756,0x828f,0x826e,0x81fc,0x838d,0x9a98,0x82c1,0x82c2,0x8187,0x8257,0x83a0,0x83a6,0x83b3,0x8448,0x83a3,0x8169,0x816a,0x816d,0x816e,0x996b,0x81dc,0x8183,0x8184,0x81e1,0x81e2,0x81a7,0x8194,0x834c,0x81e3,0x8269,0x82b5,0x826f,0x82a2,0x82af,0x82b1,0x82c4,0x89b3,0x8386,0x8458,0x83ce,0x83cf,0x8471,0x83d0,0x83d1,0x83d2,0x8475,0x83c6,0x83d3,0x83d6,0x8474,0x83bf,0x83c0,0x83c1,0x82cc,0x8391,0x83a8,0x83af,0x83b5,0x90ec,0x8f6f,0x89f1,0x8fac,0x96da,0x93fa,0x98a2,0x97b9,0x98a6,0x94aa,0x906c,0x98a7,0x9694,0x98a4,0x9971,0x9c65,0x9c63,0x82ad,0x9bdd,0x9ba3,0xe487,0x96dc,0x99ca,0x99af,0x9c4d};
 for(int i=0;i<170;i++)if(codes[i]==code)return i;
 throw std::runtime_error("Character outside fixed Mode4 palette");
}
inline void grid120Draw(void* buffer,int width,int height,std::string_view frame,int rows,int cell=120,const std::vector<unsigned char>* offsets=nullptr){
 auto p=(unsigned char*)buffer;
 for(int i=0;i<width*height;i++){p[4*i]=18;p[4*i+1]=13;p[4*i+2]=8;p[4*i+3]=0;}
 const auto& masks=grid120Masks(cell);int row=0,col=0;
 for(size_t i=0;i<frame.size();){
  unsigned a=(unsigned char)frame[i++];
  if(a==13){if(i<frame.size()&&frame[i]==10)i++;row++;col=0;continue;}
  if(a==10){row++;col=0;continue;}
  if(row>=rows||col*cell>=width)throw std::runtime_error("Mode4 grid overflow");
  // The GPU's internal background atlas entry is not a frame character.
  if(a==32){col++;continue;}
  if(i>=frame.size())throw std::runtime_error("Truncated Mode4 character");
  unsigned b=(unsigned char)frame[i++];int dx=0,dy=0;
  if(offsets){size_t at=(row*(width/cell)+col)*2;if(at+1>=offsets->size())throw std::runtime_error("Mode4 offsets missing");dx=int((*offsets)[at])-60;dy=int((*offsets)[at+1])-60;if(dx%(cell==60?5:cell/10)||dy%(cell==60?5:cell/10)||std::abs(dx)>=cell||std::abs(dy)>=cell)throw std::runtime_error("Mode4 offsets invalid");}
  if(cell!=120&&a==0x81&&b==0x40){if(dx||dy)throw std::runtime_error("Mode4 blank offset invalid");col++;continue;}int g=grid120Id(a*256+b);
  for(int y=0;y<cell;y++)for(int x=0;x<cell;x++){
   unsigned ink=masks[g*cell*cell+y*cell+x];int nx=x+dx,ny=y+dy;if(nx<0||nx>=cell||ny<0||ny>=cell){if(ink)throw std::runtime_error("Mode4 glyph leaves its cell");continue;}int d=((row*cell+ny)*width+col*cell+nx)*4;
   p[d]=(18*(255-ink)+232*ink+127)/255;
   p[d+1]=(13*(255-ink)+244*ink+127)/255;
   p[d+2]=(8*(255-ink)+227*ink+127)/255;
  }col++;
 }
}

inline std::vector<unsigned char> grid60DecodeOffsets(const std::string& text,size_t expected,int cell=60){
 if(text.size()!=((expected+2)/3)*4)throw std::runtime_error("Mode4 offset length invalid");
 const std::string alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
 std::vector<unsigned char> out;out.reserve(expected);unsigned value=0;int bits=0;bool padding=false;
 for(char c:text){
  if(c=='='){padding=true;continue;}
  auto at=alphabet.find(c);if(padding||at==std::string::npos)throw std::runtime_error("Mode4 offset base64 invalid");
  value=(value<<6)|unsigned(at);bits+=6;if(bits>=8){bits-=8;out.push_back((value>>bits)&255);}
 }
 if(out.size()!=expected)throw std::runtime_error("Mode4 offset data missing");
 for(unsigned x:out)if(std::abs(int(x)-60)>=cell||(int(x)-60)%(cell==60?5:cell/10))throw std::runtime_error("Mode4 offset range invalid");
 return out;
}
