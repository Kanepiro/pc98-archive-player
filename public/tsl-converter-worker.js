import {rgbaToASCII} from './tsl-converter-core.js';
self.onmessage=({data:d})=>{
 try {self.postMessage({frame:rgbaToASCII(new Uint8ClampedArray(d.pixels),d.width,d.height,d.options)});}
 catch(e){self.postMessage({error:e.message});}
};
