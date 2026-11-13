// Semantic framing for text-only art. Enlarges a small detected face/subject
// without changing the TSL grid or introducing extra characters.
// It is applied only to Mode 4, never to source video or other modes.
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export function artisanFocusRect(base,regions,w,h,previous=null){
 const faces=regions.filter(r=>r.kind==='face'&&r.confidence>.60);
 const subjects=regions.filter(r=>
  ['person','cat','dog','bird','horse','rabbit'].includes(r.kind)&&r.confidence>.40);
 const chosen=faces.sort((a,b)=>b.confidence-a.confidence)[0]||
  subjects.sort((a,b)=>b.confidence-a.confidence)[0];
 if(!chosen||!chosen.w||!chosen.h)return {...base,zoom:1};
 const target=chosen.kind==='face'?.46:.68;
 const maxZoom=chosen.kind==='face'?2.45:1.8;
 const zoom=clamp(target/Math.max(.01,chosen.h),1,maxZoom);
 if(zoom<1.12)return {...base,zoom:1};
 // Keep face and some lower surrounding body visible, avoid zooming into eyes.
 const fx=(chosen.x+chosen.w*.5)*w,fy=(chosen.y+chosen.h*(chosen.kind==='face'?.77:.50))*h;
 const srcX=(fx-base.x)/base.width,srcY=(fy-base.y)/base.height;
 const desired={x:w/2-srcX*base.width*zoom,y:h*.47-srcY*base.height*zoom,
  width:base.width*zoom,height:base.height*zoom,zoom};
 if(!previous||previous.zoom===1)return desired;
 // Smooth framing, otherwise face detector box jitter looks like camera shake.
 const alpha=.28;
 return {x:previous.x+(desired.x-previous.x)*alpha,
  y:previous.y+(desired.y-previous.y)*alpha,
  width:previous.width+(desired.width-previous.width)*alpha,
  height:previous.height+(desired.height-previous.height)*alpha,
  zoom:previous.zoom+(zoom-previous.zoom)*alpha};
}
export function remapArtisanRegions(regions,base,focused,w,h){
 const convert=({x,y})=>({
  x:(focused.x+((x*w-base.x)/base.width)*focused.width)/w,
  y:(focused.y+((y*h-base.y)/base.height)*focused.height)/h});
 return regions.map(r=>{
  const a=convert({x:r.x,y:r.y}),b=convert({x:r.x+r.w,y:r.y+r.h});
  const x=clamp(a.x,0,1),y=clamp(a.y,0,1);
  const right=clamp(b.x,0,1),bottom=clamp(b.y,0,1);
  return {...r,x,y,w:Math.max(0,right-x),h:Math.max(0,bottom-y),
   landmarks:(r.landmarks||[]).map(p=>({...p,...convert(p)}))};
 }).filter(r=>r.w>0&&r.h>0);
}
