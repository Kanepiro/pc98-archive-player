// TASL native Mode4 DirectCompute (Direct3D 11 / HLSL cs_5_0).
// NO WebGPU or browser GPU API. Windows C++ itself owns the D3D11 device.
// This reuses the original exact scoring payload and formula geometry.
// Web/JS keeps ALL original face detection, contour processing and global layout.
// GPU fp32 output is intentionally allowed to differ from CPU float64 glyphs.
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi.h>
#include <wrl/client.h>
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

// Share the same protocol parser and safety bounds as the original scorer.
// Rename (do not invoke) that standalone CPU program's main().
#define main original_mode4_cpu_entry
#include "mode4_score_exact.cpp"
#undef main

using Microsoft::WRL::ComPtr;

static void checked(HRESULT hr,const char* message){
 if(SUCCEEDED(hr))return;
 std::ostringstream out;out<<message<<" (HRESULT=0x"<<std::hex<<(uint32_t)hr<<")";
 throw std::runtime_error(out.str());
}
static std::wstring shaderFilename(){
 wchar_t path[32768]={};
 const DWORD n=GetModuleFileNameW(nullptr,path,32767);
 if(n==0||n>=32767)throw std::runtime_error("Cannot resolve native GPU EXE path");
 std::wstring folder(path,n);
 auto last=folder.find_last_of(L"\\/");
 if(last==std::wstring::npos)throw std::runtime_error("Unexpected native GPU EXE path");
 return folder.substr(0,last+1)+L"mode4_directcompute.hlsl";
}
static ComPtr<ID3DBlob> compileShader(){
 const auto path=shaderFilename();
 ComPtr<ID3DBlob> code,errors;
 const HRESULT hr=D3DCompileFromFile(path.c_str(),nullptr,D3D_COMPILE_STANDARD_FILE_INCLUDE,
  "main","cs_5_0",D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,
  code.GetAddressOf(),errors.GetAddressOf());
 if(FAILED(hr)){
  const std::string details=errors
   ?std::string((const char*)errors->GetBufferPointer(),errors->GetBufferSize())
   :"Could not read HLSL shader file";
  throw std::runtime_error("DirectCompute HLSL compile failed: "+details);
 }
 return code;
}
static std::string utf8Name(const WCHAR* wide){
 if(!wide||!wide[0])return "unknown GPU";
 int n=WideCharToMultiByte(CP_UTF8,0,wide,-1,nullptr,0,nullptr,nullptr);
 if(n<=0)return "unknown GPU";
 std::string bytes(size_t(n),'\0');
 WideCharToMultiByte(CP_UTF8,0,wide,-1,bytes.data(),n,nullptr,nullptr);
 if(!bytes.empty()&&bytes.back()==0)bytes.pop_back();
 return bytes;
}
struct InputView {
 ComPtr<ID3D11Buffer> buffer;
 ComPtr<ID3D11ShaderResourceView> srv;
};

struct NativeDirectCompute {
 ComPtr<ID3D11Device> device;
 ComPtr<ID3D11DeviceContext> context;
 ComPtr<ID3D11ComputeShader> shader;
 std::string gpuName;
 uint32_t vendor=0;
 NativeDirectCompute(){
  ComPtr<IDXGIFactory1> factory;
  checked(CreateDXGIFactory1(IID_PPV_ARGS(factory.GetAddressOf())),
   "CreateDXGIFactory1 failed");
  ComPtr<IDXGIAdapter1> preferred;
  size_t bestVram=0;
  UINT bestVendor=0;
  for(UINT index=0;;index++){
   ComPtr<IDXGIAdapter1> item;
   const HRESULT hr=factory->EnumAdapters1(index,item.GetAddressOf());
   if(hr==DXGI_ERROR_NOT_FOUND)break;
   if(FAILED(hr))break;
   DXGI_ADAPTER_DESC1 desc={};
   checked(item->GetDesc1(&desc),"IDXGIAdapter1::GetDesc1 failed");
   if((desc.Flags&DXGI_ADAPTER_FLAG_SOFTWARE)||desc.VendorId==0x1414)
    continue; // Reject WARP / Microsoft Basic software devices.
   if(!preferred|| (desc.VendorId==0x10de&&bestVendor!=0x10de) ||
      ((desc.VendorId==0x10de)==(bestVendor==0x10de)&&
       desc.DedicatedVideoMemory>bestVram)){
    preferred=item;bestVram=desc.DedicatedVideoMemory;
    bestVendor=desc.VendorId;
    gpuName=utf8Name(desc.Description);
   }
  }
  if(!preferred)throw std::runtime_error("GPU_NOT_AVAILABLE: no hardware DXGI adapter");
  // Requires DirectCompute 5.0 / D3D11 feature level 11_0 (Pascal supports).
  const D3D_FEATURE_LEVEL required[]={D3D_FEATURE_LEVEL_11_0};
  D3D_FEATURE_LEVEL actual=D3D_FEATURE_LEVEL_9_1;
  checked(D3D11CreateDevice(preferred.Get(),D3D_DRIVER_TYPE_UNKNOWN,nullptr,
    0,required,1,D3D11_SDK_VERSION,device.GetAddressOf(),&actual,
    context.GetAddressOf()),"D3D11CreateDevice failed (requires feature level 11_0)");
  if(actual<D3D_FEATURE_LEVEL_11_0)
   throw std::runtime_error("GPU_NOT_AVAILABLE: DirectCompute 5.0 unsupported");
  DXGI_ADAPTER_DESC1 desc={};
  checked(preferred->GetDesc1(&desc),"GPU identity not available");
  vendor=desc.VendorId;
  auto source=compileShader();
  checked(device->CreateComputeShader(source->GetBufferPointer(),
   source->GetBufferSize(),nullptr,shader.GetAddressOf()),
   "CreateComputeShader failed");
 }
 template<class T>
 InputView upload(const std::vector<T>& input){
  if(sizeof(T)!=4)throw std::runtime_error("DirectCompute input must be 32bit");
  const UINT n=(UINT)std::max<size_t>(1,input.size());
  const T zero{};
  const T* data=input.empty()?&zero:input.data();
  D3D11_BUFFER_DESC desc={};
  desc.ByteWidth=n*4u;
  desc.Usage=D3D11_USAGE_IMMUTABLE;
  desc.BindFlags=D3D11_BIND_SHADER_RESOURCE;
  desc.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;
  desc.StructureByteStride=4;
  D3D11_SUBRESOURCE_DATA initial={};initial.pSysMem=data;
  InputView result;
  checked(device->CreateBuffer(&desc,&initial,result.buffer.GetAddressOf()),
   "GPU input buffer allocation failed");
  D3D11_SHADER_RESOURCE_VIEW_DESC sr={};
  sr.Format=DXGI_FORMAT_UNKNOWN;
  sr.ViewDimension=D3D11_SRV_DIMENSION_BUFFER;
  sr.Buffer.FirstElement=0;sr.Buffer.NumElements=n;
  checked(device->CreateShaderResourceView(result.buffer.Get(),&sr,
   result.srv.GetAddressOf()),"GPU input view creation failed");
  return result;
 }
 std::vector<double> compute(const Payload& p){
  const size_t total=p.cells*size_t(p.G);
  if(!total||total>6000000)throw std::runtime_error("Invalid compute shader workload");
  const UINT groupsX=(UINT)std::min<size_t>(65535,(total+63)/64);
  const UINT groupsY=(UINT)((total+size_t(groupsX)*64-1)/(size_t(groupsX)*64));
  if(groupsY<1||groupsY>65535)throw std::runtime_error("GPU workgroups out of range");
  std::vector<float> field;field.reserve(p.n*5);
  field.insert(field.end(),p.target.begin(),p.target.end());
  field.insert(field.end(),p.importance.begin(),p.importance.end());
  field.insert(field.end(),p.dist.begin(),p.dist.end());
  field.insert(field.end(),p.gray.begin(),p.gray.end());
  field.insert(field.end(),p.oldGray.begin(),p.oldGray.end());
  std::vector<int32_t> glyphMeta;glyphMeta.reserve(2*p.G);
  glyphMeta.insert(glyphMeta.end(),p.columns.begin(),p.columns.end());
  glyphMeta.insert(glyphMeta.end(),p.shape.begin(),p.shape.end());
  std::vector<float> glyphInfo;glyphInfo.reserve(5*p.G);
  glyphInfo.insert(glyphInfo.end(),p.penalty.begin(),p.penalty.end());
  glyphInfo.insert(glyphInfo.end(),p.glyphOrient.begin(),p.glyphOrient.end());
  std::vector<float> mask;mask.reserve(p.mask.size()+p.expanded.size());
  mask.insert(mask.end(),p.mask.begin(),p.mask.end());
  mask.insert(mask.end(),p.expanded.begin(),p.expanded.end());

  std::vector<InputView> inputs;
  inputs.reserve(7);
  inputs.push_back(upload(field));
  inputs.push_back(upload(p.orient));
  inputs.push_back(upload(p.oldIndex));
  inputs.push_back(upload(p.face));
  inputs.push_back(upload(glyphMeta));
  inputs.push_back(upload(glyphInfo));
  inputs.push_back(upload(mask));

  D3D11_BUFFER_DESC outputDesc={};
  outputDesc.ByteWidth=(UINT)(total*4);
  outputDesc.Usage=D3D11_USAGE_DEFAULT;
  outputDesc.BindFlags=D3D11_BIND_UNORDERED_ACCESS;
  outputDesc.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;
  outputDesc.StructureByteStride=4;
  ComPtr<ID3D11Buffer> output,staging;
  checked(device->CreateBuffer(&outputDesc,nullptr,output.GetAddressOf()),
   "GPU score output allocation failed");
  D3D11_UNORDERED_ACCESS_VIEW_DESC vd={};
  vd.Format=DXGI_FORMAT_UNKNOWN;
  vd.ViewDimension=D3D11_UAV_DIMENSION_BUFFER;
  vd.Buffer.FirstElement=0;
  vd.Buffer.NumElements=(UINT)total;
  ComPtr<ID3D11UnorderedAccessView> uav;
  checked(device->CreateUnorderedAccessView(output.Get(),&vd,uav.GetAddressOf()),
   "GPU result UAV allocation failed");

  struct alignas(16) Params {
   uint32_t W,H,S,G,N,C,F,hasOld,cut,groupsX,perGlyph,unused;
  } params={
   (uint32_t)p.W,(uint32_t)p.H,(uint32_t)p.S,(uint32_t)p.G,
   (uint32_t)p.n,(uint32_t)p.cells,(uint32_t)p.F,(uint32_t)p.hasOld,
   (uint32_t)p.cut,groupsX,(uint32_t)p.maskSize,0
  };
  D3D11_BUFFER_DESC cdesc={};
  cdesc.ByteWidth=sizeof(params);cdesc.Usage=D3D11_USAGE_DEFAULT;
  cdesc.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
  D3D11_SUBRESOURCE_DATA cbdata={};cbdata.pSysMem=&params;
  ComPtr<ID3D11Buffer> constants;
  checked(device->CreateBuffer(&cdesc,&cbdata,constants.GetAddressOf()),
   "GPU shader parameters failed");

  ID3D11ShaderResourceView* srvs[7];
  for(int i=0;i<7;i++)srvs[i]=inputs[i].srv.Get();
  ID3D11UnorderedAccessView* views[]={uav.Get()};
  ID3D11Buffer* cb[]={constants.Get()};
  context->CSSetShader(shader.Get(),nullptr,0);
  context->CSSetShaderResources(0,7,srvs);
  context->CSSetUnorderedAccessViews(0,1,views,nullptr);
  context->CSSetConstantBuffers(0,1,cb);
  context->Dispatch(groupsX,groupsY,1);

  D3D11_BUFFER_DESC readDesc=outputDesc;
  readDesc.Usage=D3D11_USAGE_STAGING;
  readDesc.BindFlags=0;readDesc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
  readDesc.MiscFlags=0;readDesc.StructureByteStride=0;
  checked(device->CreateBuffer(&readDesc,nullptr,staging.GetAddressOf()),
   "GPU readback buffer failed");
  context->CopyResource(staging.Get(),output.Get());
  // Release binding before the next frame, not the GPU process/device itself.
  ID3D11ShaderResourceView* emptySRVs[7]={};
  ID3D11UnorderedAccessView* emptyUAV[1]={};
  context->CSSetShaderResources(0,7,emptySRVs);
  context->CSSetUnorderedAccessViews(0,1,emptyUAV,nullptr);
  context->CSSetShader(nullptr,nullptr,0);

  D3D11_MAPPED_SUBRESOURCE mapped={};
  checked(context->Map(staging.Get(),0,D3D11_MAP_READ,0,&mapped),
   "GPU score readback failed");
  std::vector<double> converted(total);
  const auto* floats=(const float*)mapped.pData;
  for(size_t i=0;i<total;i++){
   const float value=floats[i];
   converted[i]=std::isfinite(value)?std::max(0.0,double(value))
    :std::numeric_limits<double>::infinity();
  }
  context->Unmap(staging.Get(),0);
  return converted;
 }
};

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
