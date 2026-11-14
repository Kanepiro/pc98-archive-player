#include "fullgpu_device.hpp"
#include <array>
#include <chrono>
#include <cstring>
struct ContourGPU {
 NativeDirectCompute gpu;
 std::array<ComPtr<ID3D11ComputeShader>,19> shaders;
 ComPtr<ID3D11Buffer> buffer,readback,counterReadback,constants;
 ComPtr<ID3D11UnorderedAccessView> uav;
 std::vector<uint32_t> host;
 size_t arenaCapacity=0,readbackCapacity=0;
 uint32_t offsets[24]={};
 struct alignas(16) Params {uint32_t w,h,op,stage,source,destination,axis,count;float brightness,contrast,gamma,reserved;};
 static ComPtr<ID3DBlob> compile(const char* entry){
  auto path=shaderFilename();path=path.substr(0,path.find_last_of(L"\\/")+1)+L"fullgpu_contour.hlsl";
  auto cached=readShaderCache(path,entry);if(cached)return cached;
  ComPtr<ID3DBlob> code,error;
  auto hr=D3DCompileFromFile(path.c_str(),nullptr,D3D_COMPILE_STANDARD_FILE_INCLUDE,entry,"cs_5_0",
    D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&code,&error);
  if(FAILED(hr))throw std::runtime_error(std::string(entry)+": "+(error?(char*)error->GetBufferPointer():"compile failed"));
  writeShaderCache(path,entry,code.Get());return code;
 }
 ContourGPU(){
  const char* entries[]={"normalize","blur","grayCopy","gradient","peaks","connect","compress","componentStats","target","distanceField","thin","thin","semanticPriority","topologyStats","pruneTopology","junctionPriority","clearFace","drawFace","visionPreprocess"};
  for(size_t i=0;i<19;i++){auto c=compile(entries[i]);checked(gpu.device->CreateComputeShader(c->GetBufferPointer(),c->GetBufferSize(),nullptr,&shaders[i]),"contour shader");}
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
  uint32_t groups=(count+127)/128;
  gpu.context->Dispatch(std::min(65535u,groups),(groups+65534)/65535,1);
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
  if(head[0]!=0x43504754||head[1]<1||head[1]>6||head[2]<4||head[3]<4||uint64_t(head[2])*head[3]>3000000)throw std::runtime_error("contour bounds");
  Params p={head[2],head[3],head[1],0,0,0,0,1,0,1,1,0};
  std::memcpy(&p.brightness,head+4,12);
  if(!std::isfinite(p.brightness)||!std::isfinite(p.contrast)||!std::isfinite(p.gamma)||p.gamma<=0)throw std::runtime_error("contour settings");
  if(p.op==5&&head[7]>100000)throw std::runtime_error("face point bounds");
  uint32_t n=p.w*p.h,requiredWords=64;
  auto allocate=[&](uint32_t index,uint32_t count){offsets[index]=requiredWords;requiredWords+=count;};
  // Allocate only buffers consumed by this operation, not every kernel's scratch.
  for(uint32_t k=0;k<24;k++){
   uint32_t words=1;
   if(p.op==1){if(k<=11||k==14)words=(k==1||k==2)?4*n:n;if(k==13)words=4;}
   else if(p.op==2){if(k==10||k==11)words=n;}
   else if(p.op==3){if(k==7||k==8)words=n;}
   else if(p.op==4){if(k==7||k==8||k==10||k==15||k==16||k==17||k==18||k==19||k==20||k==22||k==23)words=n;if(k==13)words=4;if(k==21)words=8*24;}
   else if(p.op==5){if(k==10||k==15)words=n;if(k==21)words=8+head[7]*4;}
   else if(p.op==6){if(k==0)words=n;if(k==3)words=128*128*3;if(k==10)words=320*320;}
   allocate(k,words);
  }
  if(host.size()<requiredWords)host.resize(requiredWords);
  std::copy(offsets,offsets+24,host.begin());
  uint32_t input=p.op==1||p.op==6?0:p.op==2||p.op==4||p.op==5?10:7;
  std::cin.read((char*)(host.data()+offsets[input]),n*4);if(!std::cin)throw std::runtime_error("contour pixels");
  if(p.op==5){p.count=head[7];if(p.count>100000)throw std::runtime_error("face points limit");std::cin.read((char*)(host.data()+offsets[15]),n*4);std::cin.read((char*)(host.data()+offsets[21]),(8+p.count*4)*4);if(!std::cin)throw std::runtime_error("face command input");}
  if(p.op==4){p.count=head[7];if(p.count>8)throw std::runtime_error("semantic region count");std::cin.read((char*)(host.data()+offsets[21]),p.count*24*4);if(!std::cin)throw std::runtime_error("semantic region input");}
  if(p.op==3)for(uint32_t i=0;i<n;i++)if(host[offsets[7]+i]>1)throw std::runtime_error("skeleton mask not binary");
  // Retain the largest required working area after job warm-up. Changes in
  // operation do not allocate/free it every frame; no utilization-based tuning.
  unbind();
  D3D11_BUFFER_DESC d={};d.Usage=D3D11_USAGE_DEFAULT;
  d.BindFlags=D3D11_BIND_UNORDERED_ACCESS;d.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;d.StructureByteStride=4;
  if(host.size()>arenaCapacity){
   buffer.Reset();uav.Reset();d.ByteWidth=(UINT)host.size()*4;
   checked(gpu.device->CreateBuffer(&d,nullptr,&buffer),"contour arena");
   D3D11_UNORDERED_ACCESS_VIEW_DESC ud={};ud.ViewDimension=D3D11_UAV_DIMENSION_BUFFER;ud.Buffer.NumElements=(UINT)host.size();
   checked(gpu.device->CreateUnorderedAccessView(buffer.Get(),&ud,&uav),"contour arena view");arenaCapacity=host.size();
  }
  const UINT zero[4]={};gpu.context->ClearUnorderedAccessViewUint(uav.Get(),zero);
  auto upload=[&](UINT at,UINT words){D3D11_BOX box={at*4,0,0,(at+words)*4,1,1};gpu.context->UpdateSubresource(buffer.Get(),0,&box,host.data()+at,0,0);};
  upload(0,64);upload(offsets[input],n);
  if(p.op==5){upload(offsets[15],n);upload(offsets[21],8+p.count*4);}
  if(p.op==4&&p.count)upload(offsets[21],p.count*24);
  d.BindFlags=0;d.MiscFlags=0;d.StructureByteStride=0;d.Usage=D3D11_USAGE_STAGING;d.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
  uint32_t outputWords=p.op==6?128*128*3+320*320:n*(p.op==1||p.op==4?3:p.op==5?2:1);
  if(outputWords+4>readbackCapacity){
   readback.Reset();d.ByteWidth=(outputWords+4)*4;
   checked(gpu.device->CreateBuffer(&d,nullptr,&readback),"contour readback");readbackCapacity=outputWords+4;
  }
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
  else if(p.op==5){launch(16,p,n);launch(17,p,p.count);}
  else if(p.op==6){launch(18,p,320*320);}
  else if(p.op==4){
   launch(12,p,n);bool converged=false;
   for(int iter=0;iter<64;iter++){
    unbind();uint32_t zero=0;D3D11_BOX box={(offsets[13]+1)*4,0,0,(offsets[13]+2)*4,1,1};
    gpu.context->UpdateSubresource(buffer.Get(),0,&box,&zero,0,0);
    launch(5,p,n);launch(6,p,n);if(!changed()){converged=true;break;}
   }
   if(!converged)throw std::runtime_error("GPU topology did not converge");
   launch(13,p,n);launch(14,p,n);
   // Retain the exact twelve two-stage thinning passes.
   p.source=22;p.destination=7;p.stage=0;launch(10,p,n);
   p.source=7;p.destination=8;p.stage=1;launch(10,p,n);
   for(int pass=1;pass<12;pass++){
    p.source=8;p.destination=7;p.stage=0;launch(10,p,n);
    p.source=7;p.destination=8;p.stage=1;launch(10,p,n);
   }
   // One extra no-op copying kernel places the final binary skeleton in slot 7.
   p.source=8;p.destination=7;p.stage=2;launch(10,p,n);
   launch(15,p,n);
  }else{
   for(int pass=0;pass<12;pass++){
    p.source=7;p.destination=8;p.stage=0;launch(10,p,n);
    p.source=8;p.destination=7;p.stage=1;launch(10,p,n);
   }
  }
  unbind();uint32_t destinationByte=16;
  auto copyOutput=[&](uint32_t slot,uint32_t words){D3D11_BOX b={offsets[slot]*4,0,0,(offsets[slot]+words)*4,1,1};
   gpu.context->CopySubresourceRegion(readback.Get(),0,destinationByte,0,0,buffer.Get(),0,&b);destinationByte+=words*4;};
  if(p.op==4){D3D11_BOX b={(offsets[13]+2)*4,0,0,(offsets[13]+3)*4,1,1};gpu.context->CopySubresourceRegion(readback.Get(),0,0,0,0,buffer.Get(),0,&b);}
  if(p.op==6){copyOutput(3,128*128*3);copyOutput(10,320*320);}
  else if(p.op==5){copyOutput(10,n);copyOutput(15,n);}
  else if(p.op==4){copyOutput(10,n);copyOutput(15,n);copyOutput(7,n);}
  else if(p.op==1){copyOutput(10,n);copyOutput(3,n);copyOutput(11,n);}
  else copyOutput(p.op==2?11:7,n);
  D3D11_MAPPED_SUBRESOURCE mapped={};checked(gpu.context->Map(readback.Get(),0,D3D11_MAP_READ,0,&mapped),"contour result");
  auto* result=(uint32_t*)mapped.pData;
  uint32_t outputHeader[]={0x43524754,p.op,n,p.op==4?result[0]:0};std::cout.write((char*)outputHeader,16);
  std::cout.write((char*)(result+4),outputWords*4);
  gpu.context->Unmap(readback.Get(),0);
  double wall=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-begin).count();
  std::cout.write((char*)&wall,8);std::cout.flush();
 }
};
int main(int argc,char** argv){
 try{
  _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
  if(argc==2&&std::string(argv[1])=="--check-shader"){
   for(auto e:{"normalize","blur","grayCopy","gradient","peaks","connect","compress","componentStats","target","distanceField","thin","semanticPriority","topologyStats","pruneTopology","junctionPriority","clearFace","drawFace","visionPreprocess"}){
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
