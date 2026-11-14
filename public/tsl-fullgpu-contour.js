export class NativeContour {
 constructor(software=false){this.software=software;this.timings={};}
 async run(op,w,h,input,options={}){
  const regions=op===4?(options.semantic||[]).filter(r=>[r.x,r.y,r.w,r.h,r.importance].every(Number.isFinite)&&r.w>0&&r.h>0).slice(0,8):[];
  const n=w*h,buffer=new ArrayBuffer(32+n*4+regions.length*24*4),v=new DataView(buffer);
  if(op===4){v.setUint32(28,regions.length,true);const rv=new Float32Array(buffer,32+n*4);
   regions.forEach((r,j)=>{const a=j*24,kind=r.kind==='face'?1:['person','cat','dog','bird','horse','sheep','cow'].includes(r.kind)?2:['bear','rabbit'].includes(r.kind)?3:0;
    rv.set([kind,r.x,r.y,r.w,r.h,r.confidence||0,r.importance,r.kind==='person'?1:0,Math.min(6,r.landmarks?.length||0)],a);
    (r.landmarks||[]).slice(0,6).forEach((p,k)=>rv.set([p.x,p.y],a+9+k*2));
   });
  }
  [0x43504754,op,w,h].forEach((x,i)=>v.setUint32(i*4,x,true));
  [options.brightness??0,options.contrast??1,options.gamma??1].forEach((x,i)=>v.setFloat32(16+i*4,x,true));
  if(op===1)new Uint8Array(buffer,32).set(input);
  else if(op===2||op===4)new Float32Array(buffer,32,n).set(input);
  else new Uint32Array(buffer,32).set(input);
  const start=performance.now();
  const response=await fetch('/api/mode4/gpu-contour',{method:'POST',body:buffer,
   headers:{'Content-Type':'application/octet-stream'},signal:AbortSignal.timeout(190000)});
  if(!response.ok)throw Error('輪郭GPU: '+(await response.text()).slice(0,400));
  const backend=response.headers.get('X-TASL-Compute-Backend');
  if(backend!=='DirectCompute-Global'&&!(this.software&&backend==='WARP-Test'))throw Error('輪郭GPU実行を確認できません');
  const bytes=await response.arrayBuffer(),header=new DataView(bytes);
  if(bytes.byteLength!==24+n*(op===1||op===4?12:4)||header.getUint32(0,true)!==0x43524754||
    header.getUint32(4,true)!==op||header.getUint32(8,true)!==n)throw Error('輪郭GPUの応答が不正です');
  this.timings[op]= {wallMs:performance.now()-start,nativeMs:header.getFloat64(bytes.byteLength-8,true)};
  if(op===4)return {target:new Float32Array(bytes,16,n),importance:new Float32Array(bytes,16+n*4,n),
   skeleton:Uint8Array.from(new Uint32Array(bytes,16+n*8,n)),regions,
   components:{length:header.getUint32(12,true)},strokes:{length:null},endpoints:{length:null},junctions:{length:null}};
  if(op===3)return Uint8Array.from(new Uint32Array(bytes,16,n));
  if(op===2)return new Float32Array(bytes,16,n);
  return {target:new Float32Array(bytes,16,n),gray:new Float32Array(bytes,16+n*4,n),
   dist:new Float32Array(bytes,16+n*8,n),w,h};
 }
}
