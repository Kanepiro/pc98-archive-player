#define main original_renderer_main
#include "../native-boost/tsl_render_win.cpp"
#undef main
int main(int argc,char** argv){
 try{
  if(argc!=2)return 2;std::ifstream input(argv[1],std::ios::binary);
  std::string bytes((std::istreambuf_iterator<char>(input)),{});
  std::cout<<"size,codepoint,minY,maxY,ink,ascent,descent\n";
  for(bool native:{false,true}){
   Surface s(2,4,native);TEXTMETRICW tm{};GetTextMetricsW(s.hdc,&tm);
   for(size_t i=0;i<bytes.size();){
    int len=leadByte((unsigned char)bytes[i])?2:1;
    wchar_t c=0;MultiByteToWideChar(932,0,bytes.data()+i,len,&c,1);
    s.draw("\r\n"+bytes.substr(i,len)+"\r\n\r\n\r\n",2,4);GdiFlush();
    int lo=s.height,hi=-1,count=0;auto* px=(unsigned char*)s.pixels;
    for(int y=0;y<s.height;y++)for(int x=0;x<s.width;x++){
     auto off=(y*s.width+x)*4;
     if(px[off]!=18||px[off+1]!=13||px[off+2]!=8){lo=std::min(lo,y);hi=std::max(hi,y);count++;}
    }
    std::cout<<(native?16:20)<<","<<unsigned(c)<<","<<lo-s.ch<<","<<hi-s.ch<<","<<count<<","<<tm.tmAscent<<","<<tm.tmDescent<<"\n";
    i+=len;
   }
  }
  return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
}
