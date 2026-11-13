// WebGPU image averaging, tonal mapping and spatial dither for Modes 1 & 2.
const AVG_SHADER="\nstruct Grid {width:u32,height:u32,sample:u32,mode:u32}\n@group(0) @binding(0) var<storage,read> pixels:array<u32>;\n@group(0) @binding(1) var<storage,read_write> colors:array<vec4f>;\n@group(0) @binding(2) var<uniform> grid:Grid;\n@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) id:vec3u){\n let cell=id.x;\n if(cell>=grid.width*grid.height){return;}\n let x=cell%grid.width;let y=cell/grid.width;let s=grid.sample;\n let stride=grid.width*s;\n var r:f32=0.0;var g:f32=0.0;var b:f32=0.0;\n for(var dy=0u;dy<s;dy++){\n  for(var dx=0u;dx<s;dx++){\n   let px=pixels[(y*s+dy)*stride+x*s+dx];\n   let alpha=f32((px>>24u)&255u)/255.0;\n   r+=f32(px&255u)*alpha;\n   g+=f32((px>>8u)&255u)*alpha;\n   b+=f32((px>>16u)&255u)*alpha;\n  }\n }\n let denom=f32(s*s);\n r/=denom;g/=denom;b/=denom;\n colors[cell]=vec4f(r,g,b,0.2126*r+0.7152*g+0.0722*b);\n}";
const TONE_SHADER="\nstruct Grid {width:u32,height:u32,sample:u32,mode:u32}\nstruct Tune {brightness:f32,contrast:f32,gamma:f32,edge:f32}\n@group(0) @binding(0) var<storage,read> colors:array<vec4f>;\n@group(0) @binding(1) var<storage,read_write> tones:array<u32>;\n@group(0) @binding(2) var<uniform> grid:Grid;\n@group(0) @binding(3) var<uniform> tune:Tune;\nconst BAYER:array<f32,16>=array<f32,16>(0.0,8.0,2.0,10.0,12.0,4.0,14.0,6.0,\n 3.0,11.0,1.0,9.0,15.0,7.0,13.0,5.0);\n@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) id:vec3u){\n let pos=id.x;\n let w=grid.width;let h=grid.height;\n if(grid.mode==2u){\n  let dots=w/2u;\n  if(pos>=dots*h){return;}\n  let x=pos%dots;let y=pos/dots;\n  let a=colors[y*w+2u*x].w;let b=colors[y*w+2u*x+1u].w;\n  let lum=(a+b)/(2.0*255.0);\n  let adjusted=clamp((lum-0.5)*tune.contrast+0.5+tune.brightness/100.0,0.0,1.0);\n  let value=1.0-pow(adjusted,tune.gamma);\n  let dither=(BAYER[(y%4u)*4u+(x%4u)]-7.5)/16.0*0.08;\n  let v=clamp(value+dither,0.0,1.0);\n  tones[pos]=min(4u,u32(floor(v*5.0)));\n }else{\n  if(pos>=w*h){return;}\n  let x=pos%w;let y=pos/w;let source=colors[pos];\n  var value=clamp((source.w-127.5)*tune.contrast+127.5+tune.brightness*2.55,0.0,255.0);\n  if(tune.edge>0.0){\n   var difference=0.0;\n   if(x>0u){\n    let left=colors[pos-1u];\n    difference=max(difference,max(abs(source.x-left.x),max(abs(source.y-left.y),abs(source.z-left.z))));\n   }\n   if(y>0u){\n    let above=colors[pos-w];\n    difference=max(difference,max(abs(source.x-above.x),max(abs(source.y-above.y),abs(source.z-above.z))));\n   }\n   let outline=36.0*tune.edge*clamp((difference-24.0)/112.0,0.0,1.0);\n   value=clamp(value+select(-outline,outline,value<128.0),0.0,255.0);\n  }\n  let corrected=255.0*pow(value/255.0,tune.gamma);\n  tones[pos]=min(15u,u32(floor(corrected*15.0/255.0+0.5)));\n }\n}";

import {CANDIDATE_RAMP,rgbaToASCII} from './tsl-converter-core.js';
import {HALFTONE_TONES,rgbaToHalftone} from './tsl-halftone.js';
export class GpuToneConverter {
 static async create(mode,sample,width,height){
  if(!['legacy','halftone'].includes(mode))throw Error('GPUの変換モードが不正');
  if(!globalThis.navigator?.gpu||!globalThis.GPUBufferUsage||!globalThis.GPUMapMode)return null;
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)return null;
  const device=await adapter.requestDevice();
  const converter=new GpuToneConverter(device,mode,sample,width,height);
  try{await converter.init();return converter;}catch(e){converter.dispose();throw e;}
 }
 constructor(device,mode,sample,width,height){
  Object.assign(this,{device,mode,sample,width,height,alive:true,acceleration:'WebGPU'});
  device.lost.then(()=>{this.alive=false;}).catch(()=>{this.alive=false;});
 }
 async init(){
  const {device,width,height,sample:S,mode}=this,usage=GPUBufferUsage;
  const pixels=width*height*S*S*4,colors=width*height*16;
  const count=mode==='halftone'?Math.floor(width/2)*height:width*height;
  this.count=count;
  if(pixels>device.limits.maxStorageBufferBindingSize||
     colors>device.limits.maxStorageBufferBindingSize)
   throw Error('GPU画像バッファが上限を超えています');
  this.pixelBuffer=device.createBuffer({size:pixels,usage:usage.STORAGE|usage.COPY_DST});
  this.colorsBuffer=device.createBuffer({size:colors,usage:usage.STORAGE});
  this.tonesBuffer=device.createBuffer({size:Math.max(4,count*4),usage:usage.STORAGE|usage.COPY_SRC});
  this.readBuffer=device.createBuffer({size:Math.max(4,count*4),usage:usage.COPY_DST|usage.MAP_READ});
  this.gridBuffer=device.createBuffer({size:16,usage:usage.UNIFORM|usage.COPY_DST});
  this.tuneBuffer=device.createBuffer({size:16,usage:usage.UNIFORM|usage.COPY_DST});
  device.queue.writeBuffer(this.gridBuffer,0,new Uint32Array([width,height,S,mode==='halftone'?2:1]));
  device.pushErrorScope('validation');
  try{
   const first=device.createShaderModule({code:AVG_SHADER});
   const second=device.createShaderModule({code:TONE_SHADER});
   this.avgPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:first,entryPoint:'main'}});
   this.tonePipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:second,entryPoint:'main'}});
   this.avgGroup=device.createBindGroup({layout:this.avgPipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:this.pixelBuffer}},
    {binding:1,resource:{buffer:this.colorsBuffer}},
    {binding:2,resource:{buffer:this.gridBuffer}}
   ]});
   this.toneGroup=device.createBindGroup({layout:this.tonePipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:this.colorsBuffer}},
    {binding:1,resource:{buffer:this.tonesBuffer}},
    {binding:2,resource:{buffer:this.gridBuffer}},
    {binding:3,resource:{buffer:this.tuneBuffer}}
   ]});
  }finally{
   const error=await device.popErrorScope();
   if(error)throw Error('GPU濃淡変換シェーダの検証に失敗: '+error.message);
  }
 }
 async convert(pixels,{brightness=0,contrast=1,gamma=1,edge=0,sample=this.sample,ramp=CANDIDATE_RAMP}={}){
  if(!this.alive)throw Error('WebGPUが使用できません');
  if(sample!==this.sample||pixels.byteLength!==this.width*this.height*sample*sample*4)
   throw Error('GPU画像の形式が不正');
  const {device}=this;
  device.queue.writeBuffer(this.pixelBuffer,0,pixels);
  device.queue.writeBuffer(this.tuneBuffer,0,new Float32Array([brightness,contrast,gamma,edge]));
  const encoder=device.createCommandEncoder(),a=encoder.beginComputePass();
  a.setPipeline(this.avgPipeline);a.setBindGroup(0,this.avgGroup);
  a.dispatchWorkgroups(Math.ceil(this.width*this.height/64));a.end();
  const b=encoder.beginComputePass();
  b.setPipeline(this.tonePipeline);b.setBindGroup(0,this.toneGroup);
  b.dispatchWorkgroups(Math.ceil(this.count/64));b.end();
  encoder.copyBufferToBuffer(this.tonesBuffer,0,this.readBuffer,0,this.count*4);
  device.queue.submit([encoder.finish()]);
  await this.readBuffer.mapAsync(GPUMapMode.READ);
  let indices;
  try{indices=new Uint32Array(this.readBuffer.getMappedRange().slice(0));}
  finally{this.readBuffer.unmap();}
  const lines=[],dotMode=this.mode==='halftone';
  const chars=dotMode?HALFTONE_TONES:ramp,count=dotMode?Math.floor(this.width/2):this.width;
  for(let y=0;y<this.height;y++){
   let line='';
   for(let x=0;x<count;x++)line+=chars[indices[y*count+x]];
   if(dotMode&&this.width%2)line+=' ';
   lines.push(line);
  }
  const gpuText=lines.join('\r\n')+'\r\n';
  // The original CPU formula is an output-equivalence oracle. A tiny fp32
  // threshold difference must not silently alter the art or halftone palette.
  const cpuText=dotMode?rgbaToHalftone(pixels,this.width,this.height,{brightness,contrast,gamma,sample})
   :rgbaToASCII(pixels,this.width,this.height,{brightness,contrast,gamma,edge,sample,ramp});
  if(gpuText!==cpuText){
   this.acceleration='CPU（GPU精度照合）';
   return cpuText;
  }
  this.acceleration='WebGPU';
  return gpuText;
 }
 dispose(){
  this.alive=false;
  for(const key of ['pixel','colors','tones','read','grid','tune'])
   try{this[key+'Buffer']?.destroy();}catch{}
  try{this.device.destroy();}catch{}
 }
}
