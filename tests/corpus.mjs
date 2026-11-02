import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {decodeMAG} from '../public/mag.js';
import {parseTSL,tslFrameAt} from '../public/tsl.js';
import createCore from '../public/mms-core.mjs';
async function scan(root,ext){const result=[];for(const e of await readdir(root,{withFileTypes:true})){const path=join(root,e.name);if(e.isDirectory())result.push(...await scan(path,ext));else if(e.name.toLowerCase().endsWith(ext))result.push(path);}return result.sort();}
const root=process.env.CORPUS_ROOT||'reference',mmsRoot=process.env.MMS_ROOT||'../mmasl_player_20261102/reference/MMS';
const out=[],wasm=await createCore({wasmBinary:await readFile('public/mms-core.wasm')});
for(const kind of ['MAG','TSL','MMS']){
 const paths=await scan(kind==='MMS'?mmsRoot:join(root,kind==='TSL'?'TASL':'MAG'),'.'+kind.toLowerCase());
 for(const path of paths){
  const b=await readFile(path),r={file:basename(path),kind,sha256:createHash('sha256').update(b).digest('hex')};
  try{
   if(kind==='MAG'){const im=decodeMAG(b);Object.assign(r,{width:im.width,height:im.height,colors:im.colors,rgbaHash:createHash('sha256').update(im.rgba).digest('hex'),decode:'pass',visualReference:'not verified'});}
   else if(kind==='TSL'){const d=parseTSL(new TextDecoder('shift_jis').decode(b));Object.assign(r,{frames:d.frames.length,steps:d.schedule.length,duration:d.duration,finalFrame:tslFrameAt(d,d.duration),parse:'pass',visualReference:'not verified'});}
   else{
    const p=wasm._malloc(b.length);wasm.HEAPU8.set(b,p);const ok=wasm._movie_open(p,b.length);wasm._free(p);
    if(!ok)throw Error(wasm.UTF8ToString(wasm._movie_error()));
    const seconds=Number(process.env.MMS_SECONDS||5),hash=createHash('sha256'),audioHash=createHash('sha256');let frames=0,nonzero=0,samples=0;
    while(samples<48000*seconds&&!wasm._movie_ended()){
     const ptr=wasm._movie_render(960,48000);if(!ptr)throw Error(wasm.UTF8ToString(wasm._movie_error()));
     const pcm=wasm.HEAP16.subarray(ptr>>1,(ptr>>1)+960);for(const x of pcm)if(x)nonzero++;
     audioHash.update(wasm.HEAPU8.subarray(ptr,ptr+1920));samples+=960;
     while(wasm._movie_frames()){const n=wasm._movie_frame_width()*wasm._movie_frame_height()*4,fp=wasm._movie_frame_data();hash.update(wasm.HEAPU8.subarray(fp,fp+n));frames++;wasm._movie_frame_pop();}
    }
    Object.assign(r,{decode:'pass',renderSeconds:samples/48000,frames,nonzeroSamples:nonzero,instructions:wasm._movie_instructions(),audioStarts:wasm._movie_audio_starts(),ended:!!wasm._movie_ended(),videoHash:hash.digest('hex'),audioHash:audioHash.digest('hex'),audiovisualSync:'not verified'});
    wasm._movie_close();
   }
  }catch(e){r.error=e.message;process.exitCode=1;}
  out.push(r);console.log(JSON.stringify(r));
 }
}
await mkdir('verification',{recursive:true});await writeFile('verification/corpus-results.json',JSON.stringify({environment:'Linux x64 / Node / Emscripten 3.1.69',scope:'MAG decode, TSL schedules, MMS first '+(process.env.MMS_SECONDS||5)+' seconds, default path; not a complete playback certification',results:out},null,2)+'\n');
