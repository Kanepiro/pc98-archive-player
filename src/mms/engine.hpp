#pragma once
#include "core.hpp"
#include <cctype>
#include <random>
namespace mm {
struct Expression{char kind='n';int value=0,indirect=0,mul=1,add=0;std::string keys;};
struct Instruction{std::string op,cmp;std::vector<Expression> args;int match=-1,alternate=-1;size_t offset=0;};
struct Program{
 std::vector<Instruction> code;std::map<int,int> labels;std::set<std::string> used;
};
class Parser{
 const std::string& s;size_t pos=0;
 char peek(){return pos<s.size()?s[pos]:0;}
 int integer(){size_t start=pos;if(peek()=='-'||peek()=='+')pos++;while(std::isdigit((unsigned char)peek()))pos++;require(pos>start&&s.substr(start,pos-start)!="-"&&s.substr(start,pos-start)!="+","Expected integer at "+std::to_string(start));return std::stoi(s.substr(start,pos-start));}
 void spaces(){while(std::isspace((unsigned char)peek())||peek()==':'||peek()==';'){if(peek()==';'){while(peek()&&peek()!='\n')pos++;}else pos++;}}
 bool expressionStart(){return std::isdigit((unsigned char)peek())||std::strchr("@-+RKOTPF",peek())&&peek();}
 Expression expression(){
  Expression e;char c=peek();
  if(c=='@'){e.kind='r';pos++;if(peek()=='@'){e.indirect=1;pos++;}e.value=integer();}
  else if(c=='R'||c=='F'){e.kind=c;pos++;e.value=integer();}
  else if(c=='T'||c=='P'){e.kind=c;pos++;}
  else if(c=='O'){
   e.kind='O';pos++;if(peek()=='2'){e.kind='o';pos++;}
   require(std::isalpha((unsigned char)peek()),"Bad option expression");e.keys+=s[pos++];
   if(e.kind=='O'&&std::islower((unsigned char)peek()))e.keys+=s[pos++];
  }else if(c=='K'){
   e.kind='K';pos++;while(std::isalnum((unsigned char)peek()))e.keys+=s[pos++];
   require(!e.keys.empty(),"Empty key expression");
  }else{e.kind='n';e.value=integer();}
  if(e.kind=='r'){
   if(peek()=='*'){pos++;e.mul=integer();}
   if(peek()=='+'||peek()=='-')e.add=integer();
  }
  return e;
 }
 std::string comparison(){std::string c;if(std::strchr("=!<>",peek())&&peek()){c+=s[pos++];if(peek()=='=')c+=s[pos++];}return c;}
public:
 explicit Parser(const std::string& s):s(s){}
 Program parse(){
  Program p;std::vector<int> loops;struct IfGroup{int branch;std::vector<int> exits;};std::vector<IfGroup> ifs;
  while(true){
   spaces();if(!peek()||peek()==26)break;
   Instruction in;in.offset=pos;char c=peek();
   if(c=='\\'){in.op="\\";pos++;p.code.push_back(in);p.used.insert(in.op);break;}
   if(c=='['||c==']'||c=='{'||c=='}'||c=='#'){in.op+=s[pos++];if(c=='['&&peek()=='l'){in.op="[l";pos++;}}
   else if(std::strchr("=+-*/%&|^",c)){in.op+=s[pos++];}
   else{while(std::islower((unsigned char)peek()))in.op+=s[pos++];require(!in.op.empty(),"Unrecognized MSC byte at "+std::to_string(pos));}
   if(in.op=="["||in.op=="]"||in.op=="{"||in.op=="jmp"||in.op=="call")in.cmp=comparison();
   if(in.op=="else"){spaces();require(peek()=='{',"else without opening brace");pos++;in.cmp=comparison();if(!in.cmp.empty())in.op="elif";}
   if(in.op!="}"&&expressionStart()){
    in.args.push_back(expression());
    while(peek()==','){pos++;if(expressionStart())in.args.push_back(expression());else in.args.push_back(Expression{});}
    if((in.op=="jmp"||in.op=="call")&&!in.cmp.empty()&&in.args.size()<3){spaces();require(expressionStart(),"Missing branch target");in.args.push_back(expression());}
   }
   int idx=int(p.code.size());
   if(in.op=="#"){require(in.args.size()==1&&in.args[0].kind=='n',"Nonconstant label");require(!p.labels.count(in.args[0].value),"Duplicate label");p.labels[in.args[0].value]=idx;}
   if(in.op=="["||in.op=="[l")loops.push_back(idx);
   if(in.op=="]"){require(!loops.empty(),"Unmatched ]");int b=loops.back();loops.pop_back();in.match=b;p.code[b].match=idx;}
   if(in.op=="{")ifs.push_back({idx,{}});
   if(in.op=="else"||in.op=="elif"){
    require(!ifs.empty(),"Unexpected else");p.code[ifs.back().branch].match=idx;ifs.back().branch=idx;
   }
   if(in.op=="}"){
    require(!ifs.empty(),"Unmatched }");size_t save=pos;spaces();bool more=s.compare(pos,4,"else")==0;pos=save;
    if(more){in.op="if_exit";ifs.back().exits.push_back(idx);}
    else {auto group=ifs.back();ifs.pop_back();p.code[group.branch].match=idx+1;for(int e:group.exits)p.code[e].match=idx+1;}
   }
   p.used.insert(in.op);p.code.push_back(std::move(in));
  }
  require(loops.empty()&&ifs.empty(),"Unclosed MSC control block");return p;
 }
};
struct Viewport{int x=0,y=0,w=320,h=200,sx=0,sy=0;};
struct Channel{int sound=-1,queued=-1;double pos=0;bool loop=false,queueLoop=false;};
class Engine{
public:
 Movie movie;Program program;Bytes vram=Bytes(640*600,0),screen=Bytes(640*480,0);
 std::array<int16_t,1024> regs{};
 std::array<std::array<std::array<int,3>,256>,2> buffers{};
 std::array<uint32_t,256> colors{};
 std::array<Viewport,8> views{};
 std::array<Channel,4> channels{};
 std::function<bool(int)> key=[](int){return false;};
 std::function<void(double,const std::vector<uint32_t>&,int,int)> frame;
 std::map<std::string,int> options;
 std::function<bool()> cancelled=[](){return false;};
 double minimumFrameInterval=0,lastFrameTime=-1e9;
 int width=320,height=200,ip=0,lastParameter=0,rate=16540;
 double now=0,timerBase=0,timerHz=60,waitUntil=0;
 int waitMask=0;bool ended=false;uint64_t instructions=0,frames=0,audioStarts=0,nonzeroSamples=0;
 std::string error;std::set<std::string> reached;
 std::vector<int> returns;std::map<int,int> counts;std::mt19937 rng{5489};
 explicit Engine(Movie m):movie(std::move(m)),program(Parser(movie.body).parse()){
  for(int i=1;i<8;i++)views[i].w=views[i].h=0;
 }
 int regIndex(const Expression&e){require(e.kind=='r',"Expected register destination");int n=e.value;require(n>=0&&n<1024,"Register index");if(e.indirect)n=regs[n];require(n>=0&&n<1024,"Indirect register index");return n;}
 int status(){int v=0;for(int i=0;i<4;i++)if(channels[i].sound>=0)v|=1<<i;return v;}
 int value(const Expression&e){
  int v=e.value;
  if(e.kind=='r')v=regs[regIndex(e)];
  else if(e.kind=='R'){require(v>0,"Invalid random range");v=int(rng()%v);}
  else if(e.kind=='T')v=int((now-timerBase)*timerHz+1e-7);
  else if(e.kind=='P')v=status();
  else if(e.kind=='O')v=options.count(e.keys)?1:0;
  else if(e.kind=='o')v=options.count(e.keys)?options[e.keys]:0;
  else if(e.kind=='F'){
   if(v==0)v=int(movie.pictures.size());else if(v==1)v=int(movie.sounds.size());else if(v==2)v=int(movie.palettes.size());else if(v>=3&&v<=6)v=1;else throw std::runtime_error("Unknown F capability");
  }else if(e.kind=='K'){
   v=0;int bit=0;
   for(size_t i=0;i<e.keys.size()&&bit<16;i++,bit++){
    char c=e.keys[i];int k=c;
    if(c=='R')k=13;else if(c=='S')k=32;else if(c=='T')k=9;else if(c=='B')k=8;else if(c=='A')k=-1;
    else if(c=='F'){require(i+1<e.keys.size()&&std::isdigit((unsigned char)e.keys[i+1]),"Function-key digit missing");k=112+(e.keys[++i]-'0');}
    else k=std::toupper((unsigned char)c);
    if(key(k))v|=1<<bit;
   }
  }
  return int(int16_t(int64_t(v)*e.mul+e.add));
 }
 bool condition(const Instruction&in){
  if(in.cmp.empty())return true;
  int a=in.args.empty()?0:value(in.args[0]),b=in.args.size()<2?0:value(in.args[1]);
  if(in.cmp=="="||in.cmp=="==")return a==b;if(in.cmp=="!"||in.cmp=="!=")return a!=b;
  if(in.cmp=="<")return a<b;if(in.cmp=="<=")return a<=b;if(in.cmp==">")return a>b;if(in.cmp==">=")return a>=b;
  throw std::runtime_error("Unknown comparison");
 }
 uint8_t pixel(int x,int y)const{if(y<0||y>=600)return 0;x=(x%640+640)%640;return vram[y*640+x];}
 void pixel(int x,int y,int c){if(y<0||y>=600)return;x=(x%640+640)%640;vram[y*640+x]=uint8_t(c);}
 bool dirty=false;
 void present(bool transfer=true){
  if(transfer)for(const auto&v:views)for(int y=0;y<v.h;y++)for(int x=0;x<v.w;x++){
   int dx=v.x+x,dy=v.y+y;if(dx>=0&&dy>=0&&dx<width&&dy<height)screen[dy*640+dx]=pixel(v.sx+x,v.sy+y);
  }
  dirty=true;
 }
 void flushFrame(){
  if(!dirty)return;
  if(!ended&&now-lastFrameTime+1e-9<minimumFrameInterval)return;
  dirty=false;lastFrameTime=now;
  std::vector<uint32_t> rgb(width*height);
  for(int y=0;y<height;y++)for(int x=0;x<width;x++)rgb[y*width+x]=colors[screen[y*640+x]];
  frames++;if(frame)frame(now,rgb,width,height);
 }
 void applyTone(int strength,int blend,int from=0,int to=255){
  require(from>=0&&to<=255&&from<=to,"Palette range");
  strength=std::clamp(strength,0,256);blend=std::clamp(blend,0,256);
  for(int i=from;i<=to;i++){
   uint32_t color=0;for(int k=0;k<3;k++){int v=(buffers[0][i][k]*(256-blend)+buffers[1][i][k]*blend)*strength/65536;color=(color<<8)|std::clamp(v,0,255);}colors[i]=color;
  }
 }
 void startSound(int index,int channel,bool loop,bool queue){
  require(index>=0&&index<int(movie.sounds.size())&&!movie.sounds[index].pcm.empty(),"Missing PCM "+std::to_string(index));
  if(queue){require(channel>=1&&channel<=4,"PCM queue channel");auto&c=channels[channel-1];if(c.sound>=0){c.queued=index;c.queueLoop=loop;}return;}
  if(channel==0){channel=1;for(int i=0;i<4;i++)if(channels[i].sound<0){channel=i+1;break;}else if(!channels[i].loop)channel=i+1;}
  require(channel>=1&&channel<=4,"PCM channel");auto&c=channels[channel-1];c.sound=index;c.pos=0;c.loop=loop;c.queued=-1;audioStarts++;
 }
 void branch(int target){auto it=program.labels.find(target);require(it!=program.labels.end(),"Missing label "+std::to_string(target));ip=it->second+1;}
 // Executes until a time/audio wait or a bounded cooperative slice.
 void pump(double time){
  now=time;if(ended||!error.empty()||cancelled())return;
  struct Flush{Engine*e;~Flush(){e->flushFrame();}}flush{this};
  if(now+1e-9<waitUntil||(waitMask&status()))return;waitMask=0;
  try{
   int budget=1000;
   while(budget-->0&&!ended){
    require(ip>=0&&ip<int(program.code.size()),"Scenario fell past end");
    const auto &in=program.code[ip];int current=ip++;instructions++;reached.insert(in.op);
    auto a=[&](int n){return n<int(in.args.size())?value(in.args[n]):0;};
    const auto&o=in.op;
    if(o=="\\"){ended=true;break;}
    if(o=="mmsret")continue; // MM_REF13: ignored outside an mmscall.
    if(o=="#"||o=="else")continue;
    if(o=="if_exit"){ip=in.match;continue;}
    if(o=="{"||o=="elif"){if(!condition(in))ip=in.match;continue;}
    if(o=="}")continue;
    if(o=="["||o=="[l"){
     if(o=="["&&!condition(in)){ip=in.match+1;continue;}
     if(o=="[l"){int n=a(0);if(n<=0){ip=in.match+1;continue;}counts[current]=n;}continue;
    }
    if(o=="]"){
     const auto&start=program.code[in.match];
     if(start.op=="[l"){auto it=counts.find(in.match);require(it!=counts.end(),"Jump into counted loop");if(--it->second>0)ip=in.match+1;else counts.erase(it);}
     else if(condition(in)){
      ip=in.match;bool idle=true;
      for(int k=in.match+1;k<current;k++){auto &o=program.code[k].op;if(o!="#"&&o!="{"&&o!="}"&&o!="elif"&&o!="else"&&o!="if_exit"&&o!="jmp"){idle=false;break;}}
      if(idle){waitUntil=now+1.0/timerHz;return;}
     }continue;
    }
    if(o=="jmp"||o=="call"){
     if(condition(in)){if(o=="call"){require(returns.size()<64,"Subroutine stack overflow");returns.push_back(ip);}branch(a(in.cmp.empty()?0:2));}continue;
    }
    if(o=="ret"){require(!returns.empty(),"Return stack underflow");ip=returns.back();returns.pop_back();continue;}
    if(o=="delret"){int n=a(0);require(n>=0&&n<=int(returns.size()),"delret range");returns.resize(returns.size()-n);continue;}
    if(o.size()==1&&std::strchr("=+-*/%&|^",o[0])!=nullptr){
     require(!in.args.empty(),"Missing assignment target");int n=regIndex(in.args[0]),v=a(1);int64_t r=regs[n];
     char c=o[0];if(c=='=')r=v;else if(c=='+')r+=v;else if(c=='-')r-=v;else if(c=='*')r*=v;
     else if(c=='/'||c=='%'){require(v!=0,"Division by zero");r=c=='/'?r/v:r%v;}
     else if(c=='&')r&=v;else if(c=='|')r|=v;else if(c=='^')r^=v;regs[n]=int16_t(r);continue;
    }
    if(o=="set"){require(!in.args.empty(),"set target");int n=regIndex(in.args[0]),count=a(1);require(count>=1&&count<=8&&n+count<=1024,"set range");for(int i=0;i<count;i++)regs[n+i]=int16_t(a(i+2));continue;}
    if(o=="tc"){timerBase=now;continue;}
    if(o=="count"){int hz=a(0);require(hz>0,"Invalid timer rate");double tick=(now-timerBase)*timerHz;timerHz=hz/100.0;timerBase=now-tick/timerHz;continue;}
    if(o=="t"||o=="disp"||o=="cdisp"){
     double target=timerBase+a(0)/timerHz;
     if(now+1e-9<target){ip=current;waitUntil=target;return;}
     if(o!="t"){
      if(o!="cdisp"||a(0)==0||now-target<1.0/timerHz)present();
      // Publish each display and return to the shared sample clock. This also
      // keeps unthrottled interactive loops from monopolizing the GUI thread.
      return;
     }continue;
    }
    if(o=="pwt"){waitMask=a(0)&15;if(waitMask&status())return;continue;}
    if(o=="pst"){int mask=a(0);for(int i=0;i<4;i++)if(mask&(1<<i))channels[i]=Channel{};continue;}
    if(o=="rate"){int r=a(0);require(r>0&&r<=65535,"Invalid PCM rate");rate=r;for(auto&c:channels)c=Channel{};continue;}
    if(o=="pcm"||o=="pcml"||o=="pch"||o=="pchl"){startSound(a(0),a(1),o=="pcml"||o=="pchl",o=="pch"||o=="pchl");continue;}
    if(o=="gmode"){int mode=a(0);require(mode>=0&&mode<=3,"Unsupported display mode");width=(mode&1)?640:320;height=mode==0?200:mode==1?400:mode==2?240:480;continue;}
    if(o=="wsize"){int n=a(4);require(n>=0&&n<8,"Window index");auto&v=views[n];v.x=a(0);v.y=a(1);v.w=a(2);v.h=a(3);require(v.w>=0&&v.w<=640&&v.h>=0&&v.h<=600,"Window size");continue;}
    if(o=="wmove"){int n=a(2);require(n>=0&&n<8,"Window index");views[n].sx=a(0);views[n].sy=a(1);continue;}
    if(o=="d"){int n=a(0);require(n>=0&&n<int(movie.pictures.size())&&!movie.pictures[n].data.empty(),"Missing picture "+std::to_string(n));lastParameter=drawNak(movie.pictures[n],vram,a(1),a(2));continue;}
    if(o=="box"){int x1=a(0),y1=a(1),x2=a(2),y2=a(3),c=a(4);if(x1>x2)std::swap(x1,x2);if(y1>y2)std::swap(y1,y2);require(x2-x1<=1280&&y2-y1<=1200,"Box range");for(int y=y1;y<=y2;y++)for(int x=x1;x<=x2;x++)pixel(x,y,c);continue;}
    if(o=="m"||o=="orm"||o=="zoom"){
     int sx=a(0),sy=a(1),dx=a(2),dy=a(3),sw=a(4),sh=a(5),dw=o=="zoom"?a(6):sw,dh=o=="zoom"?a(7):sh;
     require(std::abs(sw)<=1280&&std::abs(sh)<=1200&&std::abs(dw)<=1280&&std::abs(dh)<=1200,"Blit range");
     if(!dw||!dh||!sw||!sh)continue;
     Bytes temp(std::abs(dw)*std::abs(dh));
     for(int y=0;y<std::abs(dh);y++)for(int x=0;x<std::abs(dw);x++)temp[y*std::abs(dw)+x]=pixel(sx+x*sw/std::abs(dw),sy+y*sh/std::abs(dh));
     int shift=a(6)&7;
     for(int y=0;y<std::abs(dh);y++)for(int x=0;x<std::abs(dw);x++){
      int v=temp[y*std::abs(dw)+x],tx=dx+(dw<0?-x:x),ty=dy+(dh<0?-y:y);
      if(o=="zoom"&&a(8)==1&&v==a(9))continue;
      if(o=="orm")v=pixel(tx,ty)|(v<<shift);pixel(tx,ty,v);
     }continue;
    }
    if(o=="pset"||o=="psetw"){pixel(a(0),a(1),a(2));if(o=="psetw")pixel(a(0)+1,a(1),a(2)>>8);continue;}
    if(o=="point"||o=="pointw"){require(!in.args.empty(),"point target");int v=pixel(a(1),a(2));if(o=="pointw")v|=pixel(a(1)+1,a(2))<<8;regs[regIndex(in.args[0])]=int16_t(v);continue;}
    if(o=="pal"){
     int n=a(0),bank=a(1);require(n>=0&&n<int(movie.palettes.size())&&bank>=0&&bank<2,"Palette index");auto&p=movie.palettes[n];
     for(size_t j=0;j<p.rgb.size()/3;j++)for(int k=0;k<3;k++)buffers[bank][p.offset+j][k]=p.rgb[j*3+k];
     if(bank==0){applyTone(256,0,p.offset,p.offset+int(p.rgb.size()/3)-1);present(false);}continue;
    }
    if(o=="dpal"){int n=a(0),bank=a(4);require(n>=0&&n<256&&bank>=0&&bank<2,"dpal range");for(int k=0;k<3;k++)buffers[bank][n][k]=std::clamp(a(k+1),0,255);if(bank==0){applyTone(256,0,n,n);present(false);}continue;}
    if(o=="tone"||o=="ptone"){applyTone(a(0),a(1),o=="ptone"?a(2):0,o=="ptone"?a(3):255);present(false);continue;}
    if(o=="readpara"){int n=a(0);require(n>=0&&n<1024,"readpara register");regs[n]=int16_t(lastParameter);continue;}
    if(o=="getpara"){int n=a(1);require(n>=0&&n<int(movie.pictures.size()),"getpara picture");Bytes temp(640*600,0);regs[regIndex(in.args[0])]=int16_t(drawNak(movie.pictures[n],temp,0,0));continue;}
    throw std::runtime_error("Unsupported command "+o);
   }
  }catch(const std::exception&e){error=e.what();if(ip>0&&ip<=int(program.code.size()))error+=" (MSC offset "+std::to_string(program.code[ip-1].offset)+", command "+program.code[ip-1].op+")";ended=true;}
 }
 int16_t audioSample(int outputRate){
  int sum=0;
  for(auto&c:channels){
   if(c.sound<0)continue;
   auto*sound=&movie.sounds[c.sound];
   while(c.pos>=sound->pcm.size()){
    c.pos-=sound->pcm.size();
    if(c.queued>=0){c.sound=c.queued;c.queued=-1;c.loop=c.queueLoop;sound=&movie.sounds[c.sound];audioStarts++;}
    else if(!c.loop){c.sound=-1;break;}
   }
   if(c.sound<0)continue;
   sum+=sound->pcm[size_t(c.pos)];c.pos+=double(rate)/outputRate;
  }
  sum=std::clamp(sum,-32768,32767);if(sum)nonzeroSamples++;return int16_t(sum);
 }
 // Both MSC timer and PCM scheduling use exactly this one output-sample clock.
 void renderAudio(int16_t*out,int count,int outputRate,uint64_t start){
  for(int i=0;i<count;i++){if(i%48==0)pump(double(start+i)/outputRate);out[i]=audioSample(outputRate);}
 }
};
}
