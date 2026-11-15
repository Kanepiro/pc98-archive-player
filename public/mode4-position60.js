import {MODE4_CHARS} from './mode4-palette60.js';
// Bounds of the unchanged canonical 60px Noto masks; right/bottom exclusive.
export const GLYPH_BOUNDS=[[2,13,58,43],[2,13,58,43],[16,0,44,56],[16,0,44,56],[7,8,53,48],[7,8,53,48],[6,1,54,56],[7,8,53,48],[7,8,53,48],[10,5,50,51],[12,7,49,52],[2,3,58,56],[6,4,54,51],[6,8,53,50],[5,3,52,51],[10,7,50,51],[11,7,48,51],[9,9,51,52],[7,5,53,55],[6,4,57,56],[6,4,55,56],[8,3,58,55],[23,21,37,34],[25,9,35,48],[11,24,49,32],[6,24,54,32],[9,9,51,47],[9,9,51,47],[0,0,60,3],[0,56,60,59],[4,26,56,29],[2,0,58,56],[2,0,58,56],[28,0,32,60],[0,0,32,32],[28,0,60,32],[21,18,42,51],[28,26,60,59],[0,26,32,59],[28,0,59,60],[0,26,60,59],[0,0,31,60],[0,0,60,32],[6,6,54,49],[11,7,49,51],[9,5,53,51],[11,7,49,51],[14,7,46,51],[5,10,55,50],[3,4,57,54],[3,4,57,57],[0,0,58,60],[5,0,55,57],[3,0,57,54],[2,1,58,54],[1,0,59,57],[2,20,58,36],[12,5,48,52],[2,1,58,57],[12,7,48,51],[18,7,47,51],[12,7,48,51],[1,7,59,51],[12,7,49,51],[14,7,46,51],[14,7,46,51],[5,4,52,53],[8,6,49,52],[4,9,56,51],[13,4,52,51],[8,7,52,53],[3,12,57,49],[9,5,49,52],[6,5,53,53],[9,8,50,53],[13,6,55,52],[13,5,47,53],[7,8,53,54],[8,6,56,52],[4,2,55,54],[6,7,54,53],[5,1,53,54],[2,25,58,30],[3,9,57,50],[3,6,57,52],[27,7,33,51],[18,7,42,51],[9,7,51,51],[12,17,48,52],[8,6,52,52],[2,0,58,56],[8,9,52,52],[6,3,54,56],[9,20,52,53],[4,11,55,50],[2,16,58,41],[14,6,46,52],[16,7,47,51],[11,6,50,52],[9,5,51,53],[13,6,46,52],[18,7,45,51],[41,0,58,58],[2,0,19,58],[42,0,58,58],[2,0,18,56],[5,17,55,34],[1,0,59,17],[6,5,53,52],[7,5,54,52],[3,5,57,52],[3,5,57,52],[9,7,51,51],[9,5,51,51],[6,3,54,54],[2,0,60,60],[14,7,42,52],[14,3,54,54],[15,7,48,51],[7,8,56,52],[7,3,56,55],[10,8,51,53],[5,7,53,53],[5,4,57,54],[4,9,56,48],[14,7,45,51],[11,18,48,52],[17,13,46,60],[15,2,46,52],[15,18,48,52],[16,18,45,52],[17,17,44,52],[16,17,44,52],[17,2,45,52],[10,4,50,60],[10,17,51,52],[13,15,47,60],[14,17,48,52],[16,0,45,60],[14,14,45,60],[5,7,55,54],[4,8,56,50],[17,7,50,51],[17,7,47,51],[11,7,50,51],[1,3,54,56],[6,0,54,56],[4,2,56,57],[1,0,59,57],[9,3,51,56],[10,4,50,56],[1,0,60,56],[5,4,54,56],[13,1,36,55],[2,5,58,57],[2,2,59,55],[2,4,59,56],[2,5,58,57],[15,13,44,38],[4,4,23,53],[12,2,44,56],[9,2,53,56],[12,2,44,55],[3,3,56,55],[7,0,53,57],[4,0,55,57],[1,0,56,56],[2,4,57,56],[2,0,56,58],[1,3,58,56]];
const ids=new Map([...MODE4_CHARS].map((c,i)=>[c,i]));
export function validateOffsets(lines,width,height,bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length!==width*height)throw Error('60px文字位置のサイズが不正です');
 for(let y=0;y<height;y++)for(let x=0,row=[...lines[y]];x<width/2;x++){
  const at=y*width+x*2,dx=bytes[at]-60,dy=bytes[at+1]-60,g=ids.get(row[x]);
  if(!Number.isInteger(dx)||!Number.isInteger(dy)||dx%5||dy%5||Math.abs(dx)>55||Math.abs(dy)>55)throw Error('60px文字位置が不正です');
  if(row[x]==='　'){if(dx||dy)throw Error('空白の位置は固定です');continue;}
  if(g===undefined)throw Error('指定外の文字です');
  const [l,t,r,b]=GLYPH_BOUNDS[g];if(l+dx<0||r+dx>60||t+dy<0||b+dy>60)throw Error('文字が60pxセルからはみ出します');
 }
 return bytes;
}
export function encodeOffsets(bytes){
 let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);
}
export function decodeOffsets(value,size){
 if(value.length!==Math.ceil(size/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('文字位置データが不正です');
 let s;try{s=atob(value);}catch{throw Error('文字位置データが不正です');}
 if(s.length!==size)throw Error('文字位置データが不足しています');
 return Uint8Array.from(s,c=>c.charCodeAt(0));
}
export function positionHeader(frames,size){
 if(!frames.some(Boolean))return [];
 return frames.map((v,i)=>'# TASL_MODE4_OFFSETS '+i+' '+encodeOffsets(v??new Uint8Array(size).fill(60)));
}
export function parsePositions(header,frames,width,height){
 const entries=header.split('\n').filter(l=>l.startsWith('# TASL_MODE4_OFFSETS '));if(!entries.length)return null;
 if(entries.length!==frames.length)throw Error('文字位置の画面数が不正です');
 const out=new Array(frames.length);
 for(const line of entries){
  const m=line.match(/^# TASL_MODE4_OFFSETS (\d+) ([A-Za-z0-9+/=]+)$/);if(!m)throw Error('文字位置ヘッダーが不正です');
  const n=Number(m[1]);if(n>=frames.length||out[n])throw Error('文字位置の画面番号が不正です');
  out[n]=validateOffsets(frames[n].split('\n'),width,height,decodeOffsets(m[2],width*height));
 }
 return out;
}
