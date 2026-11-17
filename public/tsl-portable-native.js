// The immutable 2014-position atlas is sent once per native session.
export class PortableNative {
 constructor(health){this.adapterInfo={name:health.portableName,software:false,architecture:'DirectCompute / CPU SSE2'};this.initialized=false;}
 async request(buffer,op,cells){
  const r=await fetch('/api/mode4/portable',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buffer,signal:AbortSignal.timeout(190000)});
  if(!r.ok)throw Error((await r.json()).error||'PORTABLE conversion failed');
  const b=await r.arrayBuffer(),h=new Uint32Array(b,0,8),expected=96+(op===1?0:cells*12);
  if(b.byteLength!==expected||h[0]!==0x55343652||h[1]!==op||h[2]!==cells)throw Error('PORTABLE response mismatch');
  return b;
 }
 async init(atlas){
  if(this.initialized)return;
  const b=new ArrayBuffer(32+2014*1152*4);new Uint32Array(b,0,8).set([0x55343654,1,2014,1152,0,0,0,0]);
  const f=new Float32Array(b,32);atlas.forEach((g,i)=>f.set(g.features,i*1152));
  await this.request(b,1,0);this.initialized=true;
 }
 decode(b,cells){
  const u=new Uint32Array(b,32,cells*3),f=new Float32Array(b,32,cells*3),indices=[],scores=[],counts=[];
  for(let c=0;c<cells;c++){if(u[c*3]>=2014||!Number.isFinite(f[c*3+1]))throw Error('PORTABLE score invalid');indices.push(u[c*3]);scores.push(f[c*3+1]);counts.push(u[c*3+2]);}
  const metrics=new DataView(b,32+cells*12,64),timings=Array.from({length:8},(_,i)=>metrics.getFloat64(i*8,true));
  return {indices,scores,counts,timings};
 }
 async match(targets,atlas){
  await this.init(atlas);const C=targets.length,b=new ArrayBuffer(32+C*1152*4);new Uint32Array(b,0,8).set([0x55343654,2,C,2014,1152,0,0,0]);
  const f=new Float32Array(b,32);targets.forEach((t,i)=>f.set(t,i*1152));return this.decode(await this.request(b,2,C),C);
 }
 async prepareMatch(pixels,width,height,atlas,options,kernel){
  await this.init(atlas);const W=width*30,H=height*60,C=width/2*height,rgb=options.mode4Opaque&&options.mode4PackedRgb!==false,b=new ArrayBuffer(96+kernel.length*4+pixels.byteLength*(rgb ? 0.75 : 1));
  new Uint32Array(b,0,8).set([0x55343654,3,W,H,kernel.length,0,1,rgb?3:4]);
  new Float32Array(b,20,1)[0]=options.mode4ScoreLimit??.34;
  new Float64Array(b,32,8).set([options.contrast??1,options.brightness??0,options.gamma??1,options.mode4BlurSigma??8,options.mode4EdgeHigh??.025,options.mode4EdgeLow??.0125,options.mode4MinEdge??8,options.mode4Diagnostics?1:0]);
  new Float32Array(b,96,kernel.length).set(kernel);const packed=new Uint8Array(b,96+kernel.length*4);
  if(rgb){for(let i=0,j=0;i<pixels.length;i+=4){packed[j++]=pixels[i];packed[j++]=pixels[i+1];packed[j++]=pixels[i+2];}}
  else packed.set(pixels);
  return this.decode(await this.request(b,3,C),C);
 }
}
