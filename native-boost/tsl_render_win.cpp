// Windows-native TSL frame renderer: PC-98 8x16/16x16 geometry to BGRA.
// Streams video frames to stdout for FFmpeg NVENC/CPU encoding.
// Built against stock Win32 GDI. No extra runtime, fonts, or assets.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>
#include <fcntl.h>
#include <io.h>

static int positive(const std::string& x){
 const int n=std::stoi(x);
 if(n<=0||n>1000000)throw std::runtime_error("invalid positive number");
 return n;
}
struct Params{std::string input; int fps=24,outWidth=0,outHeight=0,nv12=0;};
static Params args(int argc,char** argv){
 Params a;
 for(int i=1;i<argc;++i){
  if(i+1>=argc)throw std::runtime_error("missing argument value");
  std::string k=argv[i],v=argv[++i];
  if(k=="--input")a.input=v;
  else if(k=="--fps")a.fps=positive(v);
  else if(k=="--output-width")a.outWidth=positive(v);
  else if(k=="--output-height")a.outHeight=positive(v);
  else if(k=="--nv12")a.nv12=positive(v);
  else throw std::runtime_error("unknown argument");
 }
 if(a.input.empty()||a.fps<5||a.fps>30)throw std::runtime_error("invalid renderer options");
 return a;
}
static std::vector<std::string_view> sections(const std::string& bytes){
 std::vector<std::string_view> out;
 size_t start=0,at;
 while((at=bytes.find("\f\r\n",start))!=std::string::npos){
  out.emplace_back(bytes.data()+start,at-start);
  start=at+3;
 }
 out.emplace_back(bytes.data()+start,bytes.size()-start);
 return out;
}
static bool leadByte(unsigned char b){return (b>=0x81&&b<=0x9f)||(b>=0xe0&&b<=0xfc);}
static std::string clean(std::string s){if(!s.empty()&&s.back()=='\r')s.pop_back();return s;}
static std::vector<std::string> lines(std::string_view input){
 std::vector<std::string> out;
 std::istringstream is{std::string(input)};
 std::string line;
 while(std::getline(is,line))out.push_back(clean(line));
 return out;
}
struct TSL{
 std::string bytes;
 std::vector<std::string_view> chunks;
 std::vector<int> ticks;
 int count=0,width=0,height=0,durationTicks=0;
 bool native16=false;
 explicit TSL(const std::string& filename){
  std::ifstream src(filename,std::ios::binary);
  if(!src)throw std::runtime_error("TSL file not found");
  bytes.assign(std::istreambuf_iterator<char>(src),{});
  if(bytes.empty()||bytes.back()!='\x1a')throw std::runtime_error("bad TSL terminator");
  chunks=sections(bytes);
  if(chunks.size()<4)throw std::runtime_error("invalid TSL sections");
  auto header=lines(chunks[0]);
  if(header.size()<4||header[0]!="1.08")throw std::runtime_error("unsupported TSL format");
  count=positive(header[1]);width=positive(header[2]);height=positive(header[3]);
  if(count>10000||width>480||height>240||chunks.size()<size_t(count+3))
   throw std::runtime_error("TSL size/count invalid");
  for(const auto& s:header)if(s=="# PC98_FONT_16X16")native16=true;
  ticks.reserve(count+1);
  int at=0;
  for(const std::string& line:lines(chunks[1])){
   int index=0,duration=0;
   std::istringstream is(line);
   if(!(is>>index>>duration)||index==0)break;
   if(index!=int(ticks.size()+1)||duration<1||duration>360000)
    throw std::runtime_error("bad TSL frame timing");
   ticks.push_back(at);
   at+=duration;
  }
  if(int(ticks.size())!=count||at<=0||at>432000)
   throw std::runtime_error("TSL timeline is incomplete");
  durationTicks=at;
 }
 std::string_view frame(int n)const{return chunks.at(2+n);}
};
struct Surface{
 HDC hdc=nullptr;
 HBITMAP bitmap=nullptr,previous=nullptr;
 HFONT font=nullptr,oldFont=nullptr;
 HBRUSH brush=nullptr;
 void* pixels=nullptr;
 int width=0,height=0,cw=0,ch=0;
 Surface(int cols,int rows,bool native){
  cw=native?8:12;ch=native?16:24;
  width=cols*cw;height=rows*ch;
  if(width<=0||height<=0||width>7680||height>5760)
   throw std::runtime_error("TSL output dimensions invalid");
  hdc=CreateCompatibleDC(nullptr);
  if(!hdc)throw std::runtime_error("CreateCompatibleDC failed");
  BITMAPINFO bmi{};
  bmi.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);
  bmi.bmiHeader.biWidth=width;
  bmi.bmiHeader.biHeight=-height; // top-down BGRA
  bmi.bmiHeader.biPlanes=1;
  bmi.bmiHeader.biBitCount=32;
  bmi.bmiHeader.biCompression=BI_RGB;
  bitmap=CreateDIBSection(hdc,&bmi,DIB_RGB_COLORS,&pixels,nullptr,0);
  if(!bitmap||!pixels)throw std::runtime_error("CreateDIBSection failed");
  previous=(HBITMAP)SelectObject(hdc,bitmap);
  font=CreateFontW(-(native?16:20),0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,SHIFTJIS_CHARSET,
   OUT_TT_PRECIS,CLIP_DEFAULT_PRECIS,NONANTIALIASED_QUALITY,
   FIXED_PITCH|FF_MODERN,L"MS Gothic");
  if(!font)throw std::runtime_error("CreateFontW failed");
  oldFont=(HFONT)SelectObject(hdc,font);
  brush=CreateSolidBrush(RGB(8,13,18));
  SetBkMode(hdc,TRANSPARENT);
  SetTextColor(hdc,RGB(227,244,232));
 }
 ~Surface(){
  if(hdc){
   if(oldFont)SelectObject(hdc,oldFont);
   if(previous)SelectObject(hdc,previous);
  }
  if(font)DeleteObject(font);
  if(bitmap)DeleteObject(bitmap);
  if(brush)DeleteObject(brush);
  if(hdc)DeleteDC(hdc);
 }
 void draw(std::string_view frame,int columns,int rows){
  RECT rect{0,0,width,height};
  FillRect(hdc,&rect,brush);
  size_t pos=0;
  for(int row=0;row<rows;row++){
   const size_t end=frame.find("\r\n",pos);
   if(end==std::string_view::npos)throw std::runtime_error("TSL frame rows missing");
   std::string_view line=frame.substr(pos,end-pos);
   pos=end+2;
   std::vector<wchar_t> chars;
   std::vector<int> advances;
   chars.reserve(line.size());advances.reserve(line.size());
   int col=0;
   for(size_t i=0;i<line.size()&&col<columns;){
    unsigned char b=(unsigned char)line[i];
    int bytes=(leadByte(b)&&i+1<line.size())?2:1;
    const int cwUsed=bytes==2?2:1;
    if(col+cwUsed>columns)break;
    wchar_t wide=0;
    int n=MultiByteToWideChar(932,0,line.data()+i,bytes,&wide,1);
    if(n==0)wide=L'?';
    chars.push_back(wide);
    advances.push_back(cw*cwUsed);
    col+=cwUsed;
    i+=bytes;
   }
   if(!chars.empty()&&!ExtTextOutW(hdc,0,row*ch,0,nullptr,chars.data(),
       (UINT)chars.size(),advances.data())){
    throw std::runtime_error("ExtTextOutW failed");
   }
  }
 }
};
int main(int argc,char** argv){
 try{
  _setmode(_fileno(stdout),_O_BINARY);
  const auto a=args(argc,argv);
  const TSL t(a.input);
  Surface surface(t.width,t.height,t.native16);
  const int frames=int((int64_t(t.durationTicks)*a.fps+59)/60);
  if(frames<1||frames>216000)throw std::runtime_error("bad requested frame count");
  const size_t size=size_t(surface.width)*size_t(surface.height)*4;
  int last=-1;
  for(int i=0;i<frames;i++){
   const int tick=int(int64_t(i)*60/a.fps);
   const auto it=std::upper_bound(t.ticks.begin(),t.ticks.end(),tick);
   const int n=std::max(0,int(it-t.ticks.begin())-1);
   if(n!=last){surface.draw(t.frame(n),t.width,t.height);last=n;}
   std::cout.write((const char*)surface.pixels,std::streamsize(size));
   if(!std::cout)throw std::runtime_error("writing raw video failed");
   if((i+1)%24==0||i==frames-1)
    std::cerr<<"RENDER "<<i+1<<"/"<<frames<<"\n";
  }
  return 0;
 }catch(const std::exception& e){
  std::cerr<<"RENDER_ERROR "<<e.what()<<"\n";
  return 1;
 }
}