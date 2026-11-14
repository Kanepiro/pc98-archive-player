// Honor the crop/fit rectangle selected by the user. Detection must not change
// the camera framing or zoom into a different person while the source plays.
export function artisanFocusRect(base,regions,w,h,previous=null){
 return {...base,zoom:1};
}
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
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
