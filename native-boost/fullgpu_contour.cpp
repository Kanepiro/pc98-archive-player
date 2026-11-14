#include "fullgpu_device.hpp"
#include <array>
#include <chrono>
#include <cstring>
struct ContourGPU {
 NativeDirectCompute gpu;
 std::array<ComPtr<ID3D11ComputeShader>,12> shaders;
 ComPtr<ID3D11Buffer> buffer,readback,counterReadback,constants;
 ComPtr<ID3D11UnorderedAccessView> uav;
 std::vector<uint32_t> host;
 uint32_t offsets[15]={};
 struct alignas(16) Params {uint32_t w,h,op,stage,source,destination,axis,count;float brightness,contrast,gamma,reserved;};
 static ComPtr<ID3DBlob> compile(const char* entry){
  auto path=shaderFilename();path=path.substr(0,path.find_last_of(L"\\/")+1)+L"fullgpu_contour.hlsl";
  ComPtr<ID3DBlob> code,error;
  auto hr=D3DCompileFromFile(path.c_str(),nullptr,D3D_COMPILE_STANDARD_FILE_INCLUDE,entry,"cs_5_0",
    D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&code,&error);
  if(FAILED(hr))throw std::runtime_error(std::string(entry)+": "+(error?(char*)error->GetBufferPointer():"compile failed"));
  return code;
 }
 ContourGPU(){
  const char* entries[]={"normalize","blur","grayCopy","gradient","peaks","connect","compress","componentStats","target","distanceField","thin","thin"};
  for(size_t i=0;i<12;i++){auto c=compile(entries[i]);checked(gpu.device->CreateComputeShader(c->GetBufferPointer(),c->GetBufferSize(),nullptr,&shaders[i]),"contour shader");}
  D3D11_BUFFER_DESC d={};d.ByteWidth=sizeof(Params);d.BindFlags=D3D11_BIND_CONSTANT_BUFFER;d.Usage=D3D11_USAGE_DEFAULT;
  checked(gpu.device->CreateBuffer(&d,nullptr,&constants),"contour constants");
  d.ByteWidth=16;d.Usage=D3D11_USAGE_STAGING;d.BindFlags=0;d.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
  checked(gpu.device->CreateBuffer(&d,nullptr,&counterReadback),"contour counter readback");
 }
 void launch(int entry,Params& p,uint32_t count){
  gpu.context->UpdateSubresource(constants.Get(),0,nullptr,&p,0,0);
  ID3D11Buffer* cb[]={constants.Get()};ID3D11UnorderedAccessView* uv[]={uav.Get()};
  gpu.context->CSSetConstantBuffers(0,1,cb);gpu.context->CSSetUnorderedAccessViews(0,1,uv,nullptr);
  gpu.context->CSSetShader(shaders[entry].Get(),nullptr,0);
  uint32_t groups=(count+127)/128;if(groups>65535)throw std::runtime_error("contour dispatch size");
  gpu.context->Dispatch(groups,1,1);
 }
 void unbind(){ID3D11UnorderedAccessView* empty[]={nullptr};gpu.context->CSSetUnorderedAccessViews(0,1,empty,nullptr);}
 uint32_t changed(){
  unbind();D3D11_BOX box={offsets[13]*4,0,0,offsets[13]*4+16,1,1};
  gpu.context->CopySubresourceRegion(counterReadback.Get(),0,0,0,0,buffer.Get(),0,&box);
  D3D11_MAPPED_SUBRESOURCE mapped={};checked(gpu.context->Map(counterReadback.Get(),0,D3D11_MAP_READ,0,&mapped),"contour convergence");
  uint32_t value=((uint32_t*)mapped.pData)[1];gpu.context->Unmap(counterReadback.Get(),0);return value;
 }
 void compute(){
  auto begin=std::chrono::steady_clock::now();
  uint32_t head[8];std::cin.read((char*)head,sizeof(head));if(!std::cin)throw std::runtime_error("contour header");
  if(head[0]!=0x43504754||head[1]<1||head[1]>3||head[2]<4||head[3]<4||uint64_t(head[2])*head[3]>3000000)throw std::runtime_error("contour bounds");
  Params p={head[2],head[3],head[1],0,0,0,0,1,0,1,1,0};
  std::memcpy(&p.brightness,head+4,12);
  if(!std::isfinite(p.brightness)||!std::isfinite(p.contrast)||!std::isfinite(p.gamma)||p.gamma<=0)throw std::runtime_error("contour settings");
  uint32_t n=p.w*p.h;host.assign(64,0);
  auto allocate=[&](uint32_t index,uint32_t count){offsets[index]=(uint32_t)host.size();host.resize(host.size()+count,0);};
  for(uint32_t k=0;k<15;k++)allocate(k,k==1||k==2?4*n:k==13?4:n);
  std::copy(offsets,offsets+15,host.begin());
  uint32_t input=p.op==1?0:p.op==2?10:7;
  std::cin.read((char*)(host.data()+offsets[input]),n*4);if(!std::cin)throw std::runtime_error("contour pixels");
  if(p.op==3)for(uint32_t i=0;i<n;i++)if(host[offsets[7]+i]>1)throw std::runtime_error("skeleton mask not binary");
  buffer.Reset();readback.Reset();uav.Reset();
  D3D11_BUFFER_DESC d={};d.ByteWidth=(UINT)host.size()*4;d.Usage=D3D11_USAGE_DEFAULT;
  d.BindFlags=D3D11_BIND_UNORDERED_ACCESS;d.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;d.StructureByteStride=4;
  D3D11_SUBRESOURCE_DATA data={};data.pSysMem=host.data();checked(gpu.device->CreateBuffer(&d,&data,&buffer),"contour arena");
  D3D11_UNORDERED_ACCESS_VIEW_DESC ud={};ud.ViewDimension=D3D11_UAV_DIMENSION_BUFFER;ud.Buffer.NumElements=(UINT)host.size();
  checked(gpu.device->CreateUnorderedAccessView(buffer.Get(),&ud,&uav),"contour arena view");
  d.BindFlags=0;d.MiscFlags=0;d.StructureByteStride=0;d.Usage=D3D11_USAGE_STAGING;d.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
  checked(gpu.device->CreateBuffer(&d,nullptr,&readback),"contour readback");
  if(p.op==1){
   launch(0,p,n);
   p.count=4;p.source=1;p.destination=2;p.axis=0;launch(1,p,4*n);
   p.source=2;p.destination=1;p.axis=1;launch(1,p,4*n);
   launch(2,p,n);p.count=1;
   for(int i=0;i<2;i++){p.source=4;p.destination=14;p.axis=0;launch(1,p,n);p.source=14;p.destination=4;p.axis=1;launch(1,p,n);}
   launch(3,p,n);launch(4,p,n);
   bool converged=false;
   for(int iter=0;iter<64;iter++){
    unbind();uint32_t zero=0;D3D11_BOX box={(offsets[13]+1)*4,0,0,(offsets[13]+2)*4,1,1};
    gpu.context->UpdateSubresource(buffer.Get(),0,&box,&zero,0,0);
    launch(5,p,n);launch(6,p,n);
    if(!changed()){converged=true;break;}
   }
   if(!converged)throw std::runtime_error("GPU contour connectivity did not converge; CPU retry required");
   launch(7,p,n);launch(8,p,n);launch(9,p,n);
  }else if(p.op==2){launch(9,p,n);}
  else{
   for(int pass=0;pass<12;pass++){
    p.source=7;p.destination=8;p.stage=0;launch(10,p,n);
    p.source=8;p.destination=7;p.stage=1;launch(10,p,n);
   }
  }
  unbind();gpu.context->CopyResource(readback.Get(),buffer.Get());
  D3D11_MAPPED_SUBRESOURCE mapped={};checked(gpu.context->Map(readback.Get(),0,D3D11_MAP_READ,0,&mapped),"contour result");
  auto* result=(uint32_t*)mapped.pData;
  uint32_t outputHeader[]={0x43524754,p.op,n,0};std::cout.write((char*)outputHeader,16);
  if(p.op==1){for(auto k:{10,3,11})std::cout.write((char*)(result+offsets[k]),n*4);}
  else std::cout.write((char*)(result+offsets[p.op==2?11:7]),n*4);
  gpu.context->Unmap(readback.Get(),0);
  double wall=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-begin).count();
  std::cout.write((char*)&wall,8);std::cout.flush();
 }
};
int main(int argc,char** argv){
 try{
  _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
  if(argc==2&&std::string(argv[1])=="--check-shader"){
   for(auto e:{"normalize","blur","grayCopy","gradient","peaks","connect","compress","componentStats","target","distanceField","thin"}){
    auto c=ContourGPU::compile(e);std::cout<<e<<" "<<c->GetBufferSize()<<" bytes\n";
   }return 0;
  }
  ContourGPU engine;
  if(argc==2&&std::string(argv[1])=="--probe"){std::cout<<"DIRECTCOMPUTE_CONTOUR "<<engine.gpu.gpuName<<"\n";return 0;}
  if(argc!=2||std::string(argv[1])!="--stream")throw std::runtime_error("expected --stream");
  while(std::cin.peek()!=std::char_traits<char>::eof())engine.compute();
  return 0;
 }catch(const std::exception& e){std::cerr<<"CONTOUR_ERROR "<<e.what()<<"\n";return 1;}
}
