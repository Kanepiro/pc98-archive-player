import {smallProfile} from './tsl-mode4-small.js';
export class SmallNative {
 static async create(cell){
  if(!['127.0.0.1','localhost','[::1]'].includes(location.hostname))return null;
  const r=await fetch('/health/mode4/'+cell,{signal:AbortSignal.timeout(100000)});if(!r.ok)return null;
  const h=await r.json();if(!h.ultimate)return null;return new SmallNative(h,cell);
 }
 constructor(h,cell){this.cell=cell;this.profile=smallProfile(cell);this.adapterInfo={name:h.ultimateName,software:!!h.software,architecture:'Direct3D 11'};}
 async request(buffer,op,cells){
  const r=await fetch('/api/mode4/ultimate/'+this.cell,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buffer,signal:AbortSignal.timeout(190000)});
  if(!r.ok)throw Error((await r.json()).error||'Native conversion failed');
  const b=await r.arrayBuffer();if(b.byteLength!==96+(op===1?0:cells*12))throw Error('Native response size');
  const h=new Uint32Array(b,0,8);if(h[0]!==0x55343652||h[1]!==op||h[2]!==cells||h[3]!==this.count||h[4]!==1152)throw Error('Native response mismatch');
  return b;
 }
 async init(atlas){
  if(this.initialized)return;this.count=atlas.length;
  const b=new ArrayBuffer(32+this.count*1152*4);new Uint32Array(b,0,8).set([0x55343654,1,this.count,1152,this.cell,this.profile.engine,0,0]);
  const f=new Float32Array(b,32);atlas.forEach((g,i)=>f.set(g.features,i*1152));await this.request(b,1,0);this.initialized=true;
 }
 decode(b,cells){
  const u=new Uint32Array(b,32,cells*3),f=new Float32Array(b,32,cells*3),indices=[],scores=[],counts=[];
  for(let c=0;c<cells;c++){if(u[c*3]>=this.count||!Number.isFinite(f[c*3+1]))throw Error('Native score invalid');indices.push(u[c*3]);scores.push(f[c*3+1]);counts.push(u[c*3+2]);}
  const view=new DataView(b,32+cells*12,64);return {indices,scores,counts,timings:Array.from({length:8},(_,i)=>view.getFloat64(i*8,true))};
 }
 async prepareMatch(pixels,width,height,atlas,o){
  await this.init(atlas);const sigma=o.mode4BlurSigma;if(!Number.isFinite(sigma)||sigma<0||sigma>24)throw Error('Gaussian sigma invalid');
  const r=Math.ceil(sigma*3),kernel=sigma?Float32Array.from({length:r*2+1},(_,i)=>Math.exp(-.5*((i-r)/sigma)**2)):new Float32Array([1]);
  const sum=kernel.reduce((a,b)=>a+b,0);for(let i=0;i<kernel.length;i++)kernel[i]/=sum;
  const W=width/2*this.cell,H=height*this.cell,C=width/2*height,rgb=o.mode4Opaque&&o.mode4PackedRgb!==false,b=new ArrayBuffer(96+kernel.length*4+pixels.byteLength*(rgb?.75:1));
  new Uint32Array(b,0,8).set([0x55343654,3,W,H,kernel.length,0,1,rgb?3:4]);new Float32Array(b,20,1)[0]=o.mode4ScoreLimit;
  new Float64Array(b,32,8).set([o.contrast??1,o.brightness??0,o.gamma??1,sigma,o.mode4EdgeHigh,o.mode4EdgeLow,o.mode4MinEdge,o.mode4Diagnostics?1:0]);
  new Float32Array(b,96,kernel.length).set(kernel);const packed=new Uint8Array(b,96+kernel.length*4);
  if(rgb){for(let i=0,j=0;i<pixels.length;i+=4){packed[j++]=pixels[i];packed[j++]=pixels[i+1];packed[j++]=pixels[i+2];}}else packed.set(pixels);
  return this.decode(await this.request(b,3,C),C);
 }
}
