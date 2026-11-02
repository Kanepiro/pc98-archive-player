#include "../src/mms/engine.hpp"
#include <openssl/sha.h>
#include <fstream>
#include <iomanip>
#include <iostream>
static std::string digest(SHA256_CTX c){unsigned char b[32];SHA256_Final(b,&c);std::ostringstream s;for(auto x:b)s<<std::hex<<std::setw(2)<<std::setfill('0')<<int(x);return s.str();}
int main(int argc,char**argv){
 if(argc<2)return 2;
 try{
 std::ifstream f(argv[1],std::ios::binary);if(!f)throw std::runtime_error("file missing");
 mm::Bytes b((std::istreambuf_iterator<char>(f)),{});mm::Engine e(mm::load(b));e.minimumFrameInterval=1.0/120;
 SHA256_CTX video,audio;SHA256_Init(&video);SHA256_Init(&audio);uint64_t frames=0,samples=0,nonzero=0;
 e.frame=[&](double,const std::vector<uint32_t>&rgb,int,int){std::vector<uint8_t>rgba(rgb.size()*4);for(size_t i=0;i<rgb.size();i++){auto c=rgb[i];rgba[i*4]=c>>16;rgba[i*4+1]=c>>8;rgba[i*4+2]=c;rgba[i*4+3]=255;}SHA256_Update(&video,rgba.data(),rgba.size());frames++;};
 e.key=[](int){return false;};int16_t pcm[960];
 while(samples<48000*5&&!e.ended){e.renderAudio(pcm,960,48000,samples);samples+=960;for(auto x:pcm)if(x)nonzero++;SHA256_Update(&audio,pcm,sizeof(pcm));if(!e.error.empty())throw std::runtime_error(e.error);}
 std::cout<<"{\"frames\":"<<frames<<",\"samples\":"<<samples<<",\"nonzero\":"<<nonzero<<",\"videoHash\":\""<<digest(video)<<"\",\"audioHash\":\""<<digest(audio)<<"\"}\n";
 }catch(const std::exception&e){std::cerr<<e.what()<<"\n";return 1;}
}
