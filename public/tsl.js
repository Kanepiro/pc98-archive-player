// Adapted from the user's TSL_Viewer.html. Timing uses an absolute clock.
export function parseTSL(text){
 text=text.replace(/\r\n?/g,'\n').replace(/\x1a+$/,'');
 const chunks=text.split(/^\x0c[^\n]*\n/gm);
 if(chunks.length<4)throw Error('TSLの改ページ区切りがありません');
 const hdr=[],names=[];
 for(const line of chunks[0].split('\n')){
  const val=line.trim();if(!val||val.startsWith('#'))continue;
  if(hdr.length<6)hdr.push(val.split('#')[0].trim().split(/\s+/)[0]);else names.push(val);
 }
 const count=Number(hdr[1]),width=Number(hdr[2]),height=Number(hdr[3]);
 if(!Number.isInteger(count)||count<1||count>10000||!Number.isInteger(width)||width<1||width>200||!Number.isInteger(height)||height<1||height>100)throw Error('TSLの画面数またはサイズが不正です');
 if(chunks.length<count+3)throw Error('TSLの画面データが不足しています');
 const frames=chunks.slice(2,2+count).map(s=>s.replace(/\n+$/,''));
 const schedule=[];let duration=0;
 for(const line of chunks[1].split('\n')){
  const match=line.split('#')[0].trim().match(/^(\d+)\s+(\d+)$/);if(!match)continue;
  const frame=Number(match[1]),ticks=Number(match[2]);if(frame===0)break;
  if(frame<1||frame>count||ticks>360000)throw Error('TSLの再生順序または待機時間が不正です');
  schedule.push({frame:frame-1,start:duration});duration+=Math.max(1,ticks)/60;
 }
 if(!schedule.length)for(let i=0;i<count;i++){schedule.push({frame:i,start:duration});duration+=.1;}
 return {frames,schedule,duration,width,height,title:names.join(' / '),version:hdr[0]};
}
export function tslFrameAt(data,seconds){
 let low=0,high=data.schedule.length;
 while(low+1<high){const mid=(low+high)>>1;if(data.schedule[mid].start<=seconds)low=mid;else high=mid;}
 return data.schedule[low].frame;
}
export function drawTSL(canvas,data,index,{cellWidth=12,cellHeight=24,fontSize=20}={}){
 const cw=cellWidth,ch=cellHeight,w=Math.round(data.width*cw),h=Math.round(data.height*ch);
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 const c=canvas.getContext('2d');c.fillStyle='#080d12';c.fillRect(0,0,w,h);
 c.fillStyle='#e3f4e8';c.font=fontSize+'px monospace';c.textBaseline='top';
 const lines=data.frames[index].split('\n');
 for(let y=0;y<Math.min(lines.length,data.height);y++){
  let x=0;
  for(const char of lines[y]){
   if(char==='\t'){x=(Math.floor(x/8)+1)*8;continue;}
   const n=char.codePointAt(0),columns=(n<=0x7f||(n>=0xff61&&n<=0xff9f))?1:2;
   if(x>=data.width)break;c.fillText(char,x*cw,y*ch,columns*cw);x+=columns;
  }
 }
}
