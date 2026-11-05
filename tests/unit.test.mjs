import {tslExportCandidates} from '../public/mp4-export.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {decodeMAG} from '../public/mag.js';
import {parseTSL,tslFrameAt} from '../public/tsl.js';
function mag({colors=16,copy=false}={}){
 const count=colors*3,base=32,a=32+count,b=a+2,p=b+(copy?2:0),bytes=new Uint8Array(base+p+4),v=new DataView(bytes.buffer);
 bytes.set(new TextEncoder().encode('MAKI02  '));bytes[31]=26;bytes[base+3]=colors===256?128:0;
 v.setUint16(base+8,colors===256?3:7,true);v.setUint16(base+10,copy?1:0,true);
 for(const [n,x]of [[12,a],[16,b],[20,copy?2:0],[24,p],[28,4]])v.setUint32(base+n,x,true);
 bytes.set([20,40,60],base+32+3);if(copy){bytes[base+a]=0x40;bytes[base+b]=0x44;}
 bytes.set(colors===16?[0x11,0x11,0x11,0x11]:[1,1,1,1],base+p);return bytes;
}
test('MAG 16/256 palette, GRB order and vertical flag XOR',()=>{
 for(const colors of [16,256])for(const copy of [false,true]){
  const image=decodeMAG(mag({colors,copy}));assert.equal(image.height,copy?2:1);assert.equal(image.width,colors===16?8:4);
  for(let p=0;p<image.rgba.length;p+=4)assert.deepEqual([...image.rgba.subarray(p,p+4)],[40,20,60,255]);
 }
});
test('MAG rejects truncated data and backward references before image',()=>{
 assert.throws(()=>decodeMAG(mag().subarray(0,100)));
 const b=mag({copy:true});b[32+80]=0x80;b[32+82]=0x44;assert.throws(()=>decodeMAG(b),/コピー/);
});
test('TSL absolute schedule boundary does not accumulate timer drift',()=>{
 const d=parseTSL('1\n2\n80\n25\n0\n0\nTitle\n\f\n1 30\n2 60\n0 0\n\f\nA\n\f\nB\n\f\n');
 assert.equal(d.duration,1.5);assert.equal(tslFrameAt(d,.499),0);assert.equal(tslFrameAt(d,.5),1);assert.equal(tslFrameAt(d,1.5),1);
});
test('AudioWorklet preserves PCM across arbitrary block boundaries and reports underruns',async()=>{
 let Klass;class Base{constructor(){this.messages=[];this.port={postMessage:d=>this.messages.push(d)};}}
 const scope={AudioWorkletProcessor:Base,sampleRate:48000,currentTime:0,registerProcessor:(name,k)=>Klass=k};
 vm.runInNewContext(await readFile('public/pcm-worklet.js','utf8'),scope);
 const p=new Klass(),source={start(){},close(){},postMessage(){}};
 p.port.onmessage({data:{type:'connect',port:source}});
 const samples=Float32Array.from({length:300},(_,i)=>(i-150)/300);
 source.onmessage({data:{type:'pcm',pcm:samples.subarray(0,100)}});
 source.onmessage({data:{type:'pcm',pcm:samples.subarray(100)}});
 source.onmessage({data:{type:'end'}});source.onmessage({data:{type:'start'}});
 const got=[];for(let i=0;i<3;i++){const block=new Float32Array(128);p.process([],[ [block] ]);got.push(...block);}
 assert.deepEqual(got.slice(0,300),[...samples]);assert.ok(got.slice(300).every(x=>x===0));
 assert.equal(p.underruns,0);assert.equal(p.played,300);assert.equal(p.messages.at(-1).type,'ended');
});

test('TSL accepts real long animations exceeding the old 300-frame limit',()=>{
 const n=1178,text='1.08\n'+n+'\n79\n27\n1\n-1\n\f\n1 1\n1178 2\n0 0\n\f\n'+Array(n).fill('A\n').join('\f\n')+'\f\n';
 const d=parseTSL(text);assert.equal(d.frames.length,n);assert.equal(tslFrameAt(d,.02),1177);
});


test('Portrait TSL MP4 prefers native 1080x1920 and preserves portrait in fallback',()=>{
  assert.deepEqual(tslExportCandidates(1080,1920),[
    {width:1080,height:1920},
    {width:720,height:1280},
    {width:406,height:720},
  ]);
});

test('Landscape TSL MP4 preserves aspect ratio and avoids duplicate fallback sizes',()=>{
  const sizes=tslExportCandidates(1920,1200);
  assert.deepEqual(sizes,[{width:1728,height:1080},{width:1152,height:720}]);
  assert.deepEqual(tslExportCandidates(640,400),[{width:640,height:400}]);
});
