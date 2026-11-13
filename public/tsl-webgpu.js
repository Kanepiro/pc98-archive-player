import {requireHardwareAdapter} from './tsl-gpu-device.js';
// GPU-assisted Mode 3 glyph correlation. Only the expensive independent
// template dot-products run on WebGPU; the original CPU contour tracer,
// dynamic-programming layout and temporal logic remain authoritative.
const SHADER=`
struct Params { width:u32, height:u32, sample:u32, glyphs:u32 }
@group(0) @binding(0) var<storage,read> imageValues: array<f32>;
@group(0) @binding(1) var<storage,read> masks: array<f32>;
@group(0) @binding(2) var<storage,read> columns: array<u32>;
@group(0) @binding(3) var<storage,read_write> dots: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let count=params.width*params.height*params.glyphs;
 let task=id.x;
 if(task>=count){return;}
 let glyph=task%params.glyphs;
 let cell=task/params.glyphs;
 let x=cell%params.width;
 let y=cell/params.width;
 let cols=columns[glyph];
 if(x+cols>params.width){ dots[task]=0.0; return; }
 let s=params.sample;
 let rowWidth=params.width*s;
 let maskRow=2u*s;
 let maskBase=glyph*2u*s*s;
 var sum=0.0;
 for(var py=0u;py<s;py=py+1u){
  for(var px=0u;px<cols*s;px=px+1u){
   sum=sum+imageValues[(y*s+py)*rowWidth+x*s+px]*masks[maskBase+py*maskRow+px];
  }
 }
 dots[task]=sum;
}`;
export class Mode3GpuMatcher {
 static async create(atlas,sample,width,height){
  if(!globalThis.navigator?.gpu || !globalThis.GPUBufferUsage || !globalThis.GPUMapMode)return null;
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)return null;
  const adapterInfo=requireHardwareAdapter(adapter);
  const device=await adapter.requestDevice();
  const matcher=new Mode3GpuMatcher(device,atlas,sample,width,height);
  matcher.adapterInfo=adapterInfo;
  try{await matcher.init();return matcher;}
  catch(e){matcher.dispose();throw e;}
 }
 constructor(device,atlas,sample,width,height){
  Object.assign(this,{device,atlas,sample,width,height,alive:true});
  device.lost.then(()=>{this.alive=false;}).catch(()=>{this.alive=false;});
 }
 async init(){
  const {device,atlas,sample:S,width,height}=this;
  const count=width*height*atlas.length;
  const maxBinding=device.limits.maxStorageBufferBindingSize;
  const maskData=new Float32Array(atlas.length*2*S*S);
  const colsData=new Uint32Array(atlas.length);
  for(let i=0;i<atlas.length;i++){
   const glyph=atlas[i],cols=glyph.columns;
   colsData[i]=cols;
   for(let y=0;y<S;y++)for(let x=0;x<cols*S;x++)
    maskData[i*2*S*S+y*2*S+x]=glyph.mask[y*cols*S+x];
  }
  const inputBytes=width*height*S*S*4,outputBytes=count*4;
  if(inputBytes>maxBinding||outputBytes>maxBinding)throw Error('GPUバッファの上限を超えています');
  const use=GPUBufferUsage;
  const storage=(size,extra=0)=>device.createBuffer({size,usage:use.STORAGE|extra});
  this.targetBuffer=storage(inputBytes,use.COPY_DST);
  this.maskBuffer=storage(maskData.byteLength,use.COPY_DST);
  this.columnBuffer=storage(colsData.byteLength,use.COPY_DST);
  this.dotBuffer=storage(outputBytes,use.COPY_SRC);
  this.readBuffer=device.createBuffer({size:outputBytes,usage:use.COPY_DST|use.MAP_READ});
  this.paramBuffer=device.createBuffer({size:16,usage:use.UNIFORM|use.COPY_DST});
  device.queue.writeBuffer(this.maskBuffer,0,maskData);
  device.queue.writeBuffer(this.columnBuffer,0,colsData);
  device.queue.writeBuffer(this.paramBuffer,0,new Uint32Array([width,height,S,atlas.length]));
  device.pushErrorScope('validation');
  try{
   const module=device.createShaderModule({code:SHADER});
   this.pipeline=await device.createComputePipelineAsync({
    layout:'auto',compute:{module,entryPoint:'main'}
   });
   this.bindGroup=device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:this.targetBuffer}},
    {binding:1,resource:{buffer:this.maskBuffer}},
    {binding:2,resource:{buffer:this.columnBuffer}},
    {binding:3,resource:{buffer:this.dotBuffer}},
    {binding:4,resource:{buffer:this.paramBuffer}}
   ]});
  }finally{
   const err=await device.popErrorScope();
   if(err)throw Error('GPU shader validation failed: '+err.message);
  }
  this.count=count;
 }
 async compute(target){
  if(!this.alive)throw Error('GPUデバイスを利用できません');
  if(target.length!==this.width*this.height*this.sample*this.sample)throw Error('GPU入力サイズが違います');
  const {device}=this;
  device.queue.writeBuffer(this.targetBuffer,0,target);
  const encoder=device.createCommandEncoder();
  const pass=encoder.beginComputePass();
  pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(this.count/64));
  pass.end();
  encoder.copyBufferToBuffer(this.dotBuffer,0,this.readBuffer,0,this.count*4);
  device.queue.submit([encoder.finish()]);
  await this.readBuffer.mapAsync(GPUMapMode.READ);
  try{return new Float32Array(this.readBuffer.getMappedRange().slice(0));}
  finally{this.readBuffer.unmap();}
 }
 dispose(){
  this.alive=false;
  for(const key of ['targetBuffer','maskBuffer','columnBuffer','dotBuffer','readBuffer','paramBuffer']){
   try{this[key]?.destroy();}catch{}
  }
  this.device.destroy();
 }
}
