export class NativeContour {
 constructor(software=false){this.software=software;this.timings={};}
 async run(op,w,h,input,options={}){
  const n=w*h,buffer=new ArrayBuffer(32+n*4),v=new DataView(buffer);
  [0x43504754,op,w,h].forEach((x,i)=>v.setUint32(i*4,x,true));
  [options.brightness??0,options.contrast??1,options.gamma??1].forEach((x,i)=>v.setFloat32(16+i*4,x,true));
  if(op===1)new Uint8Array(buffer,32).set(input);
  else if(op===2)new Float32Array(buffer,32).set(input);
  else new Uint32Array(buffer,32).set(input);
  const start=performance.now();
  const response=await fetch('/api/mode4/gpu-contour',{method:'POST',body:buffer,
   headers:{'Content-Type':'application/octet-stream'},signal:AbortSignal.timeout(190000)});
  if(!response.ok)throw Error('輪郭GPU: '+(await response.text()).slice(0,400));
  const backend=response.headers.get('X-TASL-Compute-Backend');
  if(backend!=='DirectCompute-Global'&&!(this.software&&backend==='WARP-Test'))throw Error('輪郭GPU実行を確認できません');
  const bytes=await response.arrayBuffer(),header=new DataView(bytes);
  if(bytes.byteLength!==24+n*(op===1?12:4)||header.getUint32(0,true)!==0x43524754||
    header.getUint32(4,true)!==op||header.getUint32(8,true)!==n)throw Error('輪郭GPUの応答が不正です');
  this.timings[op]= {wallMs:performance.now()-start,nativeMs:header.getFloat64(bytes.byteLength-8,true)};
  if(op===3)return Uint8Array.from(new Uint32Array(bytes,16,n));
  if(op===2)return new Float32Array(bytes,16,n);
  return {target:new Float32Array(bytes,16,n),gray:new Float32Array(bytes,16+n*4,n),
   dist:new Float32Array(bytes,16+n*8,n),w,h};
 }
}
