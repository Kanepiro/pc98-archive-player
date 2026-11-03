// Direct, deterministic MP4 export from decoded MAG/TSL/MMS data.
// Export is independent of screen capture and of live AudioWorklet playback.
import {Output, BufferTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource, Quality, canEncodeAudio} from 'mediabunny';
import {registerAacEncoder} from '@mediabunny/aac-encoder';
import {drawTSL, tslFrameAt} from './tsl.js';

const MAX_SECONDS = 300;
const AUDIO_RATE = 48000;
const MAX_SIDE = {width:1280, height:720};
const MAG_SECONDS = 5;

function aborted(signal) {
  if (signal?.aborted) throw new DOMException('MP4書き出しを中止しました', 'AbortError');
}
function dimensions(width, height) {
  if (!(width > 0 && height > 0)) throw Error('映像サイズが不正です');
  const scale = Math.min(1, MAX_SIDE.width / width, MAX_SIDE.height / height);
  // H.264 encoders expect even dimensions.
  return {width:Math.max(16,Math.round(width*scale/2)*2),
    height:Math.max(16,Math.round(height*scale/2)*2)};
}
function newCanvas(width, height) {
  const canvas = document.createElement('canvas');
  Object.assign(canvas, dimensions(width,height));
  return canvas;
}
async function checkCodec(canvas, withAudio) {
  if (typeof globalThis.VideoEncoder?.isConfigSupported !== 'function') {
    throw Error('このブラウザーはMP4出力に必要なWebCodecsに対応していません');
  }
  const video = await VideoEncoder.isConfigSupported({
    codec:'avc1.42E01F',width:canvas.width,height:canvas.height,
    bitrate:2_000_000,framerate:30,
  });
  if (!video.supported) throw Error('この端末のH.264動画エンコーダーは利用できません');
  if (withAudio && !(await canEncodeAudio('aac'))) {
    // Fallback to bundled LGPL FFmpeg AAC-LC WASM encoder on Chrome without native AAC encoding.
    registerAacEncoder();
    if (!(await canEncodeAudio('aac'))) throw Error('この端末ではAAC音声を書き出せません');
  }
}
async function newOutput(canvas, withAudio) {
  await checkCodec(canvas, withAudio);
  const output = new Output({format:new Mp4OutputFormat(), target:new BufferTarget()});
  const video = new CanvasSource(canvas, {codec:'avc',quality:new Quality('very-high'),keyFrameInterval:2});
  output.addVideoTrack(video);
  let audio = null;
  if (withAudio) {
    audio = new AudioBufferSource({codec:'aac',quality:new Quality('high')});
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
async function exportTsl(current, signal, onProgress) {
  const data=current.data;
  if (data.duration > MAX_SECONDS) throw Error('この作品は5分を超えるためMP4書き出しの対象外です');
  const original=document.createElement('canvas');
  drawTSL(original,data,tslFrameAt(data,0));
  const canvas=newCanvas(original.width,original.height);
  const {output,video}=await newOutput(canvas,false);
  const dst=canvas.getContext('2d',{alpha:false});
  let frames=0;
  for (let i=0;i<data.schedule.length;i++) {
    aborted(signal);
    const currentFrame=data.schedule[i];
    const next=data.schedule[i+1];
    const start=currentFrame.start;
    const end=next ? next.start : data.duration;
    if (end<=start) continue;
    drawTSL(original,data,currentFrame.frame);
    dst.imageSmoothingEnabled=false;
    dst.drawImage(original,0,0,canvas.width,canvas.height);
    await video.add(start,end-start,{keyFrame:frames%60===0});
    frames++;
    onProgress?.(end,data.duration);
  }
  if (!frames) throw Error('TSLに書き出せる映像がありません');
  video.close();
  aborted(signal);
  await output.finalize();
  return result(output);
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
  const canvas=newCanvas(640,400);
  const {output,video,audio}=await newOutput(canvas,true);
  const renderer=mmsWorker(current.bytes.slice(0));
  let pendingFrame=null;
  let lastTime=0,frameCount=0;
  const dst=canvas.getContext('2d',{alpha:false});
  dst.fillStyle='#05080b';dst.fillRect(0,0,canvas.width,canvas.height);
  try {
    aborted(signal);
    await renderer.open();
    while (true) {
      aborted(signal);
      const chunk=await renderer.next();
      const pcm=new Float32Array(chunk.pcm);
      const buffer=new AudioBuffer({length:pcm.length,numberOfChannels:1,sampleRate:AUDIO_RATE});
      buffer.copyToChannel(pcm,0);
      await audio.add(buffer);
      lastTime=chunk.seconds;
      if (lastTime>MAX_SECONDS) throw Error('MMSが5分以内に終了しません。対話型・ループ作品の可能性があります');
      for (const frame of chunk.frames) {
        aborted(signal);
        const t=Math.max(0,Math.min(lastTime,frame.time));
        if (pendingFrame && t>pendingFrame.time+1e-7) {
          drawFrame(canvas,pendingFrame);
          await video.add(pendingFrame.time,t-pendingFrame.time);
          frameCount++;
        }
        if (!pendingFrame && t>0) {
          // Show a black screen before the first frame, as in the live player.
          await video.add(0,t);
          frameCount++;
        }
        pendingFrame={...frame,time:t};
      }
      onProgress?.(lastTime,null);
      if (chunk.ended) break;
    }
    aborted(signal);
    if(pendingFrame) {
      drawFrame(canvas,pendingFrame);
      await video.add(pendingFrame.time,Math.max(1/60,lastTime-pendingFrame.time));
      frameCount++;
    } else {
      await video.add(0,Math.max(1/60,lastTime));
      frameCount++;
    }
    if(!frameCount) throw Error('MMSの映像フレームを出力できませんでした');
    video.close();audio.close();
    await output.finalize();
    aborted(signal);
    return result(output);
  } finally {
    renderer.worker.terminate();
  }
}
export async function exportMP4(current,{signal,onProgress}={}) {
  if (!current) throw Error('作品を選択してください');
  aborted(signal);
  if(current.kind==='MAG') return exportMag(current,signal,onProgress);
  if(current.kind==='TSL') return exportTsl(current,signal,onProgress);
  if(current.kind==='MMS') return exportMms(current,signal,onProgress);
  throw Error('この形式のMP4書き出しは未対応です');
}
export function mp4Name(filename) {
  return filename.replace(/\.(mag|tsl|mms)$/i,'')+'.mp4';
}