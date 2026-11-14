#include "fullgpu_device.hpp"
int main(int argc,char** argv){
 try{
  _setmode(_fileno(stdin),_O_BINARY);
  _setmode(_fileno(stdout),_O_BINARY);
  if(argc==2&&std::string(argv[1])=="--check-shader"){
   auto shader=compileShader();
   std::cout<<"D3D11_CSPROFILE_cs_5_0_COMPILED "<<shader->GetBufferSize()<<" bytes\n";
   return 0;
  }
  NativeDirectCompute gpu;
  if(argc==2&&std::string(argv[1])=="--probe"){
   std::cout<<"DIRECTCOMPUTE_GPU "<<gpu.gpuName<<"\n";
   return 0;
  }
  if(argc>2||(argc==2&&std::string(argv[1])!="--stream"))
   throw std::runtime_error("Unknown DirectCompute arguments");
  const bool stream=argc==2;
  int frames=0;
  do{
   if(stream&&std::cin.peek()==std::char_traits<char>::eof())break;
   Payload payload; // exact existing PC Boost binary payload, no new AA method
   auto scores=gpu.compute(payload);
   std::cout.write((const char*)scores.data(),
    std::streamsize(scores.size()*sizeof(double)));
   std::cout.flush();
   if(!std::cout)throw std::runtime_error("DirectCompute output pipe broken");
   frames++;
  }while(stream);
  return frames?0:1;
 }catch(const std::exception& e){
  std::cerr<<"DIRECTCOMPUTE_ERROR "<<e.what()<<"\n";
  return 1;
 }
}
