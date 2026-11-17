#include "fullgpu_device.hpp"
#include "portable_preprocess.hpp"
#include <cstring>
#include <fstream>
#include <memory>
using Clock=std::chrono::steady_clock;
static double elapsed(Clock::time_point a){return std::chrono::duration<double,std::milli>(Clock::now()-a).count();}
static int setting(const char* name,int value){const char* p=std::getenv(name);return p?std::atoi(p):value;}
static const uint8_t* mappedInput=nullptr;
static size_t mappedPosition=0;
static bool readingMapped=false;
static void readBytes(void* p,size_t n){
 if(readingMapped){if(mappedPosition+n>40*1024*1024)throw std::runtime_error("Shared input overflow");std::memcpy(p,mappedInput+mappedPosition,n);mappedPosition+=n;return;}
 std::cin.read((char*)p,n);if(!std::cin)throw std::runtime_error("Truncated PORTABLE request");
}
struct D3DMatcher {
 NativeDirectCompute gpu;
 ComPtr<ID3D11ComputeShader> scoreShader,reduceShader;
 ComPtr<ID3D11Buffer> params,targets,scores,winners,staging;
 ComPtr<ID3D11ShaderResourceView> targetView;
 ComPtr<ID3D11UnorderedAccessView> scoreView,winnerView;
 InputView atlas;uint32_t capacity=0;int strategy,groupSize;ComPtr<ID3DBlob> scoreCode;
 D3DMatcher():strategy(setting("TASL_PORTABLE_STRATEGY",2)),groupSize(setting("TASL_PORTABLE_GROUP",128)){
  if(groupSize!=64&&groupSize!=128&&groupSize!=256)throw std::runtime_error("Unsupported group size");
  const auto gs=std::to_string(groupSize),ss=std::to_string(strategy),prune=std::to_string(setting("TASL_PORTABLE_PRUNE",1));D3D_SHADER_MACRO macros[]={{"SCORE_GROUP",gs.c_str()},{"SCORING_STRATEGY",ss.c_str()},{"SAFE_PRUNE",prune.c_str()},{nullptr,nullptr}};
  auto path=shaderFilename();path=path.substr(0,path.find_last_of(L"\\/")+1)+L"portable_match.hlsl";
  for(auto item: {std::pair<const char*,ComPtr<ID3D11ComputeShader>*>("score",&scoreShader),{"reduce",&reduceShader}}){
   const auto cacheKey=std::string(item.first)+"-s"+ss+"-g"+gs+"-p"+prune;
   auto code=readShaderCache(path,cacheKey.c_str());ComPtr<ID3DBlob> error;
   if(!code){auto hr=D3DCompileFromFile(path.c_str(),macros,nullptr,item.first,"cs_5_0",D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&code,&error);
    if(FAILED(hr))throw std::runtime_error(error?(char*)error->GetBufferPointer():"Portable shader compile");writeShaderCache(path,cacheKey.c_str(),code.Get());}
   if(std::string(item.first)=="score")scoreCode=code;
   checked(gpu.device->CreateComputeShader(code->GetBufferPointer(),code->GetBufferSize(),nullptr,item.second->GetAddressOf()),"Portable shader");
  }
  D3D11_BUFFER_DESC b={};b.ByteWidth=16;b.Usage=D3D11_USAGE_DEFAULT;b.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
  checked(gpu.device->CreateBuffer(&b,nullptr,&params),"Portable constants");
 }
 void init(const std::vector<float>& glyphs){
  if(strategy==1)atlas=gpu.upload(glyphs);
  else{std::vector<float> transposed(2048*1152);for(int g=0;g<2014;g++)for(int j=0;j<1152;j++)transposed[j*2048+g]=glyphs[g*1152+j];atlas=gpu.upload(transposed);}
 }
 void allocate(uint32_t cells){
  if(cells<=capacity)return;
  uint32_t allocation=1;while(allocation<cells)allocation*=2;cells=allocation;
  targets.Reset();targetView.Reset();scores.Reset();scoreView.Reset();winners.Reset();winnerView.Reset();staging.Reset();
  D3D11_BUFFER_DESC b={};b.ByteWidth=cells*1152*4;b.Usage=D3D11_USAGE_DEFAULT;b.BindFlags=D3D11_BIND_SHADER_RESOURCE;b.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;b.StructureByteStride=4;
  checked(gpu.device->CreateBuffer(&b,nullptr,&targets),"Portable targets");
  D3D11_SHADER_RESOURCE_VIEW_DESC sv={};sv.ViewDimension=D3D11_SRV_DIMENSION_BUFFER;sv.Buffer.NumElements=cells*1152;
  checked(gpu.device->CreateShaderResourceView(targets.Get(),&sv,&targetView),"Portable targets view");
  b.ByteWidth=cells*2014*4;b.BindFlags=D3D11_BIND_UNORDERED_ACCESS;
  checked(gpu.device->CreateBuffer(&b,nullptr,&scores),"Portable scores");
  D3D11_UNORDERED_ACCESS_VIEW_DESC uv={};uv.ViewDimension=D3D11_UAV_DIMENSION_BUFFER;uv.Buffer.NumElements=cells*2014;
  checked(gpu.device->CreateUnorderedAccessView(scores.Get(),&uv,&scoreView),"Portable score view");
  b.ByteWidth=cells*8;b.StructureByteStride=8;uv.Buffer.NumElements=cells;
  checked(gpu.device->CreateBuffer(&b,nullptr,&winners),"Portable winners");
  checked(gpu.device->CreateUnorderedAccessView(winners.Get(),&uv,&winnerView),"Portable winner view");
  b.Usage=D3D11_USAGE_STAGING;b.BindFlags=0;b.MiscFlags=0;b.StructureByteStride=0;b.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
  checked(gpu.device->CreateBuffer(&b,nullptr,&staging),"Portable staging");capacity=cells;
 }
 std::vector<uint32_t> match(const std::vector<float>& data,uint32_t cells,bool dump=false,float cutoff=std::numeric_limits<float>::infinity()){
  allocate(cells);D3D11_BOX box={0,0,0,cells*1152*4,1,1};gpu.context->UpdateSubresource(targets.Get(),0,&box,data.data(),0,0);
  uint32_t p[]={cells,2014,1152,0};std::memcpy(&p[3],&cutoff,4);gpu.context->UpdateSubresource(params.Get(),0,nullptr,p,0,0);
  ID3D11Buffer* cb[]={params.Get()};ID3D11ShaderResourceView* in[]={targetView.Get(),atlas.srv.Get()};ID3D11UnorderedAccessView* out[]={scoreView.Get(),winnerView.Get()};
  gpu.context->CSSetConstantBuffers(0,1,cb);gpu.context->CSSetShaderResources(0,2,in);gpu.context->CSSetUnorderedAccessViews(0,2,out,nullptr);
  gpu.context->CSSetShader(scoreShader.Get(),nullptr,0);const uint32_t groups=cells*((2014+groupSize-1)/groupSize);gpu.context->Dispatch(std::min(65535u,groups),(groups+65534)/65535,1);
  gpu.context->CSSetShader(reduceShader.Get(),nullptr,0);gpu.context->Dispatch(cells,1,1);
  ID3D11ShaderResourceView* noIn[2]={};ID3D11UnorderedAccessView* noOut[2]={};
  gpu.context->CSSetShaderResources(0,2,noIn);gpu.context->CSSetUnorderedAccessViews(0,2,noOut,nullptr);
  ComPtr<ID3D11Buffer> fullRead;ID3D11Buffer* readback=staging.Get();ID3D11Buffer* from=winners.Get();size_t bytes=cells*8;
  if(dump){D3D11_BUFFER_DESC b={};b.ByteWidth=capacity*2014*4;b.Usage=D3D11_USAGE_STAGING;b.CPUAccessFlags=D3D11_CPU_ACCESS_READ;checked(gpu.device->CreateBuffer(&b,nullptr,&fullRead),"Dump allocation");readback=fullRead.Get();from=scores.Get();bytes=cells*2014*4;}
  gpu.context->CopyResource(readback,from);D3D11_MAPPED_SUBRESOURCE m={};checked(gpu.context->Map(readback,0,D3D11_MAP_READ,0,&m),"Portable readback");
  std::vector<uint32_t> result(bytes/4);std::memcpy(result.data(),m.pData,bytes);gpu.context->Unmap(readback,0);return result;
 }
};
struct Engine {
 Preprocessor prep;D3DMatcher gpu;std::vector<float> glyphs,previousFeatures,activeFeatures;std::vector<std::vector<int>> glyphInk;std::vector<uint32_t> previousResults,activeCells;std::vector<uint8_t> pixels;bool initialized=false;float previousCutoff=std::numeric_limits<float>::infinity();
 Engine():prep(std::max(1,std::min(16,setting("TASL_PORTABLE_THREADS",int(std::max(1u,std::thread::hardware_concurrency()))))),IsProcessorFeaturePresent(PF_XMMI64_INSTRUCTIONS_AVAILABLE)&&setting("TASL_PORTABLE_SIMD",1)!=0){}

 std::vector<uint32_t> match(const std::vector<float>& data,uint32_t cells,bool dump=false,float cutoff=std::numeric_limits<float>::infinity()){
  return gpu.match(data,cells,dump,cutoff);
 }

 void compute(){
  auto begin=Clock::now();readingMapped=false;uint32_t h[8];readBytes(h,32);
  if(h[1]&0x80000000u){if(!mappedInput)throw std::runtime_error("Missing shared mapping");readingMapped=true;mappedPosition=0;h[1]&=0x7fffffffu;}
  if(h[0]!=0x55343654)throw std::runtime_error("Portable protocol magic");
  uint32_t op=h[1],cells=0;std::vector<uint32_t> result,counts;std::vector<float> features;double timings[8]={};
  if(op==1){
   if(h[2]!=2014||h[3]!=1152)throw std::runtime_error("Portable atlas shape");
   glyphs.resize(2014*1152);readBytes(glyphs.data(),glyphs.size()*4);
   for(float v:glyphs)if(!std::isfinite(v)||v<0)throw std::runtime_error("Portable atlas values");
   gpu.init(glyphs);glyphInk.assign(2014,{});for(int g=0;g<2014;g++)for(int j=0;j<576;j++)if(glyphs[g*1152+j])glyphInk[g].push_back(j);initialized=true;previousFeatures.clear();previousResults.clear();
  }else if(op==2||op==5){
   cells=h[2];if(!initialized||cells<1||cells>4095||h[3]!=2014||h[4]!=1152)throw std::runtime_error("Portable descriptor shape");
   features.resize(cells*1152);readBytes(features.data(),features.size()*4);
   for(float v:features)if(!std::isfinite(v)||v<0)throw std::runtime_error("Portable target values");
   auto t=Clock::now();result=match(features,cells,op==5);timings[4]=elapsed(t);counts.assign(cells,0);
  }else if(op==3||op==4){
   int W=h[2],H=h[3],kn=h[4];if(!initialized||W<60||H<60||W%60||H%60||uint64_t(W)*H>8640000||kn<1||kn>145)throw std::runtime_error("Portable pixel shape");
   double options[8];readBytes(options,64);for(double v:options)if(!std::isfinite(v))throw std::runtime_error("Portable options nonfinite");
   if(options[3]<0||options[3]>24||kn!=2*int(std::ceil(options[3]*3))+1)throw std::runtime_error("Portable Gaussian invalid");
   std::vector<float> kernel(kn);readBytes(kernel.data(),kn*4);for(float v:kernel)if(!std::isfinite(v)||v<0||v>1)throw std::runtime_error("Portable kernel invalid");
   const bool rgb=h[7]==3;pixels.resize(size_t(W)*H*(rgb?3:4));readBytes(pixels.data(),pixels.size());
   auto t=Clock::now();auto prepared=rgb?prep.compute<3>(pixels.data(),W,H,options,kernel):prep.compute<4>(pixels.data(),W,H,options,kernel);timings[0]=prepared.grayMs;timings[1]=prepared.blurMs;timings[2]=prepared.edgeMs;timings[3]=prepared.descriptorMs;
   features=std::move(prepared.features);counts=std::move(prepared.counts);cells=uint32_t(counts.size());
   if(op==3){
    t=Clock::now();result.resize(cells*2);auto& active=activeFeatures;auto& mapping=activeCells;active.clear();mapping.clear();active.reserve(features.size());mapping.reserve(cells);
    float cutoff=std::numeric_limits<float>::infinity();
    if(h[6]==1&&options[7]==0){std::memcpy(&cutoff,&h[5],4);if(!std::isfinite(cutoff)||cutoff<0||cutoff>10)throw std::runtime_error("Portable cutoff invalid");}
    const bool cache=previousFeatures.size()==features.size()&&previousCutoff==cutoff;
    for(uint32_t c=0;c<cells;c++){
     if(options[7]==0&&counts[c]<options[6]){result[c*2]=0;result[c*2+1]=0;continue;}
     if(cache&&std::memcmp(&features[c*1152],&previousFeatures[c*1152],1152*4)==0){result[c*2]=previousResults[c*2];result[c*2+1]=previousResults[c*2+1];continue;}
     mapping.push_back(c);active.insert(active.end(),features.begin()+c*1152,features.begin()+(c+1)*1152);
    }
    if(!mapping.empty()){auto computed=match(active,uint32_t(mapping.size()),false,cutoff);for(size_t i=0;i<mapping.size();i++){result[mapping[i]*2]=computed[i*2];result[mapping[i]*2+1]=computed[i*2+1];}}
    previousFeatures.swap(features);previousResults=result;previousCutoff=cutoff;timings[4]=elapsed(t);timings[5]=double(mapping.size());timings[6]=double(cells-mapping.size());
   }
  }else throw std::runtime_error("Unknown Portable operation");
  timings[7]=elapsed(begin);uint32_t response[]={0x55343652,op,cells,2014,1152,0,0,0};std::cout.write((char*)response,32);
  if(op==4){std::cout.write((char*)features.data(),features.size()*4);std::cout.write((char*)counts.data(),counts.size()*4);}
  else if(op==5)std::cout.write((char*)result.data(),result.size()*4);
  else if(op!=1)for(uint32_t c=0;c<cells;c++){uint32_t row[]={result[c*2],result[c*2+1],counts[c]};std::cout.write((char*)row,12);}
  std::cout.write((char*)timings,64);std::cout.flush();
 }
};
int main(int argc,char** argv){
 try{
  _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);std::ios::sync_with_stdio(false);std::cin.tie(nullptr);
  Engine e;if(argc==2&&std::string(argv[1])=="--shader-info"){ComPtr<ID3DBlob> assembly;checked(D3DDisassemble(e.gpu.scoreCode->GetBufferPointer(),e.gpu.scoreCode->GetBufferSize(),0,nullptr,&assembly),"shader disassembly");std::cout.write((char*)assembly->GetBufferPointer(),assembly->GetBufferSize());return 0;}
  if(argc==2&&std::string(argv[1])=="--probe"){std::cout<<"PORTABLE_DIRECTCOMPUTE "<<e.gpu.gpu.gpuName<<"\n";return 0;}
  if((argc!=2&&argc!=3)||std::string(argv[1])!="--stream")throw std::runtime_error("Expected --stream");
  HANDLE mapping=nullptr;
  if(argc==3){mapping=OpenFileMappingA(FILE_MAP_READ,FALSE,argv[2]);if(!mapping)throw std::runtime_error("Cannot open input mapping");mappedInput=(const uint8_t*)MapViewOfFile(mapping,FILE_MAP_READ,0,0,40*1024*1024);if(!mappedInput)throw std::runtime_error("Cannot map input");}
  while(std::cin.peek()!=std::char_traits<char>::eof())e.compute();
  if(mappedInput)UnmapViewOfFile(mappedInput);if(mapping)CloseHandle(mapping);return 0;
 }catch(const std::exception& e){std::cerr<<"PORTABLE_ERROR "<<e.what()<<"\n";return 1;}
}
