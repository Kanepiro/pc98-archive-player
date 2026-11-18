import {drawHalftone} from './tsl-halftone-raster.js';
import {halftoneColumns} from './tsl-halftone.js';
import {validateOutputSize} from './tsl-output-presets.js';
import {parsePositions} from './tsl-mode4.js';
import {drawSmallGrid} from './tsl-mode4-small.js';
import {drawMode4Grid as draw60,validateGridFrame as validate60} from './tsl-mode4-grid60.js';
import {drawMode4Grid,validateGridFrame} from './tsl-mode4-grid.js';
import {taslCanvasFont,assertTaslGlyphs} from './tasl-font.js';
// Adapted from the user's TSL_Viewer.html. Timing uses an absolute clock.
export function parseTSL(text){
 text=text.replace(/\r\n?/g,'\n').replace(/\x1a+$/,'');
 const chunks=text.split(/^\x0c[^\n]*\n/gm);
 if(chunks.length<4)throw Error('TSLの改ページ区切りがありません');
 const halftoneTag=chunks[0].match(/^# TASL_HALFTONE_PROFILE (\d+)$/m);
 if(halftoneTag&&halftoneTag[1]!=='2001')throw Error('未対応のモード2字形です');
 const halftoneProfile=halftoneTag?2001:0;
 const native16=chunks[0].split('\n').some(line=>line.trim()==='# PC98_FONT_16X16');
 const timing=chunks[0].match(/^# TASL_MODE4_TIMING ([0-9.]+) ([0-9.]+)$/m);
 const sizeTags=[...chunks[0].matchAll(/^# TASL_MODE4_CELL(30|40|60|120)\s*$/gm)].map(m=>Number(m[1]));
 if(sizeTags.length>1)throw Error('モード4のセルサイズ指定が重複しています');
 const mode4CellSize=sizeTags[0]===120?0:(sizeTags[0]??0);
 const mode4Cell60=chunks[0].split('\n').some(line=>line.trim()==='# TASL_MODE4_CELL60');
 const mode4Cell120=chunks[0].split('\n').some(line=>line.trim()==='# TASL_MODE4_CELL120');
 const outputTag=chunks[0].match(/^# TASL_OUTPUT_SIZE (\d+) (\d+)$/m);
 const outputSize=outputTag?validateOutputSize(Number(outputTag[1]),Number(outputTag[2])):{};
 const hdr=[],names=[];
 for(const line of chunks[0].split('\n')){
  const val=line.trim();if(!val||val.startsWith('#'))continue;
  if(hdr.length<6)hdr.push(val.split('#')[0].trim().split(/\s+/)[0]);else names.push(val);
 }
 const count=Number(hdr[1]),width=Number(hdr[2]),height=Number(hdr[3]);
 if(!Number.isInteger(count)||count<1||count>10000||!Number.isInteger(width)||width<1||width>(mode4CellSize?512:native16?480:200)||!Number.isInteger(height)||height<1||height>(mode4CellSize?256:native16?240:100))throw Error('TSLの画面数またはサイズが不正です');
 if(chunks.length<count+3)throw Error('TSLの画面データが不足しています');
 const frames=chunks.slice(2,2+count).map(s=>s.replace(/\n+$/,''));
 if(halftoneProfile){if(mode4CellSize||mode4Cell120)throw Error('描画方式が重複しています');for(const f of frames){const rows=f.split('\n');if(rows.length!==height||rows.some(r=>halftoneColumns(r)!==width))throw Error('モード2画面が不正です');}}
 if(mode4CellSize)for(const frame of frames)validate60(frame.split("\n"),width,height);
 if(mode4Cell120)for(const frame of frames)validateGridFrame(frame.split('\n'),width,height);
 const mode4Offsets=mode4CellSize?parsePositions(chunks[0],frames,width,height,mode4CellSize):null;
 const schedule=[];let duration=0;
 for(const line of chunks[1].split('\n')){
  const match=line.split('#')[0].trim().match(/^(\d+)\s+(\d+)$/);if(!match)continue;
  const frame=Number(match[1]),ticks=Number(match[2]);if(frame===0)break;
  if(frame<1||frame>count||ticks>360000)throw Error('TSLの再生順序または待機時間が不正です');
  schedule.push({frame:frame-1,start:duration});duration+=Math.max(1,ticks)/60;
 }
 if(!schedule.length)for(let i=0;i<count;i++){schedule.push({frame:i,start:duration});duration+=.1;}
 let mode4Fps=null;
 if((mode4CellSize||mode4Cell120)&&timing){
  mode4Fps=Number(timing[1]);const seconds=Number(timing[2]);
  if(!Number.isFinite(mode4Fps)||mode4Fps<1||mode4Fps>30||!Number.isFinite(seconds)||seconds<=0||seconds>7200||Math.ceil(seconds*mode4Fps)!==count)throw Error('モード4の時刻情報が不正です');
  schedule.length=0;for(let i=0;i<count;i++)schedule.push({frame:i,start:i/mode4Fps});duration=seconds;
 }
 if(outputSize.outputWidth&&width*.5/height!==outputSize.outputWidth/outputSize.outputHeight)throw Error('TSLの出力比率と文字グリッドが一致しません');
 return {...outputSize,halftoneProfile,frames,schedule,duration,width,height,title:names.join(' / '),version:hdr[0],native16,mode4CellSize,mode4Cell60,mode4Cell120,mode4Fps,mode4Offsets};
}
export function tslFrameAt(data,seconds){
 let low=0,high=data.schedule.length;
 while(low+1<high){const mid=(low+high)>>1;if(data.schedule[mid].start<=seconds)low=mid;else high=mid;}
 return data.schedule[low].frame;
}
export function drawTSL(canvas,data,index,{cellWidth=data.native16?8:12,cellHeight=data.native16?16:24,fontSize=data.native16?16:20,foreground='#e3f4e8',background='#080d12'}={}){
 if(data.halftoneProfile)return drawHalftone(canvas,data,index,{foreground,background});
 if(data.mode4CellSize&&data.mode4CellSize!==60)return drawSmallGrid(canvas,data,index,{foreground,background});
 if(data.mode4Cell60)return draw60(canvas,data,index,{foreground,background});
 if(data.mode4Cell120)return drawMode4Grid(canvas,data,index,{foreground,background});
 assertTaslGlyphs(data.frames[index]);
 const cw=cellWidth,ch=cellHeight,w=Math.round(data.width*cw),h=Math.round(data.height*ch);
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 const c=canvas.getContext('2d');c.fillStyle=background;c.fillRect(0,0,w,h);
 c.fillStyle=foreground;c.font=taslCanvasFont(fontSize);c.textBaseline='top';
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
