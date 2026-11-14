// PC-only exact arithmetic acceleration for the ORIGINAL Mode 4.
// No alternate glyph selection, no changed algorithm, no skipping recognition.
// The authoritative CPU placementLoss() results are checked before use.
const MAGIC=0x4353344d;
const VERSION=1;
const verify=(v,min,max,label)=>{
 if(!Number.isInteger(v)||v<min||v>max)throw Error('Invalid native Mode 4 '+label);
 return v;
};
function pack(field,atlas,width,height,S,oldChars,oldGray,orientations){
 const W=verify(width,4,480,'width'),H=verify(height,4,240,'height'),
       s=verify(S,4,10,'sample'),G=verify(atlas.length,2,512,'glyph count');
 const cells=W*H, n=cells*s*s,per=2*s*s;
 if(cells*G>6_000_000||n>3_000_000)throw Error('Native Mode 4 capacity exceeded');
 if(field.target.length!==n||field.importance.length!==n||
    field.dist.length!==n||field.gray.length!==n||
    orientations.length!==cells*8)throw Error('Native Mode 4 input sizes mismatch');
 const hasOld=oldGray?.length===n?1:0;
 const faces=Array.isArray(field.faces)?field.faces.slice(0,8):[];
 // All fields are aligned to 4 bytes; no lossy float32 conversion of scores.
 const byteLength=4*(9+5*n+8*cells+cells+4*faces.length+2*G+
   G+4*G+2*G*per);
 const buffer=new ArrayBuffer(byteLength),header=new DataView(buffer);
 for(const [i,v] of [MAGIC,VERSION,W,H,s,G,hasOld,field.cut?1:0,faces.length].entries())
  header.setUint32(i*4,v,true);
 let offset=9*4;
 const push=(Type,value,len)=>{
  const view=new Type(buffer,offset,len);
  if(value)view.set(value);
  offset+=view.byteLength;
  return view;
 };
 push(Float32Array,field.target,n);
 push(Float32Array,field.importance,n);
 push(Float32Array,field.dist,n);
 push(Float32Array,field.gray,n);
 push(Float32Array,hasOld?oldGray:null,n);
 push(Float32Array,orientations,cells*8);
 const glyphLookup=new Map(atlas.map((g,i)=>[g.char,i]));
 const previous=push(Int32Array,null,cells);
 previous.fill(-1);
 if(Array.isArray(oldChars)){
  for(let i=0;i<cells;i++)previous[i]=glyphLookup.get(oldChars[i])??-1;
 }
 const faceItems=push(Float32Array,null,faces.length*4);
 for(let i=0;i<faces.length;i++)
  faceItems.set([faces[i].x,faces[i].y,faces[i].w,faces[i].h],i*4);
 push(Int32Array,Int32Array.from(atlas,g=>g.columns),G);
 push(Int32Array,Int32Array.from(atlas,g=>g.shapeSymbol?1:0),G);
 push(Float32Array,Float32Array.from(atlas,g=>g.detailPenalty),G);
 const glyphOrient=push(Float32Array,null,G*4);
 const masks=push(Float32Array,null,G*per);
 const expanded=push(Float32Array,null,G*per);
 for(let i=0;i<G;i++){
  const g=atlas[i];
  glyphOrient.set(g.orientation,i*4);
  masks.set(g.mask,i*per);
  expanded.set(g.expanded,i*per);
 }
 if(offset!==buffer.byteLength)throw Error('Native Mode 4 payload length error');
 return {buffer,cells,G};
}
export class Mode4ExactNativeMatcher{
 constructor(endpoint='/api/mode4/score'){this.endpoint=endpoint;this.enabled=true;}
 async compute(field,atlas,width,height,S,oldChars,oldGray,orientations){
  const packed=pack(field,atlas,width,height,S,oldChars,oldGray,orientations);
  const response=await fetch(this.endpoint,{method:'POST',body:packed.buffer,
   headers:{'Content-Type':'application/octet-stream'},cache:'no-store'});
  if(!response.ok)throw Error('PC native scorer failed: HTTP '+response.status);
  if(this.endpoint.endsWith('/gpu-score')&&
     response.headers.get('X-TASL-Compute-Backend')!=='DirectCompute')
   throw Error('DirectCompute GPU execution was not confirmed');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==packed.cells*packed.G*8)
   throw Error('PC native score byte count mismatch');
  return new Float64Array(bytes);
 }
}