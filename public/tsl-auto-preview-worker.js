// Isolated auto-analysis worker: reuses the production converters without changing them.
import {rgbaToASCII} from './tsl-converter-core.js';
import {rgbaToHalftone,HALFTONE_TONES,halftoneLevels} from './tsl-halftone.js';
import {QualityConverter} from './tsl-quality.js';
import {createMode4Converter} from './tsl-mode4.js';
import {areaSample} from './tsl-mode4-grid60.js';
import {MODE4_CHARS} from './mode4-palette60.js';
import {GpuToneConverter} from './tsl-tone-webgpu.js';
import {sampleSource,activeMask,makeReference,scoreContour,scoreTones,AUTO_LIMITS} from './tsl-auto-visibility.js';
let config,converter,atlas,masks,tones;
const glyphIds=new Map([...MODE4_CHARS].map((c,i)=>[c,i]));
function glyphImage(frame,offsets){
 const {mode,width,height,sample}=config,rows=frame.split('\r\n').slice(0,height);
 if(mode==='quality'){
  const w=width*sample,h=height*sample,ink=new Float32Array(w*h),map=new Map(atlas.map(a=>[a.char,a]));
  for(let y=0;y<height;y++){let x=0;for(const char of rows[y]||''){const a=map.get(char);if(!a)throw Error('解析用字形がありません');for(let py=0;py<sample;py++)for(let px=0;px<a.columns*sample;px++)ink[(y*sample+py)*w+x*sample+px]=a.mask[py*a.columns*sample+px];x+=a.columns;}}
  return {ink,w,h};
 }
 const cell=config.mode4CellSize??60;
 const w=width/2*12,h=height*12,ink=new Float32Array(w*h);
 for(let y=0;y<height;y++)for(let x=0,chars=[...(rows[y]||'')];x<width/2;x++){
  const id=glyphIds.get(chars[x]);if(id===undefined)continue;const at=y*width+x*2,dx=offsets?offsets[at]-60:0,dy=offsets?offsets[at+1]-60:0;
  if(cell===60){
   for(let py=0;py<12;py++)for(let px=0;px<12;px++){
    let sum=0;for(let yy=0;yy<5;yy++)for(let xx=0;xx<5;xx++){const sx=px*5+xx-dx,sy=py*5+yy-dy;if(sx>=0&&sy>=0&&sx<60&&sy<60)sum+=masks[id*3600+sy*60+sx]/255;}
    ink[(y*12+py)*w+x*12+px]=sum/25;
   }
  }else{
   const block=new Float32Array(cell*cell);
   for(let py=0;py<cell;py++)for(let px=0;px<cell;px++){const sx=px-dx,sy=py-dy;if(sx>=0&&sx<cell&&sy>=0&&sy<cell)block[py*cell+px]=masks[id*cell*cell+sy*cell+sx]/255;}
   const scaled=areaSample(block,cell,cell,12);
   for(let py=0;py<12;py++)for(let px=0;px<12;px++)ink[(y*12+py)*w+x*12+px]=scaled[py*12+px];
  }
 }
 return {ink,w,h};
}
self.onmessage=async({data:d})=>{
 try{
  if(d.type==='init'){
   config=d;atlas=d.atlas;masks=d.masks;
   if(d.mode==='quality'||d.mode==='artisan'){
    converter=d.mode==='quality'?new QualityConverter(atlas,d.sample):createMode4Converter(atlas,d.mode4CellSize??60);
    if(!d.cpuOnly&&d.mode==='quality')await converter.enableWebGPU(d.width,d.height);
   }else if(!d.cpuOnly){
    try{tones=await GpuToneConverter.create(d.mode,d.sample,d.width,d.height);}catch{}
   }
   self.postMessage({ready:true});return;
  }
  if(d.type!=='evaluate'||!Array.isArray(d.candidates)||d.candidates.length>AUTO_LIMITS.candidates)throw Error('解析候補数が不正です');
  const {mode,width,height,sample}=config,pixels=new Uint8ClampedArray(d.pixels),isContour=mode==='quality'||mode==='artisan';
  const pw=mode==='artisan'?width*(config.mode4CellSize??60)/2:width*sample,ph=mode==='artisan'?height*(config.mode4CellSize??60):height*sample;
  const rw=mode==='artisan'?width/2*12:mode==='halftone'?Math.floor(width/2):mode==='quality'?width*sample:width;
  const rh=isContour?(mode==='artisan'?height*12:height*sample):height;
  const reference=isContour?makeReference(pixels,pw,ph,rw,rh,d.bounds,mode):{...sampleSource(pixels,pw,ph,rw,rh),valid:activeMask(rw,rh,d.bounds)};
  const trials=[];
  for(const settings of d.candidates){
   const options={...config.options,...settings,sample,conversionMode:mode,mode4Cell60:mode==='artisan'&&(config.mode4CellSize??60)===60,mode4CellSize:mode==='artisan'?(config.mode4CellSize??60):undefined,mode4Opaque:true};
   // Widely separated scenes must not share temporal glyph state; the native device/atlas stays resident.
   if(converter){converter.previous=null;converter.prevGlyphs=null;}
   let frame,backend='CPU';
   if(converter){frame=await converter.convertAccelerated(pixels,width,height,options);backend=converter.acceleration;}
   else if(tones){try{frame=await tones.convert(pixels,options);backend=tones.acceleration;}catch{tones.dispose();tones=null;}}
   if(frame===undefined)frame=mode==='halftone'?rgbaToHalftone(pixels,width,height,options):rgbaToASCII(pixels,width,height,options);
   const chars=[...frame.replace(/[\r\n]/g,'')],occupancy=chars.filter(c=>c!==' '&&c!=='　').length/Math.max(1,chars.length);
   let metrics;
   if(isContour){const actual=glyphImage(frame,converter.lastOffsets);metrics=scoreContour(reference,actual.ink,occupancy);}
   else{
    const palette=[...(mode==='halftone'?HALFTONE_TONES:options.ramp)],lookup=new Map(palette.map((c,i)=>[c,mode==='halftone'?halftoneLevels(config.options.native16)[i]:i/(palette.length-1)])),levels=[];
    for(const row of frame.split('\r\n').slice(0,height))for(const char of (mode==='halftone'?[...row].slice(0,Math.floor(width/2)):[...row]))levels.push(lookup.get(char)??0);
    metrics=scoreTones(reference,levels,palette.length);
   }
   trials.push({settings,metrics,backend,...(d.diagnostics?{frame,offsets:converter?.lastOffsets?Array.from(converter.lastOffsets):null}: {})});
  }
  self.postMessage({trials});
 }catch(error){self.postMessage({error:error.message});}
};
