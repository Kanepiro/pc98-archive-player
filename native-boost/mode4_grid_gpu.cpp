#include "fullgpu_device.hpp"
#include <chrono>
struct GridGPU{
 NativeDirectCompute gpu;
 ComPtr<ID3D11ComputeShader> shader;
 ComPtr<ID3D11Buffer> output,staging,constants;
 ComPtr<ID3D11UnorderedAccessView> view;
 uint32_t capacity=0;
 GridGPU(){
  auto p=shaderFilename();p=p.substr(0,p.find_last_of(L"\\/")+1)+L"mode4_grid_gpu.hlsl";
  ComPtr<ID3DBlob> code,error;
  auto hr=D3DCompileFromFile(p.c_str(),nullptr,nullptr,"main","cs_5_0",D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&code,&error);
  if(FAILED(hr))throw std::runtime_error(error?(char*)error->GetBufferPointer():"Grid120 shader compilation failed");
  checked(gpu.device->CreateComputeShader(code->GetBufferPointer(),code->GetBufferSize(),nullptr,&shader),"Grid120 shader");
  D3D11_BUFFER_DESC b={};b.ByteWidth=16;b.Usage=D3D11_USAGE_DEFAULT;b.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
  checked(gpu.device->CreateBuffer(&b,nullptr,&constants),"Grid120 constants");
 }
 void compute(){
  auto started=std::chrono::steady_clock::now();uint32_t h[8];std::cin.read((char*)h,32);
  if(!std::cin||h[0]!=0x30324754||h[1]!=1||h[2]<1||h[2]>4096||h[3]!=170||h[4]!=469)throw std::runtime_error("Grid120 protocol");
  uint32_t C=h[2],G=h[3],D=h[4],N=C*G;
  std::vector<float> t(C*D),g(G*D);std::cin.read((char*)t.data(),t.size()*4);std::cin.read((char*)g.data(),g.size()*4);
  if(!std::cin)throw std::runtime_error("Grid120 truncated payload");
  for(float v:t)if(!std::isfinite(v))throw std::runtime_error("Grid120 target nonfinite");
  for(float v:g)if(!std::isfinite(v))throw std::runtime_error("Grid120 glyph nonfinite");
  auto targets=gpu.upload(t),glyphs=gpu.upload(g);
  if(capacity!=N){
   output.Reset();staging.Reset();view.Reset();
   D3D11_BUFFER_DESC b={};b.ByteWidth=N*4;b.Usage=D3D11_USAGE_DEFAULT;b.BindFlags=D3D11_BIND_UNORDERED_ACCESS;b.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;b.StructureByteStride=4;
   checked(gpu.device->CreateBuffer(&b,nullptr,&output),"Grid120 scores");
   D3D11_UNORDERED_ACCESS_VIEW_DESC v={};v.ViewDimension=D3D11_UAV_DIMENSION_BUFFER;v.Buffer.NumElements=N;
   checked(gpu.device->CreateUnorderedAccessView(output.Get(),&v,&view),"Grid120 score view");
   b.Usage=D3D11_USAGE_STAGING;b.BindFlags=0;b.MiscFlags=0;b.StructureByteStride=0;b.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
   checked(gpu.device->CreateBuffer(&b,nullptr,&staging),"Grid120 readback");capacity=N;
  }
  uint32_t params[]={C,G,D,0};gpu.context->UpdateSubresource(constants.Get(),0,nullptr,params,0,0);
  ID3D11Buffer* cb[]={constants.Get()};ID3D11ShaderResourceView* ins[]={targets.srv.Get(),glyphs.srv.Get()};ID3D11UnorderedAccessView* outs[]={view.Get()};
  gpu.context->CSSetShader(shader.Get(),nullptr,0);gpu.context->CSSetConstantBuffers(0,1,cb);gpu.context->CSSetShaderResources(0,2,ins);gpu.context->CSSetUnorderedAccessViews(0,1,outs,nullptr);
  gpu.context->Dispatch((N+127)/128,1,1);
  ID3D11UnorderedAccessView* nil[]={nullptr};gpu.context->CSSetUnorderedAccessViews(0,1,nil,nullptr);
  gpu.context->CopyResource(staging.Get(),output.Get());
  D3D11_MAPPED_SUBRESOURCE m={};checked(gpu.context->Map(staging.Get(),0,D3D11_MAP_READ,0,&m),"Grid120 map");
  uint32_t header[]={0x52324754,C,G,D};std::cout.write((char*)header,16);std::cout.write((char*)m.pData,N*4);gpu.context->Unmap(staging.Get(),0);
  double timing[]={-1,std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-started).count()};std::cout.write((char*)timing,16);std::cout.flush();
 }
};
int main(int argc,char** argv){
 try{
  _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
  GridGPU engine;
  if(argc==2&&std::string(argv[1])=="--probe"){std::cout<<"DIRECTCOMPUTE_GRID120 "<<engine.gpu.gpuName<<"\n";return 0;}
  if(argc!=2||std::string(argv[1])!="--stream")throw std::runtime_error("Expected --stream");
  while(std::cin.peek()!=std::char_traits<char>::eof())engine.compute();
  return 0;
 }catch(const std::exception& e){std::cerr<<"GRID120_ERROR "<<e.what()<<"\n";return 1;}
}
