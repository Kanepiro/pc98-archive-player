#pragma once
// Profile 2001 only. Untagged historical TSL continues to use its GDI glyphs.
inline void calibratedHalftoneDraw(void* buffer,int width,int height,std::string_view frame,int rows,int cell){
 static std::map<int,std::vector<unsigned char>> cache;
 if(!cache.count(cell)){
  std::vector<wchar_t> exe(32768);DWORD n=GetModuleFileNameW(nullptr,exe.data(),DWORD(exe.size()));
  auto dir=std::filesystem::path(std::wstring(exe.data(),n)).parent_path();
  auto path=dir/L"app"/(L"halftone-atlas"+std::to_wstring(cell)+L".bin");
  std::ifstream f(path,std::ios::binary);if(!f)throw std::runtime_error("Calibrated halftone masks missing");
  std::vector<unsigned char> masks((std::istreambuf_iterator<char>(f)),{});
  if(masks.size()!=size_t(5*cell*cell))throw std::runtime_error("Calibrated halftone masks invalid");
  cache.emplace(cell,std::move(masks));
 }
 auto p=(unsigned char*)buffer;const auto& masks=cache.at(cell);
 for(int i=0;i<width*height;i++){p[4*i]=18;p[4*i+1]=13;p[4*i+2]=8;p[4*i+3]=0;}
 int row=0,col=0;
 for(size_t i=0;i<frame.size();){
  unsigned a=(unsigned char)frame[i++];
  if(a==13){if(i<frame.size()&&frame[i]==10)i++;row++;col=0;continue;}
  if(a==10){row++;col=0;continue;}
  if(a==32){col+=cell/2;continue;}
  if(i>=frame.size())throw std::runtime_error("Calibrated halftone truncated");
  unsigned code=a*256+(unsigned char)frame[i++];int g=code==0x8140?0:code==0x8142?1:code==0x828f?2:code==0x826e?3:code==0x819d?4:-1;
  if(g<0||row>=rows||col+cell>width)throw std::runtime_error("Calibrated halftone character/geometry");
  for(int y=0;y<cell;y++)for(int x=0;x<cell;x++){
   unsigned ink=masks[g*cell*cell+y*cell+x];int at=((row*cell+y)*width+col+x)*4;
   p[at]=(18*(255-ink)+232*ink+127)/255;p[at+1]=(13*(255-ink)+244*ink+127)/255;p[at+2]=(8*(255-ink)+227*ink+127)/255;
  }
  col+=cell;
 }
}
