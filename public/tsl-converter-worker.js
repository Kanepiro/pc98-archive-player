import {rgbaToASCII} from './tsl-converter-core.js';
import {rgbaToOutline} from './tsl-outline.js';
self.onmessage=({data:d})=>{
 try {self.postMessage({frame:d.options.conversionMode==='outline'?rgbaToOutline(new Uint8ClampedArray(d.pixels),d.width,d.height,d.options):rgbaToASCII(new Uint8ClampedArray(d.pixels),d.width,d.height,d.options)});}
 catch(e){self.postMessage({error:e.message});}
};
