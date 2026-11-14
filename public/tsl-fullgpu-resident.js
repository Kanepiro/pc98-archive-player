// Imported only by the Windows native DirectCompute layout path.
import {packNativeMode4} from './tsl-mode4-native-exact.js';
export const RESIDENT_MAGIC=0x524c4754;
export const RESIDENT_LIMIT=256*1024*1024;
export const NMS_RESERVE=1024*1024;
export function residentBytes(width,height,S){return 10*4*(5*width*height*S*S+2*width*height+32);}
export class NativeLayoutTransfer {
 constructor(enabled=true){this.enabled=enabled;this.sequence=0;this.session=0;this.atlas=null;}
 reset(){this.atlas=null;this.canReuse=false;}
 record(prepared,chars,enabled){this.canReuse=!!enabled;this.lastGray=prepared.field.gray;this.lastChars=chars;}
 pack(prepared,atlas,forceInitial=false){
  const {field,width,height,S,oldChars,oldGray}=prepared,cells=width*height,n=cells*S*S;
  const initial=forceInitial||this.atlas!==atlas||this.width!==width||this.height!==height||this.S!==S;
  const resident=this.enabled&&residentBytes(width,height,S)+NMS_RESERVE<=RESIDENT_LIMIT;
  const faces=Array.isArray(field.faces)?field.faces.slice(0,8):[],old=oldGray?.length===n?1:0;
  let body,op;
  if(initial||!resident){
   const packed=packNativeMode4(field,atlas,width,height,S,oldChars,oldGray,new Float32Array(cells*8));
   body=new Uint8Array(packed.buffer);op=resident?1:3;
   if(initial){
    this.session=crypto.getRandomValues(new Uint32Array(1))[0]||1;this.sequence=0;
    this.atlas=atlas;this.width=width;this.height=height;this.S=S;
    this.lookup=new Map(atlas.map((g,i)=>[g.char,i]));
    this.dynamic=resident?new ArrayBuffer(32+4*(5*n+cells+32)):null;
   }
   const packet=new Uint8Array(32+body.byteLength);packet.set(body,32);body=packet;
  }else{
   for(const a of [field.target,field.importance,field.dist,field.gray])
    if(a.length!==n)throw Error('Native resident input dimensions');
   const reuse=this.canReuse&&old&&oldGray===this.lastGray&&oldChars===this.lastChars;
   op=reuse?4:2;body=new Uint8Array(this.dynamic,0,32+4*((reuse?4*n:5*n+cells)+4*faces.length));
   let at=32;
   const arrays=[field.target,field.importance,field.dist,field.gray];if(!reuse)arrays.push(old?oldGray:null);
   for(const a of arrays){
    const dest=new Float32Array(this.dynamic,at,n);if(a)dest.set(a);else dest.fill(0);at+=n*4;
   }
   if(!reuse){
    const previous=new Int32Array(this.dynamic,at,cells);previous.fill(-1);at+=cells*4;
    if(Array.isArray(oldChars))for(let i=0;i<cells;i++)previous[i]=this.lookup.get(oldChars[i])??-1;
   }
   const faceData=new Float32Array(this.dynamic,at,faces.length*4);
   for(let i=0;i<faces.length;i++){
    const f=faces[i];faceData[i*4]=f.x;faceData[i*4+1]=f.y;faceData[i*4+2]=f.w;faceData[i*4+3]=f.h;
   }
  }
  const header=new DataView(body.buffer,body.byteOffset,32);
  [RESIDENT_MAGIC,1,op,this.session,this.sequence,old,field.cut?1:0,faces.length].forEach((v,i)=>header.setUint32(i*4,v,true));
  return {buffer:body,cells,G:atlas.length,op,sequence:this.sequence++};
 }
}
