#pragma once
#include <filesystem>
#include <fstream>
#include <iterator>
#include <vector>
#include <stdexcept>
// Process-private registration, kept alive until every HFONT has been released.
// Each CPU/GPU rasterizer is a separate process and registers its own font.
struct TaslPrivateFont {
 std::vector<unsigned char> bytes;
 HANDLE handle=nullptr;
 TaslPrivateFont(){
  std::vector<wchar_t> exe(32768);
  DWORD length=GetModuleFileNameW(nullptr,exe.data(),DWORD(exe.size()));
  if(!length||length>=exe.size())throw std::runtime_error("Cannot locate bundled Noto font");
  auto dir=std::filesystem::path(std::wstring(exe.data(),length)).parent_path();
  auto file=dir/L"app"/L"fonts"/L"NotoSansMonoCJKjp-Regular.otf";
  if(!std::filesystem::is_regular_file(file))file=dir/L"fonts"/L"NotoSansMonoCJKjp-Regular.otf";
  std::ifstream input(file,std::ios::binary);
  if(!input)throw std::runtime_error("Bundled Noto font is missing; OS font fallback is disabled");
  bytes.assign(std::istreambuf_iterator<char>(input),{});
  if(bytes.size()!=16424156)throw std::runtime_error("Bundled Noto font size mismatch");
  DWORD count=0;
  handle=AddFontMemResourceEx(bytes.data(),DWORD(bytes.size()),nullptr,&count);
  if(!handle||count!=1)throw std::runtime_error("Cannot register process-private Noto font");
 }
 ~TaslPrivateFont(){if(handle)RemoveFontMemResourceEx(handle);}
 TaslPrivateFont(const TaslPrivateFont&)=delete;
 TaslPrivateFont& operator=(const TaslPrivateFont&)=delete;
};
inline void ensureTaslPrivateFont(){static TaslPrivateFont font;}
inline void verifyTaslFace(HDC dc){
 wchar_t face[128]={};
 if(!GetTextFaceW(dc,128,face)||std::wstring(face)!=L"Noto Sans Mono CJK JP")
  throw std::runtime_error("Noto font selection failed; OS font fallback is disabled");
 std::cerr<<"FONT_FACE Noto Sans Mono CJK JP (process-private bundled OTF)\n";
}
inline void verifyTaslGlyph(HDC dc,wchar_t character){
 WORD glyph=0xffff;
 if(GetGlyphIndicesW(dc,&character,1,&glyph,GGI_MARK_NONEXISTING_GLYPHS)==GDI_ERROR||glyph==0xffff){
  std::ostringstream message;message<<"Bundled Noto has no glyph U+"<<std::hex<<unsigned(character);
  throw std::runtime_error(message.str());
 }
}
