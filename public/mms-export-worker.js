// Offline MMS renderer for MP4 export. This worker has no audio device or wall-clock dependency.
import createCore from './mms-core.mjs';

const ready = createCore();
let core = null;
let ended = false;
let produced = 0;
let seenActivity = false;
let lastActivityTime = 0;
const sampleRate = 48000;
const samplesPerChunk = 4096;
// Some authored MMS scripts end the animation but wait indefinitely for a key press.
// Stop offline export after sustained inactivity, retaining a short tail.
const QUIET_END_SECONDS = 3;
const POST_CONTENT_SECONDS = 0.6;

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
      seenActivity = false;
      lastActivityTime = 0;
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
      const before = produced;
      let lastSoundSample = -1;
      for (let i = 0; i < samplesPerChunk; i++) {
        pcm[i] = raw[i] / 32768;
        if (raw[i] !== 0) lastSoundSample = i;
      }
      produced += samplesPerChunk;
      const frames = takeFrames();
      if (frames.length) {
        seenActivity = true;
        for (const frame of frames) lastActivityTime = Math.max(lastActivityTime, frame.time);
      }
      if (lastSoundSample >= 0) {
        seenActivity = true;
        lastActivityTime = Math.max(lastActivityTime, (before + lastSoundSample + 1) / sampleRate);
      }
      const seconds = produced / sampleRate;
      const naturalEnd = !!core._movie_ended();
      const quietEnd = !naturalEnd && seenActivity &&
        seconds - lastActivityTime >= QUIET_END_SECONDS &&
        frames.length === 0 && lastSoundSample < 0;
      ended = naturalEnd || quietEnd;
      const endTime = quietEnd ? Math.min(seconds, lastActivityTime + POST_CONTENT_SECONDS) : seconds;
      const transfers = [pcm.buffer, ...frames.map(frame => frame.pixels)];
      postMessage({id, type:'chunk', pcm:pcm.buffer, frames, ended,
        quietEnd, endTime, seconds}, transfers);
      return;
    }
    throw Error('未知のワーカー要求');
  } catch (e) {
    failure(id,e);
  }
};