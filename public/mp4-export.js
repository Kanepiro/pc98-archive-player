// Direct, deterministic MP4 export from decoded MAG/TSL/MMS data.
// Export is independent of screen capture and of live AudioWorklet playback.
import {Output, BufferTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource, AudioSampleSink, AudioSampleSource, EncodedAudioPacketSource, EncodedPacketSink, Input, ALL_FORMATS, BlobSource, Quality, canEncodeAudio} from 'mediabunny';
import {registerAacEncoder} from '@mediabunny/aac-encoder';
import {drawTSL, tslFrameAt} from './tsl.js';

const MAX_SECONDS = 300;
const AUDIO_RATE = 48000;
// MAG and MMS retain their existing 720p export limit.
const MAX_SIDE = {width:1280, height:720};
// TSL text needs enough pixels per glyph; keep its native raster up to Full HD.
const TSL_FULL_HD = {portrait:{width:1080,height:1920},landscape:{width:1920,height:1080}};
const TSL_HD = {portrait:{width:720,height:1280},landscape:MAX_SIDE};
const MAG_SECONDS = 5;

function aborted(signal) {
  if (signal?.aborted) throw new DOMException('MP4書き出しを中止しました', 'AbortError');
}
function dimensions(width, height, limits = MAX_SIDE, upscale = false) {
  if (!(width > 0 && height > 0)) throw Error('映像サイズが不正です');
  const scale = Math.min(upscale ? Infinity : 1, limits.width / width, limits.height / height);
  // H.264 encoders expect even dimensions.
  return {width:Math.max(16,Math.round(width*scale/2)*2),
    height:Math.max(16,Math.round(height*scale/2)*2)};
}
function newCanvas(width, height, limits = MAX_SIDE) {
  const canvas = document.createElement('canvas');
  Object.assign(canvas, dimensions(width,height,limits));
  return canvas;
}
// Order highest-quality TSL output first, with portrait-preserving fallbacks.
export function tslExportCandidates(width, height) {
  const orientation = height >= width ? 'portrait' : 'landscape';
  const limits = [TSL_FULL_HD[orientation], TSL_HD[orientation], MAX_SIDE];
  // Full-HD redraw also applies to near-16:9 landscape text; this is
  // the direct, unrotated video-to-TSL landscape path. Keep legacy
  // landscape formats at their previous native raster sizes.
  const wide16x9=orientation==='landscape'&&Math.abs(width/height/(16/9)-1)<.02;
  const sizes = limits.map(limit=>dimensions(width,height,limit,orientation==='portrait'||wide16x9));
  return sizes.filter((size,i)=>sizes.findIndex(other=>other.width===size.width&&other.height===size.height)===i);
}
async function checkCodec(canvas, withAudio) {
  if (typeof globalThis.VideoEncoder?.isConfigSupported !== 'function') {
    throw Error('このブラウザーはMP4出力に必要なWebCodecsに対応していません');
  }
  // H.264 Level 3.1 cannot encode 1080x1920 at 30fps; Level 4.0 can.
  const mbPerFrame=Math.ceil(canvas.width/16)*Math.ceil(canvas.height/16);
  const codec=mbPerFrame>3600||mbPerFrame*30>108000?'avc1.42E028':'avc1.42E01F';
  const video = await VideoEncoder.isConfigSupported({
    codec,width:canvas.width,height:canvas.height,
    bitrate:2_000_000,framerate:30,
  });
  if (!video.supported) throw Error('この端末のH.264動画エンコーダーは利用できません');
  if (withAudio && !(await canEncodeAudio('aac'))) {
    // Fallback to bundled LGPL FFmpeg AAC-LC WASM encoder on Chrome without native AAC encoding.
    registerAacEncoder();
    if (!(await canEncodeAudio('aac'))) throw Error('この端末ではAAC音声を書き出せません');
  }
}
async function newOutput(canvas, withAudio, audioMode='buffer') {
  await checkCodec(canvas, withAudio && audioMode!=='copy');
  const output = new Output({format:new Mp4OutputFormat(), target:new BufferTarget()});
  const video = new CanvasSource(canvas, {codec:'avc',quality:new Quality('very-high'),keyFrameInterval:2});
  output.addVideoTrack(video);
  let audio = null;
  if (withAudio) {
    audio = audioMode==='copy'?new EncodedAudioPacketSource('aac'):
      audioMode==='sample'?new AudioSampleSource({codec:'aac',quality:new Quality('medium')}):
      new AudioBufferSource({codec:'aac',quality:new Quality('medium')});
    output.addAudioTrack(audio);
  }
  await output.start();
  return {output,video,audio};
}
function result(output) {
  const bytes = output.target.buffer;
  if (!bytes || !bytes.byteLength) throw Error('MP4ファイルを生成できませんでした');
  return new Blob([bytes],{type:'video/mp4'});
}
function drawFrame(canvas,frame) {
  const source = document.createElement('canvas');
  source.width=frame.width;source.height=frame.height;
  const ctx=source.getContext('2d',{alpha:false});
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels),frame.width,frame.height),0,0);
  const dst=canvas.getContext('2d',{alpha:false});
  dst.fillStyle='#05080b';dst.fillRect(0,0,canvas.width,canvas.height);
  dst.imageSmoothingEnabled=false;
  const scale=Math.min(canvas.width/frame.width,canvas.height/frame.height);
  const w=Math.round(frame.width*scale),h=Math.round(frame.height*scale);
  dst.drawImage(source,Math.floor((canvas.width-w)/2),Math.floor((canvas.height-h)/2),w,h);
}
async function exportMag(current, signal, onProgress) {
  const data=current.data,canvas=newCanvas(data.width,data.height*data.pixelAspect);
  const {output,video}=await newOutput(canvas,false);
  aborted(signal);
  const dst=canvas.getContext('2d',{alpha:false});
  const source=document.createElement('canvas');
  source.width=data.width;source.height=data.height;
  source.getContext('2d',{alpha:false}).putImageData(new ImageData(data.rgba,data.width,data.height),0,0);
  dst.imageSmoothingEnabled=false;
  dst.drawImage(source,0,0,canvas.width,canvas.height);
  // Two frames improve compatibility with players that ignore long still-frame duration.
  await video.add(0,MAG_SECONDS-1/30);
  await video.add(MAG_SECONDS-1/30,1/30);
  aborted(signal);
  video.close();
  await output.finalize();
  onProgress?.(MAG_SECONDS, MAG_SECONDS);
  return result(output);
}
async function exportTsl(current, signal, onProgress, onResolution, tslAppearance={}, maxPixels=Infinity, sourceAudioFile=null, onStage=()=>{}) {
  const data=current.data;
  if(data.duration>MAX_SECONDS)throw Error('この作品は5分を超えるためMP4書き出しの対象外です');
  let audioInput=null,audioTrack=null,audioMode=null;
  try {
    if(sourceAudioFile){
      onStage('audio-reading');
      audioInput=new Input({source:new BlobSource(sourceAudioFile),formats:ALL_FORMATS});
      if(!(await audioInput.canRead()))throw Error('元動画の音声を読み取れません');
      audioTrack=await audioInput.getPrimaryAudioTrack();
      if(!audioTrack)throw Error('元動画に音声トラックがありません');
      const codec=await audioTrack.getCodec();
      audioMode=codec==='aac'?'copy':'sample';
      if(audioMode==='sample'&&!(await audioTrack.canDecode()))
        throw Error('元動画の音声コーデックをデコードできません');
    }
    const nativeWidth=data.width*(data.native16?8:12),nativeHeight=data.height*(data.native16?16:24);
    const near16x9=data.native16&&Math.abs(nativeWidth/nativeHeight/(16/9)-1)<.02;
    // 240x67 native PC-98 columns/rows yield 1920x1072. Preserve every
    // 16x16 pixel and center it with 4 black rows above/below in 1080p.
    const sizes=near16x9
      ?[{width:1920,height:1080},{width:1280,height:720},...tslExportCandidates(nativeWidth,nativeHeight)]
      :tslExportCandidates(nativeWidth,nativeHeight);
    let canvas,output,video,audio,lastError;
    for(const size of sizes.filter(s=>s.width*s.height<=maxPixels)){
      aborted(signal);
      const candidate=typeof document==='undefined'
        ?new OffscreenCanvas(size.width,size.height):document.createElement('canvas');
      Object.assign(candidate,size);
      try{
        ({output,video,audio}=await newOutput(candidate,!!audioTrack,audioMode));
        canvas=candidate;break;
      }catch(e){lastError=e;}
    }
    if(!canvas)throw lastError||Error('TSLのMP4書き出しに対応する解像度がありません');
    onResolution?.(canvas.width,canvas.height);
    const render={cellWidth:canvas.width/data.width,cellHeight:canvas.height/data.height,
      fontSize:canvas.height/data.height*20/24,...tslAppearance};
    // For 16-dot material, rasterize glyphs once at native 8x16 / 16x16.
    // Then copy pixels with nearest-neighbor sampling (no vector reflow / smoothing).
    const dotCanvas=data.native16?new OffscreenCanvas(nativeWidth,nativeHeight):null;
    const dotContext=data.native16?canvas.getContext('2d',{alpha:false}):null;
    const scale=data.native16?Math.min(canvas.width/nativeWidth,canvas.height/nativeHeight):1;
    const dotWidth=Math.round(nativeWidth*scale),dotHeight=Math.round(nativeHeight*scale);
    async function videoPass(){
      let frames=0;
      for(let i=0;i<data.schedule.length;i++){
        aborted(signal);
        const currentFrame=data.schedule[i],next=data.schedule[i+1];
        const start=currentFrame.start,end=next?next.start:data.duration;
        if(end<=start)continue;
        if(dotCanvas){
          drawTSL(dotCanvas,data,currentFrame.frame,tslAppearance);
          dotContext.imageSmoothingEnabled=false;
          dotContext.fillStyle=tslAppearance.background||'#080d12';
          dotContext.fillRect(0,0,canvas.width,canvas.height);
          dotContext.drawImage(dotCanvas,Math.floor((canvas.width-dotWidth)/2),Math.floor((canvas.height-dotHeight)/2),dotWidth,dotHeight);
        }else drawTSL(canvas,data,currentFrame.frame,render);
        await video.add(start,end-start,{keyFrame:frames%60===0});
        frames++;onProgress?.(end,data.duration);
      }
      if(!frames)throw Error('TSLに書き出せる映像がありません');
      video.close();
    }
    async function audioPass(){
      if(!audioTrack)return;
      onStage('audio-encoding');
      let added=0;
      if(audioMode==='copy'){
        const sink=new EncodedPacketSink(audioTrack),config=await audioTrack.getDecoderConfig();
        const meta={decoderConfig:config??undefined};
        for await(const packet of sink.packets()){
          aborted(signal);
          if(packet.timestamp>=data.duration)break;
          // MP4 cannot represent negative sample timestamps. Skip an AAC encoder pre-roll packet.
          if(packet.timestamp<0 || packet.timestamp+packet.duration<=0)continue;
          await audio.add(packet,meta);
          added++;
        }
      }else{
        const sink=new AudioSampleSink(audioTrack);
        for await(const sample of sink.samples()){
          aborted(signal);
          try{
            if(sample.timestamp>=data.duration)break;
            const start=Math.max(0,Math.ceil(-sample.timestamp*sample.sampleRate));
            const end=Math.min(sample.numberOfFrames,Math.floor((data.duration-sample.timestamp)*sample.sampleRate));
            if(end<=start)continue;
            const clipped=(start||end!==sample.numberOfFrames)?sample.trim(start,end):sample;
            try{await audio.add(clipped);added++;}finally{if(clipped!==sample)clipped.close();}
          }finally{sample.close();}
        }
      }
      if(!added)throw Error('元動画の音声データが見つかりません');
      audio.close();
    }
    aborted(signal);
    // Feed both tracks concurrently so a muxer cannot deadlock on backpressure.
    await Promise.all([videoPass(),audioPass()]);
    aborted(signal);
    await output.finalize();
    return result(output);
  }finally{audioInput?.dispose();}
}
function mmsWorker(bytes) {
  const worker=new Worker('/mms-export-worker.js',{type:'module'});
  let seq=0;
  let pending=null;
  worker.onerror=e=>{
    pending?.reject(Error(e.message||'MMS変換ワーカーのエラー'));
    pending=null;
  };
  worker.onmessage=({data:d})=>{
    if (!pending || pending.id!==d.id) return;
    const entry=pending;pending=null;
    if (d.type==='error') entry.reject(Error(d.message));else entry.resolve(d);
  };
  async function ask(type,data={},transfer=[]) {
    if(pending) throw Error('MMSワーカーへの要求が重複しました');
    const id=++seq;
    return new Promise((resolve,reject)=>{
      pending={id,resolve,reject};
      worker.postMessage({id,type,...data},transfer);
    });
  }
  return {worker,ask,open:()=>ask('open',{bytes},[bytes]),next:()=>ask('next')};
}
async function exportMms(current, signal, onProgress) {
  // Preflight the timeline with the exact same deterministic MMS renderer.
  // Some scripts wait for keyboard input after their last visual/audio sample.
  async function scanDuration() {
    const renderer=mmsWorker(current.bytes.slice(0));
    try {
      await renderer.open();
      while(true) {
        aborted(signal);
        const chunk=await renderer.next();
        if(chunk.seconds>MAX_SECONDS)throw Error('MMSの再生が5分を超えました。自動終了できない作品です');
        if(chunk.ended){
          if(!(chunk.endTime>0))throw Error('MMSの終了時刻を判定できませんでした');
          return chunk.endTime;
        }
      }
    } finally {renderer.worker.terminate();}
  }
  const duration=await scanDuration();
  const canvas=newCanvas(640,400);
  const {output,video,audio}=await newOutput(canvas,true);
  const totalAudioSamples=Math.round(duration*AUDIO_RATE);
  const dst=canvas.getContext('2d',{alpha:false});
  dst.fillStyle='#05080b';dst.fillRect(0,0,canvas.width,canvas.height);
  // Video and audio MUST be fed independently and concurrently.
  // Awaiting audio.add() before video.add() can deadlock a muxer on sparse MMS frames.
  async function videoPass() {
    const renderer=mmsWorker(current.bytes.slice(0));
    let pendingFrame=null;
    let encodedFrames=0;
    try {
      await renderer.open();
      while(true) {
        aborted(signal);
        const chunk=await renderer.next();
        for(const frame of chunk.frames) {
          const t=Math.max(0,Math.min(chunk.seconds,frame.time));
          if(t>duration+1e-7)continue;
          if(pendingFrame&&t>pendingFrame.time+1e-7){
            drawFrame(canvas,pendingFrame);
            await video.add(pendingFrame.time,t-pendingFrame.time);
            encodedFrames++;
          }
          if(!pendingFrame&&t>0){
            await video.add(0,t);
            encodedFrames++;
          }
          pendingFrame={...frame,time:t};
        }
        if(chunk.ended||chunk.seconds>=duration)break;
      }
      aborted(signal);
      if(pendingFrame){
        drawFrame(canvas,pendingFrame);
        await video.add(pendingFrame.time,Math.max(1/60,duration-pendingFrame.time));
      }else{
        await video.add(0,Math.max(1/60,duration));
      }
      encodedFrames++;
      if(!encodedFrames)throw Error('MMSの映像フレームがありません');
      video.close();
    }finally{renderer.worker.terminate();}
  }
  async function audioPass() {
    const renderer=mmsWorker(current.bytes.slice(0));
    let sent=0;
    try {
      await renderer.open();
      while(sent<totalAudioSamples){
        aborted(signal);
        const chunk=await renderer.next();
        const pcm=new Float32Array(chunk.pcm);
        const take=Math.min(pcm.length,totalAudioSamples-sent);
        const buffer=new AudioBuffer({length:take,numberOfChannels:1,sampleRate:AUDIO_RATE});
        buffer.copyToChannel(take===pcm.length?pcm:pcm.subarray(0,take),0);
        await audio.add(buffer);
        sent+=take;
        onProgress?.(sent/AUDIO_RATE,duration);
        if(chunk.ended&&sent<totalAudioSamples)throw Error('MMSの最後の音声が不足しています');
      }
      audio.close();
    }finally{renderer.worker.terminate();}
  }
  aborted(signal);
  await Promise.all([videoPass(),audioPass()]);
  aborted(signal);
  await output.finalize();
  return result(output);
}

export async function exportMP4(current,{signal,onProgress,onResolution,tslAppearance,tslMaxPixels=Infinity,sourceAudioFile,onStage}={}) {
  if (!current) throw Error('作品を選択してください');
  aborted(signal);
  if(current.kind==='MAG') return exportMag(current,signal,onProgress);
  if(current.kind==='TSL') return exportTsl(current,signal,onProgress,onResolution,tslAppearance,tslMaxPixels,sourceAudioFile,onStage);
  if(current.kind==='MMS') return exportMms(current,signal,onProgress);
  throw Error('この形式のMP4書き出しは未対応です');
}
export function mp4Name(filename) {
  return filename.replace(/\.(mag|tsl|mms)$/i,'')+'.mp4';
}
