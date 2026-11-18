import {HALFTONE_PROFILES} from './halftone-profiles.js';
const chars=['　','。','ｏ','Ｏ','◎'],states=new Map();
export function ensureHalftoneAtlas(native16=false){
 const cell=native16?16:24;
 if(states.has(cell))return states.get(cell).promise;
 const s={masks:null,tints:new Map()};states.set(cell,s);
 s.promise=(async()=>{
  const r=await fetch(new URL('./halftone-atlas'+cell+'.bin',import.meta.url));if(!r.ok)throw Error('モード2字形がありません');
  const b=new Uint8Array(await r.arrayBuffer()),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(b.length!==5*cell*cell||hash!==HALFTONE_PROFILES[cell].hash)throw Error('モード2字形が一致しません');s.masks=b;return b;
 })().catch(e=>{states.delete(cell);throw e;});return s.promise;
}
export function drawHalftone(canvas,data,index,{foreground='#e3f4e8',background='#080d12'}={}){
 const cell=data.native16?16:24,s=states.get(cell);if(!s?.masks)throw Error('モード2字形読み込み未完了');
 if(!s.tints.has(foreground)){
  const a=typeof document==='undefined'?new OffscreenCanvas(cell*5,cell):document.createElement('canvas');a.width=cell*5;a.height=cell;
  const c=a.getContext('2d'),im=c.createImageData(cell*5,cell);
  for(let g=0;g<5;g++)for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){const i=(y*cell*5+g*cell+x)*4;im.data[i]=im.data[i+1]=im.data[i+2]=255;im.data[i+3]=s.masks[g*cell*cell+y*cell+x];}
  c.putImageData(im,0,0);c.globalCompositeOperation='source-in';c.fillStyle=foreground;c.fillRect(0,0,a.width,a.height);
  if(s.tints.size>=4)s.tints.delete(s.tints.keys().next().value);s.tints.set(foreground,a);
 }
 const w=data.width*cell/2,h=data.height*cell;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 const c=canvas.getContext('2d');c.fillStyle=background;c.fillRect(0,0,w,h);c.imageSmoothingEnabled=false;
 const rows=data.frames[index].split('\n');
 for(let y=0;y<rows.length;y++)for(let x=0,row=[...rows[y]];x<row.length;x++){
  if(row[x]===' '&&x===Math.floor(data.width/2)&&data.width%2)continue;
  const g=chars.indexOf(row[x]);if(g<0)throw Error('モード2文字が不正です');
  if(g)c.drawImage(s.tints.get(foreground),g*cell,0,cell,cell,x*cell,y*cell,cell,cell);
 }
}
