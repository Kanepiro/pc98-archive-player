#pragma once
#include <memory>
#include <dxgi1_4.h>
// Only fullgpu_layout includes this transport. Other modes keep protocol v1.
struct LayoutRequest {
 std::unique_ptr<Payload> value;
 bool extended=false,initial=false,resident=false,reusePrevious=false;
 uint32_t session=0,sequence=0;
 template<class T> static void into(std::vector<T>& a,size_t count){
  if(count>a.size())throw std::runtime_error("resident input bounds");
  std::cin.read((char*)a.data(),std::streamsize(count*4));
  if(!std::cin)throw std::runtime_error("resident truncated input");
 }
 void read(){
  if(std::cin.peek()==0x4d){
   value=std::make_unique<Payload>();extended=false;initial=true;resident=false;reusePrevious=false;session=0;return;
  }
  if(read32()!=0x524c4754||read32()!=1)throw std::runtime_error("resident protocol");
  const auto op=read32(),token=read32(),seq=read32(),old=read32(),cut=read32(),faces=read32();
  if(op<1||op>4||!token||old>1||cut>1||faces>8)throw std::runtime_error("resident header");
  if(op==2||op==4){
   if(!resident||!value||session!=token||seq!=sequence+1)throw std::runtime_error("resident session/order");
   value->hasOld=old;value->cut=cut;value->F=faces;
   into(value->target,value->n);into(value->importance,value->n);into(value->dist,value->n);
   into(value->gray,value->n);
   if(op==2){into(value->oldGray,value->n);into(value->oldIndex,value->cells);}
   std::fill(value->face.begin(),value->face.end(),0);into(value->face,faces*4);
  }else{
   value=std::make_unique<Payload>();
   if(value->hasOld!=int(old)||value->cut!=int(cut)||value->F!=int(faces))throw std::runtime_error("resident header mismatch");
   value->face.resize(32,0);
  }
  extended=true;initial=op==1||op==3;resident=op!=3;reusePrevious=op==4;session=token;sequence=seq;
 }
};
