import {HALFTONE_TONES} from './tsl-halftone.js';
// Windows-only binary DirectCompute transport. No browser GPU, CPU image pass,
// or CPU/GPU equality gate is used on this path.
export class NativeModeConverter {
 static async create(mode,sample,width,height,atlas=null){
  if(!['127.0.0.1','localhost','[::1]'].includes(location.hostname))throw Error('Windowsローカルアプリが必要です');
  const response=await fetch('/health',{signal:AbortSignal.timeout(100000)});
  if(!response.ok)throw Error('Windows GPUサービスに接続できません');
  const health=await response.json();
  if(!health.nativeModes)throw Error(health.modesReason||'DirectComputeを使用できません');
  return new NativeModeConverter(mode,sample,width,height,atlas,health);
 }
 constructor(mode,sample,width,height,atlas,health){
  this.mode=mode;this.sample=sample;this.width=width;this.height=height;this.atlas=atlas;
  this.adapterInfo={name:health.modesName,identified:true,architecture:'Direct3D 11',software:!!health.modesSoftware};
  this.acceleration=health.modesSoftware?'WARP Test Modes':'DirectCompute Modes';
  this.lastPerf=null;this.disposed=false;
 }
 dispose(){this.disposed=true;}
 async convert(pixels,options={},previous=null,prevGlyphs=null){
  if(this.disposed)throw Error('Native converter disposed');
  const started=performance.now(),W=this.width,H=this.height,S=this.sample,C=W*H,N=C*S*S;
  const G=this.mode===3?this.atlas.length:0;
  const old=!!(G&&previous&&previous.target.length===N&&previous.gray.length===N&&prevGlyphs?.length===C);
  if(pixels.length!==N*4)throw Error('Native mode pixel dimensions');
  const words=16+N+(G?G*(2+2*S*S):0)+(old?2*N+C:0);
  const buffer=new ArrayBuffer(words*4),u=new Uint32Array(buffer),f=new Float32Array(buffer);
  u.set([0x4d475354,1,this.mode,W,H,S,G,+old]);
  f.set([options.brightness??0,options.contrast??1,options.gamma??1,options.edge??0],8);
  u[12]=G?this.atlas.findIndex(a=>a.char===' '):0;
  new Uint8Array(buffer,64,N*4).set(pixels);
  let offset=16+N;
  if(G){
   u.set(this.atlas.map(a=>a.columns),offset);offset+=G;
   for(const glyph of this.atlas){f.set(glyph.mask,offset);offset+=2*S*S;}
   f.set(this.atlas.map(a=>a.squares??Array.from(a.mask).reduce((n,v)=>n+v*v,0)),offset);offset+=G;
   if(old){
    f.set(previous.target,offset);offset+=N;f.set(previous.gray,offset);offset+=N;
    const map=new Map(this.atlas.map((a,i)=>[a.char,i]));
    for(let i=0;i<C;i++)u[offset+i]=map.get(prevGlyphs[i])??0xffffffff;
   }
  }
  const response=await fetch('/api/modes/convert',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buffer,signal:AbortSignal.timeout(190000)});
  if(!response.ok)throw Error((await response.json().catch(()=>null))?.error||'DirectCompute変換に失敗しました');
  const backend=response.headers.get('X-TASL-Compute-Backend');
  if(backend!==(this.adapterInfo.software?'WARP-Test':'DirectCompute-Modes'))throw Error('Native backend identity mismatch');
  const result=await response.arrayBuffer(),expected=48+C*4+(G?N*8:0);
  if(result.byteLength!==expected)throw Error('Native mode result length');
  const h=new Uint32Array(result,0,8);
  if(h[0]!==0x52475354||h[1]!==1||h[2]!==this.mode||h[3]!==W||h[4]!==H||h[5]!==G||h[6]!==N||h[7]!==C)throw Error('Native mode result header');
  const indices=new Uint32Array(result,32,C),rows=[],chars=new Array(C).fill(null);
  const ramp=Array.from(options.ramp||' .:|/(%YVO8D@0#$');
  for(let y=0;y<H;y++){
   let row='';
   if(this.mode===2){
    for(let x=0;x<Math.floor(W/2);x++){
     const idx=indices[y*Math.floor(W/2)+x];if(idx>=HALFTONE_TONES.length)throw Error('Native halftone index');
     row+=HALFTONE_TONES[idx];
    }
    if(W%2)row+=' ';
   }else for(let x=0;x<W;){
    const idx=indices[y*W+x];
    if(G){
     const glyph=this.atlas[idx];if(!glyph||x+glyph.columns>W)throw Error('Native glyph placement');
     row+=glyph.char;chars[y*W+x]=glyph.char;
     for(let c=1;c<glyph.columns;c++){if(indices[y*W+x+c]!==0xffffffff)throw Error('Native glyph continuation');chars[y*W+x+c]='\0';}
     x+=glyph.columns;
    }else{
     if(idx>=ramp.length)throw Error('Native tone index');row+=ramp[idx];x++;
    }
   }
   rows.push(row);
  }
  const timing=new DataView(result,result.byteLength-16,16);
  this.lastPerf={backend:this.acceleration,gpuTimestampMs:timing.getFloat64(0,true),nativeWallMs:timing.getFloat64(8,true),transportWallMs:performance.now()-started,
   stages:G?'normalize,gaussian,edges,connectivity,target,temporal,glyph-score,row-layout':'sample,tone,outline'};
  const frame=rows.join('\r\n')+'\r\n';
  if(!G)return frame;
  const target=new Float32Array(result,32+C*4,N),gray=new Float32Array(result,32+C*4+N*4,N);
  for(let i=0;i<N;i++)if(!Number.isFinite(target[i])||!Number.isFinite(gray[i]))throw Error('Native nonfinite output');
  return {frame,state:{target,gray,cut:false},chars};
 }
}
