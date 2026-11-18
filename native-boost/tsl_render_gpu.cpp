#include "fullgpu_device.hpp"
#define main original_gdi_renderer_entry
#include "tsl_render_win.cpp"
#undef main
#include <unordered_map>
#include <cstring>
#include <chrono>
static std::vector<std::string_view> lineViews(std::string_view text){
 std::vector<std::string_view> result;
 for(size_t at=0;at<text.size();){size_t end=text.find('\n',at);if(end==std::string_view::npos)end=text.size();auto line=text.substr(at,end-at);if(!line.empty()&&line.back()=='\r')line.remove_suffix(1);result.push_back(line);at=end+1;}
 return result;
}
struct GpuRaster {
 NativeDirectCompute gpu;
 ComPtr<ID3D11ComputeShader> raster;
 ComPtr<ID3D11Buffer> grid,output,staging,constants;
 ComPtr<ID3D11ShaderResourceView> gridView;
 ComPtr<ID3D11UnorderedAccessView> outputView;
 InputView glyphAtlas;
 std::unordered_map<std::string,uint32_t> glyphIds;
 uint32_t width,height,cw,ch,ow,oh,fitW,fitH,nv12,byteCount,words;
 std::vector<uint32_t> cellData; std::vector<uint32_t> fastGlyphs; bool positioned=false;
 GpuRaster(const TSL& t,const Params& options):width(t.width),height(t.height),cw(t.mode4CellSize?t.mode4CellSize/2:t.mode4Cell120?60:t.native16?8:12),ch(t.mode4CellSize?t.mode4CellSize:t.mode4Cell120?120:t.native16?16:24){
  ow=options.outWidth?options.outWidth:width*cw;oh=options.outHeight?options.outHeight:height*ch;nv12=options.nv12?1:0;
  if(ow>7680||oh>5760||(nv12&&((ow|oh)&1)))throw std::runtime_error("invalid output geometry");
  double scale=std::min(double(ow)/(width*cw),double(oh)/(height*ch));
  fitW=std::max(1u,(uint32_t)std::round(width*cw*scale));fitH=std::max(1u,(uint32_t)std::round(height*ch*scale));
  byteCount=ow*oh*(nv12?3:8)/2;words=(byteCount+3)/4;
  auto path=shaderFilename();path=path.substr(0,path.find_last_of(L"\\/")+1)+L"tsl_render_gpu.hlsl";
  ComPtr<ID3DBlob> code,error;
  auto hr=D3DCompileFromFile(path.c_str(),nullptr,nullptr,"main","cs_5_0",D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&code,&error);
  if(FAILED(hr))throw std::runtime_error(error?(char*)error->GetBufferPointer():"raster shader compile");
  checked(gpu.device->CreateComputeShader(code->GetBufferPointer(),code->GetBufferSize(),nullptr,&raster),"raster shader");
  positioned=t.mode4CellSize&&!t.offsets.empty();
  glyphIds[" "]=0;if(!positioned){fastGlyphs.assign(65536,0xffffffff);fastGlyphs[32]=0;}
  for(int frame=0;frame<t.count;frame++){
   size_t at=0;
   for(const auto& line:lineViews(t.frame(frame)))for(size_t i=0;i<line.size();){
    size_t len=leadByte((uint8_t)line[i])&&i+1<line.size()?2:1;
    if(!positioned){uint32_t code=(uint8_t)line[i]+(len==2?uint32_t((uint8_t)line[i+1])*256:0);if(fastGlyphs[code]==0xffffffff){uint32_t id=(uint32_t)glyphIds.size();fastGlyphs[code]=id;glyphIds.emplace(std::string(line.substr(i,len)),id);}}
    else{std::string key(line.substr(i,len));if(len!=2||at+1>=t.position(frame)->size())throw std::runtime_error("Mode4 positioned glyph invalid");key.push_back(char((*t.position(frame))[at]));key.push_back(char((*t.position(frame))[at+1]));if(!glyphIds.count(key))glyphIds[key]=(uint32_t)glyphIds.size();}
    i+=len;at+=len;
   }
   if(positioned&&at!=size_t(width)*height)throw std::runtime_error("Mode4 positioned frame size invalid");
  }
  if(glyphIds.size()>12000)throw std::runtime_error("glyph atlas too large");
  Surface font(2,1,t.native16,t.mode4Cell120,t.mode4CellSize,t.halftoneCalibrated);std::vector<uint32_t> atlas(glyphIds.size()*cw*2*ch);
  for(const auto& pair:glyphIds){
   if(positioned&&pair.first.size()==4){std::vector<unsigned char> offset{(unsigned char)pair.first[2],(unsigned char)pair.first[3]};font.draw(pair.first.substr(0,2)+"\r\n",2,1,&offset);}
   else font.draw(pair.first+"\r\n",2,1);GdiFlush();
   std::memcpy(atlas.data()+pair.second*cw*2*ch,font.pixels,cw*2*ch*4);
  }
  glyphAtlas=gpu.upload(atlas);cellData.resize(width*height);
  D3D11_BUFFER_DESC d={};d.ByteWidth=width*height*4;d.Usage=D3D11_USAGE_DEFAULT;d.BindFlags=D3D11_BIND_SHADER_RESOURCE;
  d.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;d.StructureByteStride=4;
  checked(gpu.device->CreateBuffer(&d,nullptr,&grid),"raster grid");
  D3D11_SHADER_RESOURCE_VIEW_DESC sd={};sd.ViewDimension=D3D11_SRV_DIMENSION_BUFFER;sd.Buffer.NumElements=width*height;
  checked(gpu.device->CreateShaderResourceView(grid.Get(),&sd,&gridView),"raster grid view");
  d.ByteWidth=words*4;d.BindFlags=D3D11_BIND_UNORDERED_ACCESS;
  checked(gpu.device->CreateBuffer(&d,nullptr,&output),"raster pixels");
  D3D11_UNORDERED_ACCESS_VIEW_DESC ud={};ud.ViewDimension=D3D11_UAV_DIMENSION_BUFFER;ud.Buffer.NumElements=words;
  checked(gpu.device->CreateUnorderedAccessView(output.Get(),&ud,&outputView),"raster output view");
  d.Usage=D3D11_USAGE_STAGING;d.BindFlags=0;d.CPUAccessFlags=D3D11_CPU_ACCESS_READ;d.MiscFlags=0;d.StructureByteStride=0;
  checked(gpu.device->CreateBuffer(&d,nullptr,&staging),"raster readback");
  d.ByteWidth=64;d.Usage=D3D11_USAGE_DEFAULT;d.BindFlags=D3D11_BIND_CONSTANT_BUFFER;d.CPUAccessFlags=0;
  checked(gpu.device->CreateBuffer(&d,nullptr,&constants),"raster constants");
 }
 void submit(std::string_view frame,const std::vector<unsigned char>* offsets){
  std::fill(cellData.begin(),cellData.end(),0);uint32_t y=0;
  for(const auto& line:lineViews(frame)){
   if(y>=height)break;uint32_t x=0;
   for(size_t i=0;i<line.size()&&x<width;){
    uint32_t len=leadByte((uint8_t)line[i])&&i+1<line.size()?2:1;
    if(x+len>width)break;
    uint32_t g;
    if(!positioned){uint32_t code=(uint8_t)line[i]+(len==2?uint32_t((uint8_t)line[i+1])*256:0);g=fastGlyphs[code];if(g==0xffffffff)throw std::runtime_error("Unknown TSL glyph");}
    else{std::string key(line.substr(i,len));if(!offsets||len!=2||y*width+x+1>=offsets->size())throw std::runtime_error("Mode4 render offset missing");key.push_back(char((*offsets)[y*width+x]));key.push_back(char((*offsets)[y*width+x+1]));g=glyphIds.at(key);}
    cellData[y*width+x]=g*2;if(len==2)cellData[y*width+x+1]=g*2+1;
    x+=len;i+=len;
   }y++;
  }
  if(y!=height)throw std::runtime_error("TSL frame rows missing");
  gpu.context->UpdateSubresource(grid.Get(),0,nullptr,cellData.data(),0,0);
  uint32_t total=words,gx=std::min(65535u,(total+127)/128),params[]={width,height,cw,ch,total,gx,ow,oh,fitW,fitH,(ow-fitW)/2,(oh-fitH)/2,nv12,byteCount,0,0};
  gpu.context->UpdateSubresource(constants.Get(),0,nullptr,params,0,0);
  ID3D11ShaderResourceView* input[]={glyphAtlas.srv.Get(),gridView.Get()};
  ID3D11UnorderedAccessView* out[]={outputView.Get()};ID3D11Buffer* cb[]={constants.Get()};
  gpu.context->CSSetShader(raster.Get(),nullptr,0);gpu.context->CSSetShaderResources(0,2,input);
  gpu.context->CSSetUnorderedAccessViews(0,1,out,nullptr);gpu.context->CSSetConstantBuffers(0,1,cb);
  gpu.context->Dispatch(gx,(total+gx*128-1)/(gx*128),1);
  ID3D11UnorderedAccessView* empty[]={nullptr};gpu.context->CSSetUnorderedAccessViews(0,1,empty,nullptr);
  gpu.context->CopyResource(staging.Get(),output.Get());
 }
 void read(std::vector<uint32_t>& result){
  D3D11_MAPPED_SUBRESOURCE m={};checked(gpu.context->Map(staging.Get(),0,D3D11_MAP_READ,0,&m),"raster map");
  result.resize(words);std::memcpy(result.data(),m.pData,words*4);gpu.context->Unmap(staging.Get(),0);
 }
 void draw(std::string_view frame,const std::vector<unsigned char>* offsets,std::vector<uint32_t>& result){submit(frame,offsets);read(result);}
};
int main(int argc,char** argv){
 try{
  if(argc==2&&std::string(argv[1])=="--probe"){NativeDirectCompute gpu;std::cout<<"DIRECTCOMPUTE_RASTER "<<gpu.gpuName<<"\n";return 0;}
  std::ios::sync_with_stdio(false);
  auto started=std::chrono::steady_clock::now();double drawMs=0,writeMs=0;
  _setmode(_fileno(stdout),_O_BINARY);const auto a=args(argc,argv);const TSL t(a.input);GpuRaster raster(t,a);
  std::cerr<<"RASTER_BACKEND DirectCompute "<<raster.gpu.gpuName<<"\n";
  int frames=t.mode4Fps?int(std::ceil(t.mode4Duration*a.fps)):int((int64_t(t.durationTicks)*a.fps+59)/60);if(!t.mode4Fps&&t.count==frames+1)frames=t.count;int last=-1;std::vector<uint32_t> image;
  const char* setting=std::getenv("TASL_RENDER_PIPELINE");const bool pipeline=!setting||std::string(setting)!="0";
  auto frameAt=[&](int i){int tick=int(int64_t(i)*60/a.fps);return t.mode4Fps?std::min(t.count-1,int(i*t.mode4Fps/a.fps+1e-8)):std::min(t.count-1,std::max(0,int(std::upper_bound(t.ticks.begin(),t.ticks.end(),tick)-t.ticks.begin())-1));};
  if(pipeline){auto ds=std::chrono::steady_clock::now();last=frameAt(0);raster.draw(t.frame(last),t.position(last),image);drawMs+=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-ds).count();}
  for(int i=0;i<frames;i++){
   auto ds=std::chrono::steady_clock::now();int next=last;bool queued=false;
   if(pipeline){
    if(i+1<frames){next=frameAt(i+1);if(next!=last){raster.submit(t.frame(next),t.position(next));raster.gpu.context->Flush();queued=true;}}
   }else{int n=frameAt(i);if(n!=last){raster.draw(t.frame(n),t.position(n),image);last=n;}}
   auto ws=std::chrono::steady_clock::now();drawMs+=std::chrono::duration<double,std::milli>(ws-ds).count();
   // While the next raster runs on the GPU, feed the already-read current
   // frame to NVENC. CPU storage is reused only after this write completes.
   std::cout.write((char*)image.data(),raster.byteCount);if(!std::cout)throw std::runtime_error("video pipe closed");
   writeMs+=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-ws).count();
   if(queued){auto rs=std::chrono::steady_clock::now();raster.read(image);last=next;drawMs+=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-rs).count();}
   if((i+1)%24==0||i+1==frames)std::cerr<<"RENDER "<<i+1<<"/"<<frames<<"\n";
  }std::cerr<<"PUBLIC_RENDER_TIMING drawMs="<<drawMs<<" writeMs="<<writeMs<<" wallMs="<<std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-started).count()<<"\n";return 0;
 }catch(const std::exception& e){std::cerr<<"GPU_RENDER_ERROR "<<e.what()<<"\n";return 1;}
}
