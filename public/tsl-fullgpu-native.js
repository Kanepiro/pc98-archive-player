import {NativeLayoutTransfer} from './tsl-fullgpu-resident.js';
export class FullGpuNativeLayout {
 constructor(software=false,resident=true){this.software=software;this.transfer=new NativeLayoutTransfer(resident);}
 async compose(prepared,atlas){
  const {field,width,height,S,oldChars,oldGray}=prepared;
  const start=performance.now();
  let packed=this.transfer.pack(prepared,atlas);
  const send=()=>fetch('/api/mode4/gpu-layout',{method:'POST',body:packed.buffer,
   headers:{'Content-Type':'application/octet-stream'},signal:AbortSignal.timeout(190000)});
  let response=await send();
  // A different job may have acquired the single native stream. Reinitialize
  // with this frame's complete source/temporal state, never reuse another job.
  if(!response.ok&&(packed.op===2||packed.op===4)&&response.status===503){
   const reason=await response.clone().text();
   if(reason.includes('Resident session expired')){packed=this.transfer.pack(prepared,atlas,true);response=await send();}
  }
  const {cells,G}=packed;
  if(!response.ok)throw Error('全体組版GPU: '+(await response.text()).slice(0,450));
  const backend=response.headers.get('X-TASL-Compute-Backend');
  if(backend!=='DirectCompute-Global'&&!(this.software&&backend==='WARP-Test'))
   throw Error('全体組版のGPU実行を確認できません');
  const bytes=await response.arrayBuffer(),view=new DataView(bytes);
  if(bytes.byteLength!==cells*4+272||view.getUint32(0,true)!==0x344c4746||
   view.getUint32(4,true)!==width||view.getUint32(8,true)!==height||view.getUint32(12,true)!==G)
   throw Error('全体組版GPUの応答サイズが不正です');
  const ids=new Uint32Array(bytes,16,cells),rows=[],chars=new Array(cells).fill(null);
  for(let y=0;y<height;y++){
   let x=0,line='';
   while(x<width){
    const g=atlas[ids[y*width+x]];
    if(!g||x+g.columns>width)throw Error('全体組版GPUの文字幅が不正です');
    line+=g.char;chars[y*width+x]=g.char;
    for(let k=1;k<g.columns;k++){
     if(ids[y*width+x+k]!==0xffffffff)throw Error('全角文字の配置が重複しています');
     chars[y*width+x+k]='\0';
    }
    x+=g.columns;
   }
   rows.push(line);
  }
  const diagnosticOffset=16+cells*4,diag=new Float32Array(bytes,diagnosticOffset,16);
  const counts=new Uint32Array(bytes,diagnosticOffset,16),times=[];
  for(let k=0;k<8;k++)times.push(view.getFloat64(diagnosticOffset+64+k*8,true));
  for(const k of [4,5,6,7,8,9,10,11,12])if(!Number.isFinite(diag[k])||diag[k]<0)
   throw Error('全体組版GPUの評価値が不正です');
  if(diag[4]>diag[12]+.01)throw Error('全画面の再評価が悪化しました');
  const transferNames=['residentEnabled','residentBytes','h2dCalls','h2dBytes','d2hCalls','d2hBytes','gpuWaitMs','bufferAllocations','bufferReleases','staticUploads','ringSlot','dispatchCalls','processVramBytes','processVramBudgetBytes','residentFallbackReason','frameSequence'];
  const transfer={};transferNames.forEach((name,i)=>transfer[name]=view.getFloat64(cells*4+144+i*8,true));
  this.transfer.record(prepared,chars,transfer.residentEnabled);
  return {frame:rows.join('\r\n')+'\r\n',chars,
   diagnostics:{final:{total:diag[5]},blockAttempts:counts[0],blockAccepted:counts[1],
    critique:{tiles:counts[2],accepted:counts[3],before:{total:diag[12]},
     after:{total:diag[4],layout:diag[5],pixel:diag[6],missing:diag[7],extra:diag[8],edge:diag[10],drawn:diag[11]}}},
   perf:{orientationGpuMs:times[0],matchingGpuMs:times[1],candidateGpuMs:times[2],
    rowLayoutGpuMs:times[3],bandLayoutGpuMs:times[4],criticGpuMs:times[5],
    nativeWallMs:times[6],gpuArenaBytes:times[7],transportWallMs:performance.now()-start,
    backend,software:this.software,transfer,requestBytes:packed.buffer.byteLength}};
 }
}
