#include "fullgpu_device.hpp"
#define main original_gdi_renderer_entry
#include "tsl_render_win.cpp"
#undef main
#include <unordered_map>
#include <cstring>
struct GpuRaster {
 NativeDirectCompute gpu;
 ComPtr<ID3D11ComputeShader> raster;
 ComPtr<ID3D11Buffer> grid,output,staging,constants;
 ComPtr<ID3D11ShaderResourceView> gridView;
 ComPtr<ID3D11UnorderedAccessView> outputView;
 InputView glyphAtlas;
 std::unordered_map<std::string,uint32_t> glyphIds;
 uint32_t width,height,cw,ch,ow,oh,fitW,fitH,nv12,byteCount,words;
 std::vector<uint32_t> cellData;
 GpuRaster(const TSL& t,const Params& options):width(t.width),height(t.height),cw(t.native16?8:12),ch(t.native16?16:24){
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
  glyphIds[" "]=0;
  for(int frame=0;frame<t.count;frame++)for(const auto& line:lines(t.frame(frame)))
   for(size_t i=0;i<line.size();){size_t len=leadByte((uint8_t)line[i])&&i+1<line.size()?2:1;
    std::string key=line.substr(i,len);if(!glyphIds.count(key))glyphIds[key]=(uint32_t)glyphIds.size();i+=len;
   }
  if(glyphIds.size()>12000)throw std::runtime_error("glyph atlas too large");
  Surface font(2,1,t.native16);std::vector<uint32_t> atlas(glyphIds.size()*cw*2*ch);
  for(const auto& pair:glyphIds){
   font.draw(pair.first+"\r\n",2,1);GdiFlush();
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
 std::vector<uint32_t> draw(std::string_view frame){
  std::fill(cellData.begin(),cellData.end(),0);uint32_t y=0;
  for(const auto& line:lines(frame)){
   if(y>=height)break;uint32_t x=0;
   for(size_t i=0;i<line.size()&&x<width;){
    uint32_t len=leadByte((uint8_t)line[i])&&i+1<line.size()?2:1;
    if(x+len>width)break;
    uint32_t g=glyphIds.at(line.substr(i,len));
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
  D3D11_MAPPED_SUBRESOURCE m={};checked(gpu.context->Map(staging.Get(),0,D3D11_MAP_READ,0,&m),"raster map");
  std::vector<uint32_t> result(total);std::memcpy(result.data(),m.pData,total*4);gpu.context->Unmap(staging.Get(),0);return result;
 }
};
int main(int argc,char** argv){
 try{
  if(argc==2&&std::string(argv[1])=="--probe"){NativeDirectCompute gpu;std::cout<<"DIRECTCOMPUTE_RASTER "<<gpu.gpuName<<"\n";return 0;}
  _setmode(_fileno(stdout),_O_BINARY);const auto a=args(argc,argv);const TSL t(a.input);GpuRaster raster(t,a);
  std::cerr<<"RASTER_BACKEND DirectCompute "<<raster.gpu.gpuName<<"\n";
  const int frames=int((int64_t(t.durationTicks)*a.fps+59)/60);int last=-1;std::vector<uint32_t> image;
  for(int i=0;i<frames;i++){
   int tick=int(int64_t(i)*60/a.fps),n=std::max(0,int(std::upper_bound(t.ticks.begin(),t.ticks.end(),tick)-t.ticks.begin())-1);
   if(n!=last){image=raster.draw(t.frame(n));last=n;}
   std::cout.write((char*)image.data(),raster.byteCount);if(!std::cout)throw std::runtime_error("video pipe closed");
   if((i+1)%24==0||i+1==frames)std::cerr<<"RENDER "<<i+1<<"/"<<frames<<"\n";
  }return 0;
 }catch(const std::exception& e){std::cerr<<"GPU_RENDER_ERROR "<<e.what()<<"\n";return 1;}
}
