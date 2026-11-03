// Offline MMS renderer for MP4 export. This worker has no audio device or wall-clock dependency.
import createCore from './mms-core.mjs';

const ready = createCore();
let core = null;
let ended = false;
let produced = 0;
const sampleRate = 48000;
const samplesPerChunk = 4096;

function failure(id, error) {
  postMessage({id, type:'error', message:String(error?.message || error)});
}

function takeFrames() {
  const frames = [];
  while (core._movie_frames()) {
    const width = core._movie_frame_width();
    const height = core._movie_frame_height();
    const time = core._movie_frame_time();
    const ptr = core._movie_frame_data();
    const pixels = core.HEAPU8.slice(ptr, ptr + width * height * 4);
    core._movie_frame_pop();
    frames.push({width, height, time, pixels:pixels.buffer});
  }
  return frames;
}

self.onmessage = async ({data:d}) => {
  const id = d.id;
  try {
    if (d.type === 'open') {
      core = await ready;
      ended = false;
      produced = 0;
      const bytes = new Uint8Array(d.bytes);
      const ptr = core._malloc(bytes.length);
      if (!ptr) throw Error('MMSファイルの読み込み用メモリが不足しています');
      try {
        core.HEAPU8.set(bytes, ptr);
        if (!core._movie_open(ptr, bytes.length)) throw Error(core.UTF8ToString(core._movie_error()));
      } finally {
        core._free(ptr);
      }
      postMessage({id, type:'ready'});
      return;
    }
    if (d.type === 'next') {
      if (!core) throw Error('MMSエンジンが未初期化です');
      if (ended) throw Error('再生は終了済みです');
      const ptr = core._movie_render(samplesPerChunk, sampleRate);
      if (!ptr) throw Error(core.UTF8ToString(core._movie_error()));
      const pcm = new Float32Array(samplesPerChunk);
      const raw = core.HEAP16.subarray(ptr >> 1, (ptr >> 1) + samplesPerChunk);
      for (let i = 0; i < samplesPerChunk; i++) pcm[i] = raw[i] / 32768;
      produced += samplesPerChunk;
      const frames = takeFrames();
      ended = !!core._movie_ended();
      const transfers = [pcm.buffer, ...frames.map(frame => frame.pixels)];
      postMessage({id, type:'chunk', pcm:pcm.buffer, frames, ended,
        seconds:produced / sampleRate}, transfers);
      return;
    }
    throw Error('未知のワーカー要求');
  } catch (e) {
    failure(id,e);
  }
};