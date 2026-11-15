export class NativeGrid120{
 static async create(){
  if(!['127.0.0.1','localhost','[::1]'].includes(location.hostname))return null;
  const response=await fetch('/health',{signal:AbortSignal.timeout(100000)});
  if(!response.ok)return null;const h=await response.json();
  if(!h.grid120)return null;return new NativeGrid120(h);
 }
 constructor(h){this.adapterInfo={name:h.grid120Name,software:!!h.grid120Software,architecture:'Direct3D 11'};}
 async match(targets,atlas){
  const C=targets.length,G=atlas.length,D=targets[0].length,buffer=new ArrayBuffer(32+(C+G)*D*4);
  new Uint32Array(buffer,0,8).set([0x30324754,1,C,G,D,0,0,0]);
  const f=new Float32Array(buffer,32);let at=0;
  for(const v of [...targets,...atlas.map(g=>g.features)]){f.set(v,at);at+=D;}
  const r=await fetch('/api/mode4/grid120',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buffer,signal:AbortSignal.timeout(190000)});
  if(!r.ok)throw Error((await r.json()).error||'Native grid matching failed');
  const expected=this.adapterInfo.software?'WARP-Test':'DirectCompute-Grid120';
  if(r.headers.get('X-TASL-Compute-Backend')!==expected)throw Error('Grid120 GPU backend mismatch');
  const b=await r.arrayBuffer(),h=new Uint32Array(b,0,4);
  if(b.byteLength!==32+C*G*4||h[0]!==0x52324754||h[1]!==C||h[2]!==G||h[3]!==D)throw Error('Grid120 GPU result mismatch');
  const scores=new Float32Array(b,16,C*G),indices=[];
  for(let c=0;c<C;c++){let best=Infinity,index=0;for(let g=0;g<G;g++){const loss=scores[c*G+g];if(!Number.isFinite(loss))throw Error('Nonfinite GPU score');if(loss<best){best=loss;index=g;}}indices.push(index);}
  return indices;
 }
}
