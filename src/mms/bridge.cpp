#include "engine.hpp"
#include <emscripten/emscripten.h>
#include <memory>
#include <deque>
struct Frame{double time;int w,h;std::vector<uint32_t> rgba;};
static std::unique_ptr<mm::Engine> engine;
static std::deque<Frame> frames;
static std::array<bool,256> keys{};
static std::vector<int16_t> audio(960);
static std::string failure;
static uint64_t produced=0;
extern "C" {
EMSCRIPTEN_KEEPALIVE int movie_open(const uint8_t* bytes,int size){
 try{
  if(size<0||size>128*1024*1024)throw std::runtime_error("Input exceeds 128 MiB");
  engine.reset();frames.clear();keys.fill(false);failure.clear();produced=0;
  engine=std::make_unique<mm::Engine>(mm::load(mm::Bytes(bytes,bytes+size)));
  engine->minimumFrameInterval=1.0/120;
  engine->key=[](int k){if(k==-1){for(bool b:keys)if(b)return true;return false;}return k>=0&&k<256&&keys[k];};
  engine->frame=[](double t,const std::vector<uint32_t>&rgb,int w,int h){
   if(frames.size()>=64)throw std::runtime_error("Video consumer did not drain frames");
   Frame f{t,w,h,std::vector<uint32_t>(rgb.size())};
   for(size_t i=0;i<rgb.size();i++){auto c=rgb[i];f.rgba[i]=0xff000000|((c&255)<<16)|(c&0xff00)|((c>>16)&255);}
   frames.push_back(std::move(f));
  };
  return 1;
 }catch(const std::exception&e){failure=e.what();return 0;}
}
EMSCRIPTEN_KEEPALIVE const char* movie_error(){return failure.c_str();}
EMSCRIPTEN_KEEPALIVE int movie_render(int count,int rate){
 try{
  if(!engine||count<1||count>4096||rate<8000||rate>192000)throw std::runtime_error("Invalid render request");
  audio.resize(count);engine->renderAudio(audio.data(),count,rate,produced);produced+=count;
  if(!engine->error.empty())throw std::runtime_error(engine->error);
  return int(reinterpret_cast<uintptr_t>(audio.data()));
 }catch(const std::exception&e){failure=e.what();return 0;}
}
EMSCRIPTEN_KEEPALIVE int movie_ended(){return !engine||engine->ended;}
EMSCRIPTEN_KEEPALIVE int movie_frames(){return frames.size();}
EMSCRIPTEN_KEEPALIVE int movie_frame_width(){return frames.empty()?0:frames.front().w;}
EMSCRIPTEN_KEEPALIVE int movie_frame_height(){return frames.empty()?0:frames.front().h;}
EMSCRIPTEN_KEEPALIVE double movie_frame_time(){return frames.empty()?0:frames.front().time;}
EMSCRIPTEN_KEEPALIVE const uint32_t* movie_frame_data(){return frames.empty()?nullptr:frames.front().rgba.data();}
EMSCRIPTEN_KEEPALIVE void movie_frame_pop(){if(!frames.empty())frames.pop_front();}
EMSCRIPTEN_KEEPALIVE void movie_key(int key,int down){if(key>=0&&key<256)keys[key]=down!=0;}
EMSCRIPTEN_KEEPALIVE double movie_instructions(){return engine?double(engine->instructions):0;}
EMSCRIPTEN_KEEPALIVE double movie_audio_starts(){return engine?double(engine->audioStarts):0;}
EMSCRIPTEN_KEEPALIVE void movie_close(){engine.reset();frames.clear();keys.fill(false);}
}
