#include "fullgpu_device.hpp"
#include <chrono>
#include <array>
#include <cstring>
using Clock=std::chrono::steady_clock;
static ComPtr<ID3DBlob> fullShader(const char* entry){
 auto path=shaderFilename();path=path.substr(0,path.find_last_of(L"\\/")+1)+L"fullgpu_layout.hlsl";
 ComPtr<ID3DBlob> code,error;
 auto hr=D3DCompileFromFile(path.c_str(),nullptr,D3D_COMPILE_STANDARD_FILE_INCLUDE,entry,"cs_5_0",
  D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&code,&error);
 if(FAILED(hr))throw std::runtime_error(std::string(entry)+": "+(error?(char*)error->GetBufferPointer():"compile failed"));
 return code;
}
struct FullGPU {
 NativeDirectCompute gpu;
 std::array<ComPtr<ID3D11ComputeShader>,8> shaders;
 ComPtr<ID3D11Buffer> memory,staging,constants,counterReadback;
 ComPtr<ID3D11UnorderedAccessView> uav;
 struct alignas(16) Params {uint32_t W,H,S,G,kind,first,stride,count,x,y,beam,options,faces,old,cut,budget;};
 std::vector<uint32_t> host;
 std::array<uint32_t,26> offsets{};
 struct Stamp {ComPtr<ID3D11Query> start,end;};
 std::array<Stamp,6> stamps;
 ComPtr<ID3D11Query> disjoint;
 FullGPU(){
  const char* names[]={"prepare","score","candidates","solveRows","solveBands","criticPropose","evaluate","reduceCritic"};
  for(size_t i=0;i<8;i++){auto code=fullShader(names[i]);checked(gpu.device->CreateComputeShader(code->GetBufferPointer(),code->GetBufferSize(),nullptr,&shaders[i]),"create layout shader");}
  D3D11_BUFFER_DESC cd={};cd.ByteWidth=sizeof(Params);cd.Usage=D3D11_USAGE_DEFAULT;cd.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
  checked(gpu.device->CreateBuffer(&cd,nullptr,&constants),"layout constants");
  cd.ByteWidth=16;cd.Usage=D3D11_USAGE_STAGING;cd.BindFlags=0;cd.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
  checked(gpu.device->CreateBuffer(&cd,nullptr,&counterReadback),"critic counter readback");
  D3D11_QUERY_DESC q={D3D11_QUERY_TIMESTAMP_DISJOINT,0};
  checked(gpu.device->CreateQuery(&q,&disjoint),"disjoint query");q.Query=D3D11_QUERY_TIMESTAMP;
  for(auto& s:stamps){checked(gpu.device->CreateQuery(&q,&s.start),"timestamp");checked(gpu.device->CreateQuery(&q,&s.end),"timestamp");}
 }
 template<class T>uint32_t add(size_t n,const std::vector<T>* values=nullptr){
  uint32_t offset=(uint32_t)host.size();host.resize(host.size()+n,0);
  if(values){if(values->size()>n)throw std::runtime_error("arena input overflow");std::memcpy(host.data()+offset,values->data(),values->size()*4);}
  return offset;
 }
 uint32_t zeros(size_t n){return add<float>(n);}
 void prepareArena(const Payload& p){
  host.assign(64,0);size_t C=p.cells,N=p.n,G=p.G,S=p.S;
  offsets[0]=add(N,&p.target);offsets[1]=add(N,&p.importance);offsets[2]=add(N,&p.dist);
  offsets[3]=add(N,&p.gray);offsets[4]=add(N,&p.oldGray);offsets[5]=add(C,&p.oldIndex);
  offsets[6]=add(G,&p.columns);offsets[7]=add(G,&p.shape);offsets[8]=add(G,&p.penalty);
  offsets[9]=add(G*4,&p.glyphOrient);offsets[10]=add(p.mask.size(),&p.mask);offsets[11]=add(p.expanded.size(),&p.expanded);
  offsets[12]=add(p.face.size(),&p.face);offsets[13]=zeros(C*G);offsets[14]=zeros(C*40);
  offsets[15]=zeros(C);offsets[16]=zeros(C);offsets[17]=zeros(C*40);
  offsets[18]=zeros(p.H*(p.W+1)*S);offsets[19]=zeros((p.H+1)*p.W*S);
  offsets[20]=zeros(G*8*S);offsets[21]=zeros(C*14*3);offsets[22]=zeros(16);
  offsets[23]=zeros(C);offsets[24]=zeros(C*8);offsets[25]=zeros(C*6);
  // Font rasterization occurs once in the Windows browser; these are its exact glyph ports.
  for(size_t g=0;g<G;g++){
   size_t w=p.columns[g]*S,off=g*p.maskSize;
   auto m=[&](size_t x,size_t y){return p.mask[off+y*w+x];};
   auto set=[&](size_t side,size_t i,float value){std::memcpy(&host[offsets[20]+g*8*S+side*2*S+i],&value,4);};
   for(size_t y=0;y<S;y++){float a=0,b=0;for(size_t k=0;k<std::min<size_t>(3,w);k++){float weight=k==0?1:k==1?.85f:.58f;a=std::max(a,m(k,y)*weight);b=std::max(b,m(w-1-k,y)*weight);}set(0,y,a);set(1,y,b);}
   for(size_t x=0;x<w;x++){float a=0,b=0;for(size_t k=0;k<std::min<size_t>(3,S);k++){float weight=k==0?1:k==1?.85f:.58f;a=std::max(a,m(x,k)*weight);b=std::max(b,m(x,S-1-k)*weight);}set(2,x,a);set(3,x,b);}
  }
  std::copy(offsets.begin(),offsets.end(),host.begin());
  if(host.size()*4>512ull*1024*1024)throw std::runtime_error("layout arena exceeds 512 MiB");
  memory.Reset();uav.Reset();staging.Reset();
  D3D11_BUFFER_DESC desc={};desc.ByteWidth=(UINT)host.size()*4;desc.Usage=D3D11_USAGE_DEFAULT;
  desc.BindFlags=D3D11_BIND_UNORDERED_ACCESS;desc.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;desc.StructureByteStride=4;
  D3D11_SUBRESOURCE_DATA initial={};initial.pSysMem=host.data();
  checked(gpu.device->CreateBuffer(&desc,&initial,&memory),"GPU arena");
  D3D11_UNORDERED_ACCESS_VIEW_DESC vd={};vd.ViewDimension=D3D11_UAV_DIMENSION_BUFFER;vd.Buffer.NumElements=(UINT)host.size();
  checked(gpu.device->CreateUnorderedAccessView(memory.Get(),&vd,&uav),"GPU arena view");
  desc.BindFlags=0;desc.Usage=D3D11_USAGE_STAGING;desc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;desc.MiscFlags=0;desc.StructureByteStride=0;
  checked(gpu.device->CreateBuffer(&desc,nullptr,&staging),"layout readback");
 }
 void dispatch(int which,Params& p,UINT x,UINT y=1){
  if(!x)return;
  gpu.context->UpdateSubresource(constants.Get(),0,nullptr,&p,0,0);
  ID3D11Buffer* cb[]={constants.Get()};ID3D11UnorderedAccessView* uv[]={uav.Get()};
  gpu.context->CSSetConstantBuffers(0,1,cb);gpu.context->CSSetUnorderedAccessViews(0,1,uv,nullptr);
  gpu.context->CSSetShader(shaders[which].Get(),nullptr,0);gpu.context->Dispatch(x,y,1);
 }
 void start(int k){gpu.context->End(stamps[k].start.Get());}
 void end(int k){gpu.context->End(stamps[k].end.Get());}
 void compute(const Payload& src){
  auto begin=Clock::now();prepareArena(src);
  Params p={(uint32_t)src.W,(uint32_t)src.H,(uint32_t)src.S,(uint32_t)src.G,0,0,1,(uint32_t)src.H,0,0,
   src.cells>3000?7u:14u,src.cells>3000?7u:12u,(uint32_t)src.F,(uint32_t)src.hasOld,(uint32_t)src.cut,src.cells>3000?16u:src.cells>1000?28u:36u};
  UINT cellGroups=(UINT)(src.cells+63)/64;
  gpu.context->Begin(disjoint.Get());
  start(0);dispatch(0,p,cellGroups);end(0);
  start(1);size_t total=src.cells*src.G;UINT gx=(UINT)std::min<size_t>(65535,(total+63)/64);
  dispatch(1,p,gx,(UINT)((total+65535*64-1)/(65535*64)));end(1);
  start(2);dispatch(2,p,cellGroups);end(2);
  start(3);dispatch(3,p,p.H);
  p.kind=1;p.stride=2;
  // Red/black row updates read fixed neighbouring rows. Each accepted row lowers
  // the same whole-frame energy. No per-cell greedy replacement.
  for(int sweep=0;sweep<(src.cells>3000?2:5);sweep++)for(int parity=0;parity<2;parity++){
   p.first=(sweep%2)?1-parity:parity;p.count=(p.H-p.first+1)/2;dispatch(3,p,p.count);
  }
  end(3);start(4);p.stride=4;
  for(int round=0;round<(src.cells>3000?1:3);round++)for(int parity=0;parity<2;parity++)for(int colour=0;colour<2;colour++){
   p.first=parity+colour*2;p.count=p.H>p.first+1?(p.H-p.first-2)/4+1:0;dispatch(4,p,p.count);
  }
  end(4);start(5);p.kind=2;dispatch(6,p,cellGroups);dispatch(7,p,1);
  p.kind=3;
  // Scan the same two parities and tile budget as the original critic. The shader
  // stops accepting new tiles at the budget; unsupported boundaries are skipped.
  uint32_t scanned=0;bool budgetReached=false;
  for(UINT parity=0;parity<2&&!budgetReached;parity++)for(UINT y=parity;y+1<p.H&&!budgetReached;y+=2)for(UINT x=parity;x+2<=p.W;x+=2){
   p.x=x;p.y=y;dispatch(5,p,1);dispatch(6,p,cellGroups);dispatch(7,p,1);
   if(++scanned%32==0){
    ID3D11UnorderedAccessView* empty[]={nullptr};gpu.context->CSSetUnorderedAccessViews(0,1,empty,nullptr);
    D3D11_BOX box={offsets[22]*4,0,0,offsets[22]*4+16,1,1};
    gpu.context->CopySubresourceRegion(counterReadback.Get(),0,0,0,0,memory.Get(),0,&box);
    D3D11_MAPPED_SUBRESOURCE m={};checked(gpu.context->Map(counterReadback.Get(),0,D3D11_MAP_READ,0,&m),"critic budget");
    budgetReached=((uint32_t*)m.pData)[2]>=p.budget;gpu.context->Unmap(counterReadback.Get(),0);
    if(budgetReached)break;
   }
  }
  end(5);gpu.context->End(disjoint.Get());
  ID3D11UnorderedAccessView* none[]={nullptr};gpu.context->CSSetUnorderedAccessViews(0,1,none,nullptr);
  gpu.context->CopyResource(staging.Get(),memory.Get());
  D3D11_MAPPED_SUBRESOURCE mapped={};checked(gpu.context->Map(staging.Get(),0,D3D11_MAP_READ,0,&mapped),"layout readback");
  const auto* result=(const uint32_t*)mapped.pData;
  uint32_t header[]={0x344c4746,p.W,p.H,p.G};
  std::cout.write((char*)header,sizeof(header));
  std::cout.write((const char*)(result+offsets[15]),src.cells*4);
  std::cout.write((const char*)(result+offsets[22]),16*4);
  gpu.context->Unmap(staging.Get(),0);
  D3D11_QUERY_DATA_TIMESTAMP_DISJOINT freq={};std::array<double,8> timings{};timings.fill(-1);
  if(gpu.context->GetData(disjoint.Get(),&freq,sizeof(freq),0)==S_OK&&!freq.Disjoint){
   for(int i=0;i<6;i++){UINT64 a=0,b=0;
    if(gpu.context->GetData(stamps[i].start.Get(),&a,sizeof(a),0)==S_OK&&gpu.context->GetData(stamps[i].end.Get(),&b,sizeof(b),0)==S_OK)
     timings[i]=double(b-a)*1000.0/double(freq.Frequency);
   }
  }
  timings[6]=std::chrono::duration<double,std::milli>(Clock::now()-begin).count();
  timings[7]=host.size()*4.0;
  std::cout.write((char*)timings.data(),sizeof(timings));std::cout.flush();
  if(!std::cout)throw std::runtime_error("layout response pipe broken");
 }
};
int main(int argc,char** argv){
 try{
  _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
  if(argc==2&&std::string(argv[1])=="--check-shader"){
   for(auto name:{"prepare","score","candidates","solveRows","solveBands","criticPropose","evaluate","reduceCritic"}){
    auto code=fullShader(name);std::cout<<name<<" "<<code->GetBufferSize()<<" bytes\n";
   }return 0;
  }
  FullGPU engine;
  if(argc==2&&std::string(argv[1])=="--probe"){std::cout<<"DIRECTCOMPUTE_LAYOUT "<<engine.gpu.gpuName<<"\n";return 0;}
  if(argc!=2||std::string(argv[1])!="--stream")throw std::runtime_error("expected --stream");
  while(std::cin.peek()!=std::char_traits<char>::eof()){Payload p;engine.compute(p);}
  return 0;
 }catch(const std::exception& e){std::cerr<<"FULLGPU_ERROR "<<e.what()<<"\n";return 1;}
}
