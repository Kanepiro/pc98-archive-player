#include "fullgpu_device.hpp"
#include <cstring>
struct NMS {
 NativeDirectCompute gpu;
 ComPtr<ID3D11ComputeShader> shader;
 ComPtr<ID3D11Buffer> constants;
 NMS(){
  auto path=shaderFilename();path=path.substr(0,path.find_last_of(L"\\/")+1)+L"fullgpu_nms.hlsl";
  ComPtr<ID3DBlob> code,error;
  auto hr=D3DCompileFromFile(path.c_str(),nullptr,nullptr,"main","cs_5_0",D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&code,&error);
  if(FAILED(hr))throw std::runtime_error(error?(char*)error->GetBufferPointer():"NMS compilation");
  checked(gpu.device->CreateComputeShader(code->GetBufferPointer(),code->GetBufferSize(),nullptr,&shader),"NMS shader");
  D3D11_BUFFER_DESC d={};d.ByteWidth=16;d.Usage=D3D11_USAGE_DEFAULT;d.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
  checked(gpu.device->CreateBuffer(&d,nullptr,&constants),"NMS constants");
 }
 void compute(){
  uint32_t header[4];std::cin.read((char*)header,16);
  uint32_t nf=header[1],no=header[2];if(!std::cin||header[0]!=0x534d4e54||nf>896||no>19206||nf==0||no==0)throw std::runtime_error("NMS bounds");
  uint32_t input=nf*17+no*6,output=2+nf*17+36;
  std::vector<uint32_t> host(input+output,0);std::cin.read((char*)host.data(),input*4);if(!std::cin)throw std::runtime_error("NMS input");
  ComPtr<ID3D11Buffer> arena,staging;ComPtr<ID3D11UnorderedAccessView> view;
  D3D11_BUFFER_DESC d={};d.ByteWidth=(UINT)host.size()*4;d.Usage=D3D11_USAGE_DEFAULT;d.BindFlags=D3D11_BIND_UNORDERED_ACCESS;
  d.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;d.StructureByteStride=4;D3D11_SUBRESOURCE_DATA initial={};initial.pSysMem=host.data();
  checked(gpu.device->CreateBuffer(&d,&initial,&arena),"NMS arena");
  D3D11_UNORDERED_ACCESS_VIEW_DESC u={};u.ViewDimension=D3D11_UAV_DIMENSION_BUFFER;u.Buffer.NumElements=(UINT)host.size();
  checked(gpu.device->CreateUnorderedAccessView(arena.Get(),&u,&view),"NMS view");
  d.ByteWidth=output*4;d.Usage=D3D11_USAGE_STAGING;d.BindFlags=0;d.MiscFlags=0;d.StructureByteStride=0;d.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
  checked(gpu.device->CreateBuffer(&d,nullptr,&staging),"NMS staging");
  uint32_t params[]={nf,no,0,input};gpu.context->UpdateSubresource(constants.Get(),0,nullptr,params,0,0);
  ID3D11Buffer* cb[]={constants.Get()};ID3D11UnorderedAccessView* uv[]={view.Get()};
  gpu.context->CSSetShader(shader.Get(),nullptr,0);gpu.context->CSSetConstantBuffers(0,1,cb);gpu.context->CSSetUnorderedAccessViews(0,1,uv,nullptr);
  gpu.context->Dispatch(2,1,1);ID3D11UnorderedAccessView* empty[]={nullptr};gpu.context->CSSetUnorderedAccessViews(0,1,empty,nullptr);
  D3D11_BOX box={input*4,0,0,(input+output)*4,1,1};gpu.context->CopySubresourceRegion(staging.Get(),0,0,0,0,arena.Get(),0,&box);
  D3D11_MAPPED_SUBRESOURCE m={};checked(gpu.context->Map(staging.Get(),0,D3D11_MAP_READ,0,&m),"NMS readback");
  std::cout.write((char*)m.pData,output*4);gpu.context->Unmap(staging.Get(),0);std::cout.flush();
 }
};
int main(int argc,char** argv){
 try{
  _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);NMS engine;
  if(argc==2&&std::string(argv[1])=="--probe"){std::cout<<"DIRECTCOMPUTE_NMS "<<engine.gpu.gpuName<<"\n";return 0;}
  if(argc!=2||std::string(argv[1])!="--stream")throw std::runtime_error("expected --stream");
  while(std::cin.peek()!=std::char_traits<char>::eof())engine.compute();return 0;
 }catch(const std::exception& e){std::cerr<<"NMS_ERROR "<<e.what()<<"\n";return 1;}
}
