import {requireHardwareAdapter} from './tsl-gpu-device.js';
// WebGPU Mode 4: independent loss for every candidate glyph, keeping original CPU AA layout.
const SHADER="\nstruct Params { width:u32, height:u32, sample:u32, glyphs:u32,\n hasOld:u32, cut:u32, groupsX:u32, reserved:u32 }\n@group(0) @binding(0) var<storage,read> image:array<vec4f>;\n@group(0) @binding(1) var<storage,read> previous:array<f32>;\n@group(0) @binding(2) var<storage,read> glyphPixels:array<vec2f>;\n@group(0) @binding(3) var<storage,read> glyphInfo:array<vec4f>;\n@group(0) @binding(4) var<storage,read> glyphOrient:array<vec4f>;\n@group(0) @binding(5) var<storage,read> localOrient:array<vec4f>;\n@group(0) @binding(6) var<storage,read> cellInfo:array<vec2u>;\n@group(0) @binding(7) var<storage,read_write> scores:array<f32>;\n@group(0) @binding(8) var<uniform> params:Params;\n@compute @workgroup_size(64)\nfn main(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u){\n let task=(wg.y*params.groupsX+wg.x)*64u+lid.x;\n let count=params.width*params.height*params.glyphs;\n if(task>=count){return;}\n let j=task%params.glyphs;\n let cell=task/params.glyphs;\n let x=cell%params.width;\n let y=cell/params.width;\n let glyphData=glyphInfo[j];\n let cols=u32(glyphData.x);\n let s=params.sample;\n if(x+cols>params.width){scores[task]=1e20;return;}\n let w=params.width*s;\n let glyphBase=j*2u*s*s;\n let total=f32(cols*s*s);\n var ink:f32=0.0;\n var miss:f32=0.0;\n var surplus:f32=0.0;\n var square:f32=0.0;\n var drift:f32=0.0;\n let history=params.hasOld!=0u&&params.cut==0u&&cellInfo[cell].x==j;\n for(var py:u32=0u;py<s;py++){\n  for(var px:u32=0u;px<cols*s;px++){\n   let ip=(y*s+py)*w+x*s+px;\n   let gm=glyphPixels[glyphBase+py*2u*s+px];\n   let v=image[ip];\n   let priority=select(1.0,v.y,v.y>0.0);\n   let t=v.x;\n   ink+=t*priority;\n   miss+=priority*t*(1.0-gm.y);\n   surplus+=min(1.9,priority)*gm.x*min(1.0,v.z/2.4);\n   square+=priority*(t-gm.x)*(t-gm.x);\n   if(history){drift+=abs(v.w-previous[ip]);}\n  }\n }\n let density=ink/total;\n if(j!=0u&&density<0.008){scores[task]=1e20;return;}\n var score=(1.85*miss+0.62*surplus+0.19*square)/total;\n if(j!=0u&&ink>0.5){\n  let originOrient=glyphOrient[j];\n  let targetOrient=localOrient[cell*2u+(cols-1u)];\n  let orientError=abs(originOrient.x-targetOrient.x)+abs(originOrient.y-targetOrient.y)+abs(originOrient.z-targetOrient.z)+abs(originOrient.w-targetOrient.w);\n  score+=0.038*min(1.0,density*13.0)*orientError;\n }\n if(j!=0u){\n  score+=0.0025+glyphData.y;\n  if(glyphData.z<0.5&&cellInfo[cell].y!=0u){score+=0.07;}\n }\n if(history&&drift/total<0.065&&density>0.025){score-=0.004;}\n scores[task]=max(0.0,score);\n}";

const PRE_ORIENTATION_SHADER="\nstruct Params {width:u32,height:u32,sample:u32,glyphs:u32,hasOld:u32,cut:u32,groupsX:u32,reserved:u32}\n@group(0) @binding(0) var<storage,read> image:array<vec4f>;\n@group(0) @binding(1) var<storage,read_write> partial:array<vec4f>;\n@group(0) @binding(2) var<uniform> params:Params;\nfn localSample(x:u32,y:u32,px:i32,py:i32,cols:u32)->f32{\n if(px<0||py<0||px>=i32(cols*params.sample)||py>=i32(params.sample)){return 0.0;}\n let w=params.width*params.sample;\n return image[(y*params.sample+u32(py))*w+x*params.sample+u32(px)].x;\n}\n@compute @workgroup_size(64)\nfn main(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){\n let idx=(group.y*params.groupsX+group.x)*64u+lane.x;\n let per=2u*params.sample*params.sample;\n let count=params.width*params.height*2u*per;\n if(idx>=count){return;}\n let shape=idx/per;\n let cell=shape/2u;\n let cols=shape%2u+1u;\n let p=idx%per;\n let x=cell%params.width;\n let y=cell/params.width;\n if(x+cols>params.width||p>=cols*params.sample*params.sample){\n  partial[idx]=vec4f(0.0);return;\n }\n let stride=cols*params.sample;\n let xx=i32(p%stride);let yy=i32(p/stride);\n let v=localSample(x,y,xx,yy,cols);\n if(v<0.16){partial[idx]=vec4f(0.0);return;}\n let left=localSample(x,y,xx-1,yy,cols);\n let right=localSample(x,y,xx+1,yy,cols);\n let ul=localSample(x,y,xx-1,yy-1,cols);\n let dr=localSample(x,y,xx+1,yy+1,cols);\n let up=localSample(x,y,xx,yy-1,cols);\n let dn=localSample(x,y,xx,yy+1,cols);\n let ur=localSample(x,y,xx+1,yy-1,cols);\n let dl=localSample(x,y,xx-1,yy+1,cols);\n partial[idx]=v*min(vec4f(1.0),0.65*vec4f(\n  left+right,ul+dr,up+dn,ur+dl));\n}\n";
const REDUCE_ORIENTATION_SHADER="\nstruct Params {width:u32,height:u32,sample:u32,glyphs:u32,hasOld:u32,cut:u32,groupsX:u32,reserved:u32}\n@group(0) @binding(0) var<storage,read> partial:array<vec4f>;\n@group(0) @binding(1) var<storage,read_write> output:array<vec4f>;\n@group(0) @binding(2) var<uniform> params:Params;\n@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) id:vec3u){\n let shape=id.x;\n if(shape>=params.width*params.height*2u){return;}\n let per=2u*params.sample*params.sample;\n let cols=shape%2u+1u;\n let count=cols*params.sample*params.sample;\n let start=shape*per;\n var total=vec4f(0.0);\n for(var i=0u;i<count;i++){total+=partial[start+i];}\n let sum=total.x+total.y+total.z+total.w;\n if(sum>0.0){total/=sum;}\n output[shape]=total;\n}\n";
export class Mode4GpuMatcher {
 static async create(atlas,sample,width,height){
  if(!globalThis.navigator?.gpu||!globalThis.GPUBufferUsage||!globalThis.GPUMapMode)return null;
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)return null;
  const adapterInfo=requireHardwareAdapter(adapter);
  const device=await adapter.requestDevice();
  const obj=new Mode4GpuMatcher(device,atlas,sample,width,height);
  obj.adapterInfo=adapterInfo;
  try{await obj.init();return obj;}catch(e){obj.dispose();throw e;}
 }
 constructor(device,atlas,sample,width,height){
  Object.assign(this,{device,atlas,sample,width,height,alive:true});
  device.lost.then(()=>{this.alive=false;}).catch(()=>{this.alive=false;});
 }
 async init(){
  const {device,atlas,sample:S,width,height}=this;
  if(device.limits.maxStorageBuffersPerShaderStage<8)throw Error('WebGPUのストレージ枠が不足');
  const cellCount=width*height,n=atlas.length,total=cellCount*n;
  const use=GPUBufferUsage;
  const storage=(size,extra=0)=>device.createBuffer({size,usage:use.STORAGE|extra});
  const mask=new Float32Array(n*2*S*S*2);
  const meta=new Float32Array(n*4),orient=new Float32Array(n*4);
  for(let j=0;j<n;j++){
   const g=atlas[j],cols=g.columns;
   meta.set([cols,g.detailPenalty||0,g.shapeSymbol?1:0,0],j*4);
   orient.set(g.orientation,j*4);
   for(let y=0;y<S;y++)for(let x=0;x<cols*S;x++){
    const a=(j*2*S*S+y*2*S+x)*2,b=y*cols*S+x;
    mask[a]=g.mask[b];mask[a+1]=g.expanded[b];
   }
  }
  const countPixels=cellCount*S*S;
  const sizes={image:countPixels*16,previous:countPixels*4,
   glyphPixels:mask.byteLength,glyphInfo:meta.byteLength,glyphOrient:orient.byteLength,
   localOrient:cellCount*8*4,cellInfo:cellCount*2*4,scores:total*4,
   partials:cellCount*4*S*S*16};
  for(const [key,size] of Object.entries(sizes))
   if(size>device.limits.maxStorageBufferBindingSize)throw Error('GPUバッファ上限: '+key);
  const groupsX=Math.min(device.limits.maxComputeWorkgroupsPerDimension,Math.ceil(total/64));
  const groupsY=Math.ceil(total/(groupsX*64));
  if(groupsY>device.limits.maxComputeWorkgroupsPerDimension)throw Error('GPU計算グループの上限');
  this.groupsX=groupsX;this.groupsY=groupsY;
  this.partialGroupsY=Math.ceil((cellCount*4*S*S)/(groupsX*64));
  if(this.partialGroupsY>device.limits.maxComputeWorkgroupsPerDimension)
   throw Error('GPU線方向計算グループの上限');
  for(const [key,size] of Object.entries(sizes)){
   const extra=key==='scores'?use.COPY_SRC:key==='glyphPixels'||key==='glyphInfo'||key==='glyphOrient'||
    key==='image'||key==='previous'||key==='localOrient'||key==='cellInfo'?use.COPY_DST:0;
   this[key+'Buffer']=storage(size,extra);
  }
  this.readBuffer=device.createBuffer({size:sizes.scores,usage:use.COPY_DST|use.MAP_READ});
  this.paramBuffer=device.createBuffer({size:32,usage:use.UNIFORM|use.COPY_DST});
  device.queue.writeBuffer(this.glyphPixelsBuffer,0,mask);
  device.queue.writeBuffer(this.glyphInfoBuffer,0,meta);
  device.queue.writeBuffer(this.glyphOrientBuffer,0,orient);
  device.pushErrorScope('validation');
  try{
   const module=device.createShaderModule({code:SHADER});
   this.pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
   const names=['image','previous','glyphPixels','glyphInfo','glyphOrient','localOrient','cellInfo','scores','param'];
   this.bindGroup=device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),
    entries:names.map((key,i)=>({binding:i,resource:{buffer:this[key+'Buffer']}}))});
   const preModule=device.createShaderModule({code:PRE_ORIENTATION_SHADER});
   this.preOrientationPipeline=await device.createComputePipelineAsync({
    layout:'auto',compute:{module:preModule,entryPoint:'main'}
   });
   this.preOrientationGroup=device.createBindGroup({
    layout:this.preOrientationPipeline.getBindGroupLayout(0),
    entries:[
     {binding:0,resource:{buffer:this.imageBuffer}},
     {binding:1,resource:{buffer:this.partialsBuffer}},
     {binding:2,resource:{buffer:this.paramBuffer}}
    ]
   });
   const reduceModule=device.createShaderModule({code:REDUCE_ORIENTATION_SHADER});
   this.reduceOrientationPipeline=await device.createComputePipelineAsync({
    layout:'auto',compute:{module:reduceModule,entryPoint:'main'}
   });
   this.reduceOrientationGroup=device.createBindGroup({
    layout:this.reduceOrientationPipeline.getBindGroupLayout(0),
    entries:[
     {binding:0,resource:{buffer:this.partialsBuffer}},
     {binding:1,resource:{buffer:this.localOrientBuffer}},
     {binding:2,resource:{buffer:this.paramBuffer}}
    ]
   });  }finally{
   const err=await device.popErrorScope();
   if(err)throw Error('WebGPU字形照合の検証エラー: '+err.message);
  }
  this.count=total;
 }
 async compute(field,oldChars,oldGray){
  if(!this.alive)throw Error('GPUが使用できなくなりました');
  const {device,width,height,sample:S,atlas}=this,cellCount=width*height,px=cellCount*S*S;
  const image=new Float32Array(px*4);
  for(let i=0;i<px;i++){
   image[i*4]=field.target[i];image[i*4+1]=field.importance[i];
   image[i*4+2]=field.dist[i];image[i*4+3]=field.gray[i];
  }
  const history=oldGray?.length===px?oldGray:new Float32Array(px);
  const ci=new Uint32Array(cellCount*2),index=new Map(atlas.map((a,i)=>[a.char,i]));
  const faces=field.faces||[];
  for(let i=0;i<cellCount;i++){
   ci[i*2]=index.get(oldChars?.[i])??0xffffffff;
   const x=(i%width+.5)/width,y=(Math.floor(i/width)+.5)/height;
   if(faces.some(f=>x>=f.x-f.w*.15&&x<=f.x+f.w*1.15&&
      y>=f.y-f.h*.2&&y<=f.y+f.h*1.25))ci[i*2+1]=1;
  }
  device.queue.writeBuffer(this.imageBuffer,0,image);
  device.queue.writeBuffer(this.previousBuffer,0,history);
  device.queue.writeBuffer(this.cellInfoBuffer,0,ci);
  device.queue.writeBuffer(this.paramBuffer,0,new Uint32Array([
   width,height,S,atlas.length,oldGray?.length===px?1:0,field.cut?1:0,this.groupsX,0]));
  const encoder=device.createCommandEncoder();
  // Parallelize source tangent extraction per pixel, then reduce to per-cell
  // orientations. This avoids giant nested per-cell shaders on older GPUs.
  const pre=encoder.beginComputePass();
  pre.setPipeline(this.preOrientationPipeline);
  pre.setBindGroup(0,this.preOrientationGroup);
  pre.dispatchWorkgroups(this.groupsX,this.partialGroupsY);
  pre.end();
  const reduce=encoder.beginComputePass();
  reduce.setPipeline(this.reduceOrientationPipeline);
  reduce.setBindGroup(0,this.reduceOrientationGroup);
  reduce.dispatchWorkgroups(Math.ceil(cellCount*2/64));
  reduce.end();
  const pass=encoder.beginComputePass();
  pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);
  pass.dispatchWorkgroups(this.groupsX,this.groupsY);pass.end();
  encoder.copyBufferToBuffer(this.scoresBuffer,0,this.readBuffer,0,this.count*4);
  device.queue.submit([encoder.finish()]);
  await this.readBuffer.mapAsync(GPUMapMode.READ);
  try{return new Float32Array(this.readBuffer.getMappedRange().slice(0));}
  finally{this.readBuffer.unmap();}
 }
 dispose(){
  this.alive=false;
  for(const key of ['image','previous','glyphPixels','glyphInfo','glyphOrient',
   'localOrient','cellInfo','scores','partials','read','param']){
   try{this[key+'Buffer']?.destroy();}catch{}
  }
  try{this.device.destroy();}catch{}
 }
}
