// Check decoded media timestamps, not an HTMLVideoElement's requested currentTime.
export function frameRequestTime(time,first,end){
 if(![time,first,end].every(Number.isFinite)||end<=first)throw Error('動画のフレーム時刻が不正です');
 return Math.max(first,Math.min(time,end-.000001));
}
export function verifyDecodedFrame(frame,time,previous=-Infinity){
 const start=frame?.timestamp,duration=frame?.duration;
 if(!Number.isFinite(start)||!Number.isFinite(duration)||duration<=0||
    start>time+.001||start+duration<time-.001||start<previous-.001)
  throw Error('指定時刻の映像を取得できません（'+time.toFixed(3)+'秒）。古い絵のまま保存せず変換を停止しました');
 return start;
}
