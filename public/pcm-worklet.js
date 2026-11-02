class PcmOutput extends AudioWorkletProcessor {
 constructor(){
  super();this.queue=[];this.offset=0;this.played=0;this.underruns=0;this.gaps=0;this.running=false;this.eof=false;this.closed=false;this.nextReport=0;
  this.port.onmessage=({data:d})=>{
   if(d.type==='connect'){
    this.source=d.port;this.source.onmessage=({data:m})=>{
     if(this.closed)return;
     if(m.type==='pcm')this.queue.push(m.pcm);
     else if(m.type==='start')this.running=true;
     else if(m.type==='end')this.eof=true;
     else if(m.type==='abort'){this.queue=[];this.closed=true;this.running=false;}
    };this.source.start();
   }else if(d.type==='stop'){this.running=false;this.closed=true;this.queue=[];this.source?.close();}
  };
 }
 process(inputs,outputs){
  const out=outputs[0][0];out.fill(0);if(this.closed)return false;
  if(!this.running)return true;
  let written=0;
  while(written<out.length&&this.queue.length){
   const head=this.queue[0],n=Math.min(out.length-written,head.length-this.offset);
   out.set(head.subarray(this.offset,this.offset+n),written);written+=n;this.offset+=n;this.played+=n;
   if(this.offset===head.length){this.queue.shift();this.offset=0;if(!this.eof)this.source.postMessage({type:'need'});}
  }
  if(written<out.length&&!this.eof){this.underruns++;this.gaps+=out.length-written;}
  if(this.played>=this.nextReport){
   this.port.postMessage({type:'clock',seconds:this.played/sampleRate,contextTime:currentTime+written/sampleRate,underruns:this.underruns,gapSamples:this.gaps});
   this.nextReport=this.played+Math.round(sampleRate/120);
  }
  if(this.eof&&!this.queue.length){
   this.port.postMessage({type:'ended',seconds:this.played/sampleRate,contextTime:currentTime+written/sampleRate,underruns:this.underruns,gapSamples:this.gaps});
   this.closed=true;this.source.close();return false;
  }
  return true;
 }
}
registerProcessor('pc98-pcm',PcmOutput);
