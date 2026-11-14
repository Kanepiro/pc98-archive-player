#include "fullgpu_device.hpp"
#include <array>
#include <chrono>
#include <cstring>
struct ModesGPU {
 NativeDirectCompute gpu;
 static constexpr int shaderCount=15;
 std::array<ComPtr<ID3D11ComputeShader>,shaderCount> shaders;
 ComPtr<ID3D11Buffer> arena,staging,counter,constants;
 ComPtr<ID3D11UnorderedAccessView> uav;
 ComPtr<ID3D11Query> disjoint,startTime,endTime;
 uint32_t arenaWords=0,outputWords=0,offsets[32]={};
 struct alignas(16) Params {
  uint32_t W,H,S,Mode,G,hasOld,src,dst,axis,channels,K,blankIndex;
  float brightness,contrast,gamma,edge;
 };
 static const char* entry(int n){
  static const char* names[]={"average","tones","normalizeQuality","gaussianQuality","gradientQuality","peaksQuality","connectQuality","compressQuality","componentsQuality","connectedQuality","targetQuality","sceneQuality","cellsQuality","scoreQuality","rowsQuality"};
  return names[n];
 }
 static ComPtr<ID3DBlob> compile(const char* name){
  auto p=shaderFilename();p=p.substr(0,p.find_last_of(L"\\/")+1)+L"native_modes.hlsl";
  auto cached=readShaderCache(p,name);if(cached)return cached;
  ComPtr<ID3DBlob> code,error;
  auto hr=D3DCompileFromFile(p.c_str(),nullptr,D3D_COMPILE_STANDARD_FILE_INCLUDE,name,"cs_5_0",D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&code,&error);
  if(FAILED(hr))throw std::runtime_error(std::string(name)+": "+(error?(char*)error->GetBufferPointer():"HLSL compilation failed"));
  writeShaderCache(p,name,code.Get());return code;
 }
 ModesGPU(){
  for(int i=0;i<shaderCount;i++){auto c=compile(entry(i));checked(gpu.device->CreateComputeShader(c->GetBufferPointer(),c->GetBufferSize(),nullptr,&shaders[i]),"mode shader");}
  D3D11_BUFFER_DESC b={};b.ByteWidth=sizeof(Params);b.Usage=D3D11_USAGE_DEFAULT;b.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
  checked(gpu.device->CreateBuffer(&b,nullptr,&constants),"mode constants");
  b.ByteWidth=4;b.BindFlags=0;b.Usage=D3D11_USAGE_STAGING;b.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
  checked(gpu.device->CreateBuffer(&b,nullptr,&counter),"mode counter");
  D3D11_QUERY_DESC q={D3D11_QUERY_TIMESTAMP_DISJOINT,0};checked(gpu.device->CreateQuery(&q,&disjoint),"timestamp disjoint");
  q.Query=D3D11_QUERY_TIMESTAMP;checked(gpu.device->CreateQuery(&q,&startTime),"timestamp start");checked(gpu.device->CreateQuery(&q,&endTime),"timestamp end");
 }
 void unbind(){ID3D11UnorderedAccessView* v[]={nullptr};gpu.context->CSSetUnorderedAccessViews(0,1,v,nullptr);}
 void launch(int shader,Params& p,uint32_t count){
  gpu.context->UpdateSubresource(constants.Get(),0,nullptr,&p,0,0);
  ID3D11Buffer* cb[]={constants.Get()};ID3D11UnorderedAccessView* uv[]={uav.Get()};
  gpu.context->CSSetConstantBuffers(0,1,cb);gpu.context->CSSetUnorderedAccessViews(0,1,uv,nullptr);gpu.context->CSSetShader(shaders[shader].Get(),nullptr,0);
  uint32_t groups=shader==11?1:(count+127)/128;
  gpu.context->Dispatch(std::min(65535u,groups),(groups+65534)/65535,1);
 }
 uint32_t changed(){
  unbind();D3D11_BOX b={offsets[26]*4,0,0,(offsets[26]+1)*4,1,1};
  gpu.context->CopySubresourceRegion(counter.Get(),0,0,0,0,arena.Get(),0,&b);
  D3D11_MAPPED_SUBRESOURCE m={};checked(gpu.context->Map(counter.Get(),0,D3D11_MAP_READ,0,&m),"mode convergence");
  uint32_t v=*(uint32_t*)m.pData;gpu.context->Unmap(counter.Get(),0);return v;
 }
 void buffers(uint32_t words,uint32_t output){
  if(words==arenaWords&&output==outputWords)return;
  unbind();arena.Reset();uav.Reset();staging.Reset();
  D3D11_BUFFER_DESC b={};b.ByteWidth=words*4;b.Usage=D3D11_USAGE_DEFAULT;b.BindFlags=D3D11_BIND_UNORDERED_ACCESS;b.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;b.StructureByteStride=4;
  checked(gpu.device->CreateBuffer(&b,nullptr,&arena),"mode arena");
  D3D11_UNORDERED_ACCESS_VIEW_DESC v={};v.ViewDimension=D3D11_UAV_DIMENSION_BUFFER;v.Buffer.NumElements=words;
  checked(gpu.device->CreateUnorderedAccessView(arena.Get(),&v,&uav),"mode arena view");
  b.ByteWidth=output*4;b.Usage=D3D11_USAGE_STAGING;b.BindFlags=0;b.MiscFlags=0;b.StructureByteStride=0;b.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
  checked(gpu.device->CreateBuffer(&b,nullptr,&staging),"mode staging");arenaWords=words;outputWords=output;
 }
 void compute(){
  auto begin=std::chrono::steady_clock::now();uint32_t h[16];std::cin.read((char*)h,64);
  if(!std::cin||h[0]!=0x4d475354||h[1]!=1||h[2]<1||h[2]>3||h[3]<1||h[3]>480||h[4]<1||h[4]>240||h[5]<1||h[5]>10||h[7]>1)throw std::runtime_error("native mode header");
  Params p={h[3],h[4],h[5],h[2],h[6],h[7],0,0,0,1,0,h[12],0,1,1,0};std::memcpy(&p.brightness,h+8,16);
  if(!std::isfinite(p.brightness)||p.brightness< -100||p.brightness>100||!std::isfinite(p.contrast)||p.contrast<.25||p.contrast>3||!std::isfinite(p.gamma)||p.gamma<.4||p.gamma>2.5||!std::isfinite(p.edge)||p.edge<0||p.edge>1)throw std::runtime_error("native mode settings");
  uint64_t n64=uint64_t(p.W)*p.H*p.S*p.S;uint32_t C=p.W*p.H;
  if(n64>3000000||(p.Mode==3&&(p.G<2||p.G>128||p.blankIndex>=p.G||uint64_t(C)*p.G>10000000)))throw std::runtime_error("native mode capacity");
  if(p.Mode!=3&&(p.G||p.hasOld))throw std::runtime_error("native tone header");uint32_t N=(uint32_t)n64;
  std::vector<uint32_t> host(32,0);
  auto alloc=[&](uint32_t slot,uint32_t words){offsets[slot]=(uint32_t)host.size();host.resize(host.size()+words,0);};
  for(uint32_t k=0;k<32;k++){
   uint32_t words=1;
   if(k==0)words=N;
   if(p.Mode!=3){if(k==1)words=C*4;if(k==25)words=C;}
   else {
    if(k>=1&&k<=3)words=N*4;else if(k>=4&&k<=16)words=N;
    else if(k==17||k==19)words=p.G;else if(k==18)words=p.G*2*p.S*p.S;
    else if(k==20||k==25)words=C;else if(k==21)words=C*6;else if(k==22)words=C*p.G;
    else if(k==23||k==24)words=(p.W+1)*p.H;
   }
   alloc(k,words);
  }
  std::copy(offsets,offsets+32,host.begin());
  auto read=[&](uint32_t slot,uint32_t words){std::cin.read((char*)(host.data()+offsets[slot]),words*4);if(!std::cin)throw std::runtime_error("native mode payload truncated");};
  read(0,N);
  if(p.Mode==3){
   read(17,p.G);read(18,p.G*2*p.S*p.S);read(19,p.G);
   for(uint32_t j=0;j<p.G;j++)if(host[offsets[17]+j]<1||host[offsets[17]+j]>2)throw std::runtime_error("glyph width");
   if(p.hasOld){read(15,N);read(16,N);read(20,C);}else std::fill(host.begin()+offsets[20],host.begin()+offsets[20]+C,0xffffffff);
  }
  uint32_t count=C+(p.Mode==3?N*2:0);buffers((uint32_t)host.size(),count);
  gpu.context->UpdateSubresource(arena.Get(),0,nullptr,host.data(),0,0);
  gpu.context->Begin(disjoint.Get());gpu.context->End(startTime.Get());
  if(p.Mode!=3){launch(0,p,C);launch(1,p,C);}
  else {
   launch(2,p,N);
   p.channels=4;p.K=0;p.src=1;p.dst=2;p.axis=0;launch(3,p,N*4);p.src=2;p.dst=3;p.axis=1;launch(3,p,N*4);
   p.channels=1;
   for(uint32_t k=1;k<=2;k++){p.K=k;p.src=14;p.dst=6;p.axis=0;launch(3,p,N);p.src=6;p.dst=k==1?4:5;p.axis=1;launch(3,p,N);}
   launch(4,p,N);launch(5,p,N);bool converged=false;
   for(int iter=0;iter<64;iter++){
    unbind();uint32_t zero=0;D3D11_BOX b={offsets[26]*4,0,0,(offsets[26]+1)*4,1,1};gpu.context->UpdateSubresource(arena.Get(),0,&b,&zero,0,0);
    launch(6,p,N);launch(7,p,N);if(!changed()){converged=true;break;}
   }
   if(!converged)throw std::runtime_error("native edge connectivity did not converge; CPU fallback");
   launch(8,p,N);launch(9,p,N);launch(10,p,N);launch(11,p,1);launch(12,p,C);launch(13,p,C*p.G);launch(14,p,p.H);
  }
  gpu.context->End(endTime.Get());gpu.context->End(disjoint.Get());unbind();uint32_t dest=0;
  auto copy=[&](uint32_t slot,uint32_t words){D3D11_BOX b={offsets[slot]*4,0,0,(offsets[slot]+words)*4,1,1};gpu.context->CopySubresourceRegion(staging.Get(),0,dest,0,0,arena.Get(),0,&b);dest+=words*4;};
  copy(25,C);if(p.Mode==3){copy(13,N);copy(14,N);}
  D3D11_MAPPED_SUBRESOURCE m={};checked(gpu.context->Map(staging.Get(),0,D3D11_MAP_READ,0,&m),"native mode output");
  uint32_t header[]={0x52475354,1,p.Mode,p.W,p.H,p.G,N,C};std::cout.write((char*)header,32);std::cout.write((char*)m.pData,count*4);gpu.context->Unmap(staging.Get(),0);
  D3D11_QUERY_DATA_TIMESTAMP_DISJOINT q={};UINT64 a=0,b=0;double gpuMs=-1;
  if(gpu.context->GetData(disjoint.Get(),&q,sizeof(q),0)==S_OK&&!q.Disjoint&&q.Frequency&&gpu.context->GetData(startTime.Get(),&a,sizeof(a),0)==S_OK&&gpu.context->GetData(endTime.Get(),&b,sizeof(b),0)==S_OK)gpuMs=double(b-a)*1000/double(q.Frequency);
  double times[]={gpuMs,std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-begin).count()};std::cout.write((char*)times,16);std::cout.flush();
 }
};
int main(int argc,char** argv){
 try{
  _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
  if(argc==2&&std::string(argv[1])=="--check-shader"){for(int i=0;i<ModesGPU::shaderCount;i++){auto c=ModesGPU::compile(ModesGPU::entry(i));std::cout<<ModesGPU::entry(i)<<" "<<c->GetBufferSize()<<" bytes\n";}return 0;}
  ModesGPU engine;
  if(argc==2&&std::string(argv[1])=="--probe"){std::cout<<"DIRECTCOMPUTE_MODES "<<engine.gpu.gpuName<<"\n";return 0;}
  if(argc!=2||std::string(argv[1])!="--stream")throw std::runtime_error("expected --stream");
  while(std::cin.peek()!=std::char_traits<char>::eof())engine.compute();return 0;
 }catch(const std::exception& e){std::cerr<<"NATIVE_MODES_ERROR "<<e.what()<<"\n";return 1;}
}
