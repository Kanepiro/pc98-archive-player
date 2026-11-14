#include "fullgpu_device.hpp"
#include <chrono>
#include <array>
#include <cstring>
#include "fullgpu_resident.hpp"
using Clock=std::chrono::steady_clock;
static ComPtr<ID3DBlob> fullShader(const char* entry){
 auto path=shaderFilename();path=path.substr(0,path.find_last_of(L"\\/")+1)+L"fullgpu_layout.hlsl";
 auto cached=readShaderCache(path,entry);if(cached)return cached;
 ComPtr<ID3DBlob> code,error;
 auto hr=D3DCompileFromFile(path.c_str(),nullptr,D3D_COMPILE_STANDARD_FILE_INCLUDE,entry,"cs_5_0",
  D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&code,&error);
 if(FAILED(hr))throw std::runtime_error(std::string(entry)+": "+(error?(char*)error->GetBufferPointer():"compile failed"));
 writeShaderCache(path,entry,code.Get());return code;
}
struct FullGPU {
 NativeDirectCompute gpu;
 std::array<ComPtr<ID3D11ComputeShader>,8> shaders;
 ComPtr<ID3D11Buffer> memory,staging,constants,counterReadback;
 ComPtr<ID3D11UnorderedAccessView> uav,scratchA,scratchB;
 bool residentEnabled=false,firstRequest=true,bindingsActive=false;
 int boundShader=-1;
 std::array<uint32_t,4> residentShape{};
 size_t ringWords=0,baseWords=0;
 std::vector<uint32_t> frameInput;
 std::array<double,16> metrics{};
 uint32_t fallbackReason=0;
 void videoMemory(){
  ComPtr<IDXGIDevice> dx;ComPtr<IDXGIAdapter> adapter;ComPtr<IDXGIAdapter3> adapter3;
  DXGI_QUERY_VIDEO_MEMORY_INFO info={};
  if(SUCCEEDED(gpu.device.As(&dx))&&SUCCEEDED(dx->GetAdapter(&adapter))&&
     SUCCEEDED(adapter.As(&adapter3))&&SUCCEEDED(adapter3->QueryVideoMemoryInfo(0,DXGI_MEMORY_SEGMENT_GROUP_LOCAL,&info))){
   metrics[12]=double(info.CurrentUsage);metrics[13]=double(info.Budget);
  }else{metrics[12]=-1;metrics[13]=-1;}
 }
 void upload(UINT first,UINT bytes,const void* data){
  D3D11_BOX box={first,0,0,first+bytes,1,1};
  gpu.context->UpdateSubresource(memory.Get(),0,&box,data,0,0);
  metrics[2]++;metrics[3]+=bytes;
 }
 void releaseArena(){
  if(memory)metrics[8]++;if(staging)metrics[8]++;
  scratchA.Reset();scratchB.Reset();uav.Reset();memory.Reset();staging.Reset();
 }
 void allocateArena(size_t words,size_t cells){
  D3D11_BUFFER_DESC desc={};desc.ByteWidth=(UINT)(words*4);desc.Usage=D3D11_USAGE_DEFAULT;
  desc.BindFlags=D3D11_BIND_UNORDERED_ACCESS;desc.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;desc.StructureByteStride=4;
  checked(gpu.device->CreateBuffer(&desc,nullptr,&memory),"GPU arena");metrics[7]++;
  D3D11_UNORDERED_ACCESS_VIEW_DESC vd={};vd.ViewDimension=D3D11_UAV_DIMENSION_BUFFER;vd.Buffer.NumElements=(UINT)words;
  checked(gpu.device->CreateUnorderedAccessView(memory.Get(),&vd,&uav),"GPU arena view");
  if(residentEnabled){
   vd.Buffer.FirstElement=offsets[13];vd.Buffer.NumElements=offsets[20]-offsets[13];
   checked(gpu.device->CreateUnorderedAccessView(memory.Get(),&vd,&scratchA),"scratch A");
   vd.Buffer.FirstElement=offsets[21];vd.Buffer.NumElements=(UINT)baseWords-offsets[21];
   checked(gpu.device->CreateUnorderedAccessView(memory.Get(),&vd,&scratchB),"scratch B");
  }
  desc.BindFlags=0;desc.Usage=D3D11_USAGE_STAGING;desc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;desc.MiscFlags=0;desc.StructureByteStride=0;
  desc.ByteWidth=(UINT)(cells+16)*4;
  checked(gpu.device->CreateBuffer(&desc,nullptr,&staging),"layout readback");metrics[7]++;
 }
 void uploadResident(const Payload& p,uint32_t sequence,bool reusePrevious){
  size_t pos=0;
  auto append=[&](const void* data,size_t n){std::memcpy(frameInput.data()+pos,data,n*4);pos+=n;};
  append(p.target.data(),p.n);append(p.importance.data(),p.n);append(p.dist.data(),p.n);
  append(p.gray.data(),p.n);
  if(!reusePrevious){append(p.oldGray.data(),p.n);append(p.oldIndex.data(),p.cells);}
  else pos+=p.n+p.cells;
  std::fill(frameInput.begin()+pos,frameInput.end(),0);append(p.face.data(),p.F*4);
  const UINT start=(UINT)(baseWords+(sequence%10)*ringWords);
  for(UINT k=0;k<5;k++)offsets[k]=start+(UINT)(k*p.n);
  offsets[5]=start+(UINT)(5*p.n);offsets[12]=start+(UINT)(5*p.n+p.cells);
  // Write final layout directly into this slot. The previous slot's IDs
  // remain available without an extra copy kernel or CPU round-trip.
  offsets[15]=start+(UINT)(5*p.n+p.cells+32);
  if(reusePrevious){
   const UINT prior=(UINT)(baseWords+((sequence-1)%10)*ringWords);
   offsets[4]=prior+(UINT)(3*p.n);offsets[5]=prior+(UINT)(5*p.n+p.cells+32);
  }
  std::copy(offsets.begin(),offsets.end(),host.begin());
  const UINT zero[4]={};
  gpu.context->ClearUnorderedAccessViewUint(scratchA.Get(),zero);
  gpu.context->ClearUnorderedAccessViewUint(scratchB.Get(),zero);
  upload(0,64*4,host.data());
  if(reusePrevious){
   upload(start*4,(UINT)p.n*16,frameInput.data());
   upload(offsets[12]*4,32*4,frameInput.data()+5*p.n+p.cells);
  }else upload(start*4,(UINT)(5*p.n+p.cells+32)*4,frameInput.data());
  metrics[10]=sequence%10;
 }
 struct alignas(16) Params {uint32_t W,H,S,G,kind,first,stride,count,x,y,beam,options,faces,old,cut,budget;};
 Params lastParams{};bool paramsValid=false;
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
 void prepareArena(const Payload& p,bool wantResident=false){
  host.assign(64,0);size_t C=p.cells,N=p.n,G=p.G,S=p.S;
  offsets[0]=add(N,&p.target);offsets[1]=add(N,&p.importance);offsets[2]=add(N,&p.dist);
  offsets[3]=add(N,&p.gray);offsets[4]=add(N,&p.oldGray);offsets[5]=add(C,&p.oldIndex);
  offsets[6]=add(G,&p.columns);offsets[7]=add(G,&p.shape);offsets[8]=add(G,&p.penalty);
  offsets[9]=add(G*4,&p.glyphOrient);offsets[10]=add(p.mask.size(),&p.mask);offsets[11]=add(p.expanded.size(),&p.expanded);
  offsets[12]=add(32,&p.face);offsets[13]=zeros(C*G);offsets[14]=zeros(C*40);
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
  baseWords=host.size();ringWords=5*p.n+2*p.cells+32;
  residentEnabled=wantResident;fallbackReason=0;
  if(residentEnabled&&ringWords*4*10+1024*1024>256ull*1024*1024){residentEnabled=false;fallbackReason=1;}
  // A single job-start check. Never resize/tune based on per-frame load.
  videoMemory();
  if(residentEnabled&&(metrics[13]<=0||
     metrics[12]+double((baseWords+ringWords*10)*4)+256.0*1024*1024>metrics[13])){
   residentEnabled=false;fallbackReason=2;
  }
  const size_t desired=baseWords+(residentEnabled?ringWords*10:0);
  const std::array<uint32_t,4> shape={(uint32_t)p.W,(uint32_t)p.H,(uint32_t)p.S,(uint32_t)p.G};
  bool reuse=false;
  if(memory){D3D11_BUFFER_DESC prior={};memory->GetDesc(&prior);
   reuse=prior.ByteWidth==desired*4&&(!residentEnabled||(scratchA&&residentShape==shape));
  }
  if(!reuse){
   releaseArena();
   try{
    if(residentEnabled&&std::getenv("TASL_TEST_WARP")&&std::getenv("TASL_TEST_RESIDENT_FAIL_ALLOC"))
     throw std::runtime_error("explicit WARP allocation failure test");
    allocateArena(desired,p.cells);
   }
   catch(...){
    if(!residentEnabled)throw;
    releaseArena();residentEnabled=false;fallbackReason=3;allocateArena(baseWords,p.cells);
   }
  }
  residentShape=shape;
  if(residentEnabled)frameInput.resize(ringWords-p.cells);

  uploadInputs(p);
 }
 void uploadInputs(const Payload& p){
  // Scratch is initialized on the GPU; only actual input data crosses PCIe.
  const UINT zero[4]={0,0,0,0};
  gpu.context->ClearUnorderedAccessViewUint(uav.Get(),zero);
  upload(0,offsets[13]*4,host.data());
  upload(offsets[20]*4,(UINT)(p.G*8*p.S)*4,host.data()+offsets[20]);
  metrics[9]++;
 }
 void dispatch(int which,Params& p,UINT x,UINT y=1){
  if(!x)return;
  if(!residentEnabled||!paramsValid||std::memcmp(&lastParams,&p,sizeof(p))!=0){
   gpu.context->UpdateSubresource(constants.Get(),0,nullptr,&p,0,0);
   lastParams=p;paramsValid=true;metrics[2]++;metrics[3]+=sizeof(Params);
  }
  metrics[11]++;
  if(!residentEnabled||!bindingsActive){
   ID3D11Buffer* cb[]={constants.Get()};ID3D11UnorderedAccessView* uv[]={uav.Get()};
   gpu.context->CSSetConstantBuffers(0,1,cb);gpu.context->CSSetUnorderedAccessViews(0,1,uv,nullptr);bindingsActive=true;
  }
  if(!residentEnabled||boundShader!=which){gpu.context->CSSetShader(shaders[which].Get(),nullptr,0);boundShader=which;}
  gpu.context->Dispatch(x,y,1);
 }
 void start(int k){gpu.context->End(stamps[k].start.Get());}
 void end(int k){gpu.context->End(stamps[k].end.Get());}
 void compute(const LayoutRequest& request){
  const auto& src=*request.value;
  metrics.fill(0);metrics[7]=firstRequest?2:0;firstRequest=false;
  metrics[10]=-1;metrics[12]=-1;metrics[13]=-1;
  auto begin=Clock::now();
  const auto priorFallback=fallbackReason;
  if(request.initial||!residentEnabled)prepareArena(src,request.initial&&request.resident);
  if(!request.initial&&!residentEnabled)fallbackReason=priorFallback;
  if(request.reusePrevious&&!residentEnabled)throw std::runtime_error("resident temporal state unavailable");
  if(residentEnabled)uploadResident(src,request.sequence,request.reusePrevious);
  metrics[0]=residentEnabled?1:0;metrics[1]=residentEnabled?ringWords*4*10:0;
  metrics[14]=fallbackReason;metrics[15]=request.sequence;
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
    ID3D11UnorderedAccessView* empty[]={nullptr};gpu.context->CSSetUnorderedAccessViews(0,1,empty,nullptr);bindingsActive=false;
    D3D11_BOX box={offsets[22]*4,0,0,offsets[22]*4+16,1,1};
    gpu.context->CopySubresourceRegion(counterReadback.Get(),0,0,0,0,memory.Get(),0,&box);
    metrics[4]++;metrics[5]+=16;
    auto waitBegin=Clock::now();
    D3D11_MAPPED_SUBRESOURCE m={};checked(gpu.context->Map(counterReadback.Get(),0,D3D11_MAP_READ,0,&m),"critic budget");
    metrics[6]+=std::chrono::duration<double,std::milli>(Clock::now()-waitBegin).count();
    budgetReached=((uint32_t*)m.pData)[2]>=p.budget;gpu.context->Unmap(counterReadback.Get(),0);
    if(budgetReached)break;
   }
  }
  end(5);
  gpu.context->End(disjoint.Get());
  ID3D11UnorderedAccessView* none[]={nullptr};gpu.context->CSSetUnorderedAccessViews(0,1,none,nullptr);bindingsActive=false;
  D3D11_BOX rowsBox={offsets[15]*4,0,0,(UINT)(offsets[15]+src.cells)*4,1,1};
  D3D11_BOX diagBox={offsets[22]*4,0,0,(offsets[22]+16)*4,1,1};
  gpu.context->CopySubresourceRegion(staging.Get(),0,0,0,0,memory.Get(),0,&rowsBox);
  gpu.context->CopySubresourceRegion(staging.Get(),0,(UINT)src.cells*4,0,0,memory.Get(),0,&diagBox);
  metrics[4]+=2;metrics[5]+=(src.cells+16)*4;
  auto waitBegin=Clock::now();
  D3D11_MAPPED_SUBRESOURCE mapped={};checked(gpu.context->Map(staging.Get(),0,D3D11_MAP_READ,0,&mapped),"layout readback");
  metrics[6]+=std::chrono::duration<double,std::milli>(Clock::now()-waitBegin).count();
  const auto* result=(const uint32_t*)mapped.pData;
  uint32_t header[]={0x344c4746,p.W,p.H,p.G};
  std::cout.write((char*)header,sizeof(header));
  std::cout.write((const char*)result,src.cells*4);
  std::cout.write((const char*)(result+src.cells),16*4);
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
  std::cout.write((char*)timings.data(),sizeof(timings));
  if(request.extended){videoMemory();std::cout.write((char*)metrics.data(),sizeof(metrics));}
  std::cout.flush();
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
  if(argc==2&&std::string(argv[1])=="--adapter-index"){NativeDirectCompute gpu;std::cout<<gpu.adapterIndex<<"\n";return 0;}
  FullGPU engine;
  if(argc==2&&std::string(argv[1])=="--probe"){std::cout<<"DIRECTCOMPUTE_LAYOUT "<<engine.gpu.gpuName<<"\n";return 0;}
  if(argc!=2||std::string(argv[1])!="--stream")throw std::runtime_error("expected --stream");
  LayoutRequest request;
  while(std::cin.peek()!=std::char_traits<char>::eof()){request.read();engine.compute(request);}
  return 0;
 }catch(const std::exception& e){std::cerr<<"FULLGPU_ERROR "<<e.what()<<"\n";return 1;}
}
