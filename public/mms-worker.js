import createCore from './mms-core.mjs';
let core, transport, rate=48000, block=960, ended=false, produced=0, generation=0;
const ready=createCore().then(m=>core=m);
function error(e){ended=true;postMessage({type:'error',message:String(e.message||e)});transport?.postMessage({type:'abort'});}
function drainFrames(){
 while(core._movie_frames()){
  const width=core._movie_frame_width(),height=core._movie_frame_height(),time=core._movie_frame_time();
  const ptr=core._movie_frame_data();
  const pixels=core.HEAPU8.slice(ptr,ptr+width*height*4);
  core._movie_frame_pop();postMessage({type:'frame',width,height,time,pixels:pixels.buffer},[pixels.buffer]);
 }
}
function produce(){
 if(ended)return;
 try{
  const ptr=core._movie_render(block,rate);
  if(!ptr)throw Error(core.UTF8ToString(core._movie_error()));
  const pcm=new Float32Array(block);
  const src=core.HEAP16.subarray(ptr>>1,(ptr>>1)+block);
  for(let i=0;i<block;i++)pcm[i]=src[i]/32768;
  produced+=block;drainFrames();
  transport.postMessage({type:'pcm',pcm},[pcm.buffer]);
  if(core._movie_ended()){
   ended=true;transport.postMessage({type:'end'});
   postMessage({type:'generated-end',seconds:produced/rate,instructions:core._movie_instructions(),audioStarts:core._movie_audio_starts()});
  }
 }catch(e){error(e);}
}
self.onmessage=async ({data:d})=>{
 try{
  if(d.type==='load'){
   const id=++generation;await ready;if(id!==generation)return;
   rate=d.rate;block=Math.round(rate*.02);ended=false;produced=0;
   transport=d.port;transport.onmessage=({data})=>{if(data.type==='need')produce();};transport.start();
   const bytes=new Uint8Array(d.bytes),p=core._malloc(bytes.length);
   if(!p)throw Error('メモリを確保できません');
   core.HEAPU8.set(bytes,p);
   let ok;try{ok=core._movie_open(p,bytes.length);}finally{core._free(p);}
   if(!ok)throw Error(core.UTF8ToString(core._movie_error()));
   for(let i=0;i<12&&!ended;i++)produce();
   transport.postMessage({type:'start'});postMessage({type:'ready'});
  }else if(d.type==='key'&&core)core._movie_key(d.key,d.down?1:0);
 }catch(e){error(e);}
};
