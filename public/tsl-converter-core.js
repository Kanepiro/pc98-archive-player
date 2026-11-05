// TASL 1.08: ASCII subset of Shift-JIS, CRLF, column-zero FF, 60 Hz ticks.
export const CANDIDATE_RAMP = ' .:|/(%YVO8D@0#$';
export const MAX_FRAMES = 10000;
export const MAX_OUTPUT_BYTES = 48 * 1024 * 1024;
export const DEFAULTS = Object.freeze({width:79,height:27,fps:10,brightness:0,contrast:1});
export function optionsFor(input={}) {
 const o={...DEFAULTS,...input};
 for(const [k,min,max] of [['width',4,160],['height',4,100],['fps',1,30],['brightness',-100,100],['contrast',.25,3]]) {
  if(!Number.isFinite(o[k])||o[k]<min||o[k]>max)throw Error('設定値が範囲外です: '+k);
 }
 if(!Number.isInteger(o.width)||!Number.isInteger(o.height))throw Error('文字数は整数で指定してください');
 return o;
}
export function makePlan(duration,input={}) {
 const o=optionsFor(input);
 if(!Number.isFinite(duration)||duration<=0||duration>7200)throw Error('動画は0秒より長く、2時間以内にしてください');
 const totalTicks=Math.max(1,Math.round(duration*60));
 const bytesPerFrame=(o.width+2)*o.height+3+24;
 const capacity=Math.min(MAX_FRAMES,Math.floor((MAX_OUTPUT_BYTES-4096)/bytesPerFrame));
 const count=Math.min(capacity,totalTicks,Math.max(1,Math.ceil(duration*o.fps)));
 const steps=Array.from({length:count},(_,i)=>{
  const start=Math.round(i*totalTicks/count),end=Math.round((i+1)*totalTicks/count);
  return {time:start/60,ticks:end-start};
 });
 return {...o,steps,totalTicks,count,duration:totalTicks/60,effectiveFps:count/duration,
  estimatedBytes:count*bytesPerFrame+4096,reduced:count<Math.ceil(duration*o.fps)};
}
export function portraitGrid(aspect=9/16,columns=90) {
 if(!Number.isFinite(aspect)||aspect<.25||aspect>1||!Number.isInteger(columns)||columns<4||columns>160)throw Error('縦画面の比率または文字数が不正です');
 let width=columns,height=Math.round(width*.5/aspect);
 if(height>100){height=100;width=Math.round(height*aspect/.5);}
 return {width,height,targetAspect:aspect};
}
// Font pixels are a Full-HD-equivalent *target* for new portrait TSLs.
// TSL itself stores a character grid, not font metrics. The player uses a
// 12x24 cell with a 20px font, so requested pixels set the grid density.
export const DEFAULT_FONT_PIXELS = 20;
export function portraitGridForPixels(aspect=9/16,fontPixels=DEFAULT_FONT_PIXELS) {
 if(!Number.isInteger(fontPixels)||fontPixels<16||fontPixels>256)throw Error('文字サイズは16〜256pxの整数で指定してください');
 if(!Number.isFinite(aspect)||aspect<.25||aspect>1)throw Error('縦画面の比率が不正です');
 const referenceWidth=Math.min(1080,Math.round(1920*aspect));
 const columns=Math.max(4,Math.min(160,Math.round(referenceWidth/(fontPixels*.6))));
 return portraitGrid(aspect,columns);
}

export function fitRect(sourceWidth,sourceHeight,width,height,cellAspect=.5,fit='contain',positionX=.5,positionY=.5) {
 if(!(sourceWidth>0&&sourceHeight>0))throw Error('動画サイズを取得できません');
 const aspect=sourceWidth/sourceHeight/cellAspect;
 let w=width,h=w/aspect;
 if((fit==='contain'&&h>height)||(fit==='cover'&&h<height)){h=height;w=h*aspect;}
 return {x:(width-w)*positionX,y:(height-h)*positionY,width:w,height:h};
}
export function densityRamp(measure) {
 return [...CANDIDATE_RAMP].map((char,i)=>({char,density:measure(char),i}))
  .sort((a,b)=>a.density-b.density||a.i-b.i).map(x=>x.char).join('');
}
export function rgbaToASCII(pixels,width,height,{brightness=0,contrast=1,ramp=CANDIDATE_RAMP,sample=4}={}) {
 if(pixels.length!==width*height*sample*sample*4)throw Error('画素数が一致しません');
 if(ramp.length!==16||new Set(ramp).size!==16||[...ramp].some(c=>!CANDIDATE_RAMP.includes(c)))throw Error('文字パレットが不正です');
 const lines=[],stride=width*sample*4;
 for(let y=0;y<height;y++){
  let line='';
  for(let x=0;x<width;x++){
   let sum=0;
   for(let dy=0;dy<sample;dy++)for(let dx=0;dx<sample;dx++){
    const p=(y*sample+dy)*stride+(x*sample+dx)*4;
    sum+=(.2126*pixels[p]+.7152*pixels[p+1]+.0722*pixels[p+2])*(pixels[p+3]/255);
   }
   const value=Math.min(255,Math.max(0,(sum/(sample*sample)-127.5)*contrast+127.5+brightness*2.55));
   line+=ramp[Math.round(value*15/255)];
  }
  lines.push(line);
 }
 return lines.join('\r\n')+'\r\n';
}
export function tslName(name) {
 const stem=String(name||'video').replace(/\.[^.]+$/,'').replace(/[\x00-\x1f\\/]/g,'_');
 return (stem||'video')+'.TSL';
}
export class TSLWriter {
 constructor(plan) {this.plan=plan;this.parts=[];this.batch=[];this.size=0;this.frames=0;}
 append(frame) {
  const lines=frame.split('\r\n');lines.pop();
  if(lines.length!==this.plan.height||lines.some(x=>x.length!==this.plan.width||[...x].some(c=>!CANDIDATE_RAMP.includes(c))))
   throw Error('画面データが不正です');
  if(this.frames>=this.plan.count)throw Error('画面数が多すぎます');
  const part=frame+'\f\r\n';this.size+=part.length;
  if(this.size>MAX_OUTPUT_BYTES-4096-this.plan.count*24)throw Error('出力サイズ上限を超えました');
  this.batch.push(part);this.frames++;
  if(this.batch.length>=64){this.parts.push(new Blob(this.batch));this.batch=[];}
 }
 finish() {
  if(this.frames!==this.plan.count)throw Error('画面データが不足しています');
  const p=this.plan,header=['1.08',p.count,p.width,p.height,1,-1,'Video conversion','\f'].join('\r\n')+'\r\n';
  const schedule=p.steps.map((s,i)=>(i+1)+' '+s.ticks+'\r\n').join('')+'0 0\r\n\f\r\n';
  return new Blob([header,schedule,...this.parts,...this.batch,'\x1a'],{type:'application/octet-stream'});
 }
}
