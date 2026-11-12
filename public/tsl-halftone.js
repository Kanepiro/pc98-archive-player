// Mode 2: three-tone newspaper halftone, encoded as CP932 / Shift-JIS TSL.
// All visible marks use exactly two full-width, centered, filled circles:
// middle dot (・) and black circle (●). The remaining tone is blank.
// The output uses two terminal columns per dot, matching a square 24x24 cell.
export const HALFTONE_GLYPHS=Object.freeze({
 '　':[0x81,0x40], // Full-width blank: 2 columns, black background.
 '・':[0x81,0x45], // Small filled dot: 2 columns.
 '●':[0x81,0x9c], // Large filled circle: 2 columns.
 ' ':[0x20]       // Trailing blank for odd-width legacy PC-98 grids.
});
const BAYER4=Object.freeze([
 0, 8, 2,10,
 12,4,14,6,
 3,11,1,9,
 15,7,13,5
]);
const clamp=(x)=>Math.max(0,Math.min(1,x));

export function halftoneColumns(line){
 let n=0;
 for(const char of line){
  const bytes=HALFTONE_GLYPHS[char];
  if(!bytes)throw Error('モード2で使用できない文字です: '+char);
  n+=bytes.length;
 }
 return n;
}

export function encodeHalftoneFrame(lines){
 const size=lines.reduce((n,line)=>n+halftoneColumns(line)+2,0)+3;
 const bytes=new Uint8Array(size);
 let offset=0;
 for(const line of lines){
  for(const char of line)for(const b of HALFTONE_GLYPHS[char])bytes[offset++]=b;
  bytes[offset++]=13;bytes[offset++]=10;
 }
 bytes[offset++]=12;bytes[offset++]=13;bytes[offset++]=10;
 if(offset!==size)throw Error('モード2のShift-JISサイズが一致しません');
 return bytes;
}

// Render a video frame to *visible* dots, not edge extraction.
// Dark source = large white circle on black; midtone = tiny white dot;
// bright source = blank black, per the agreed three-tone palette.
// Ordered spatial dithering adds subtle in-between tones without new glyphs
// and is anchored to the grid, so identical frames never flicker.
export function rgbaToHalftone(pixels,width,height,{brightness=0,contrast=1,gamma=1,sample=4}={}){
 if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1||
    !Number.isInteger(sample)||sample<1||sample>10||
    pixels.length!==width*height*sample*sample*4)
  throw Error('モード2の画像サイズが不正です');
 if(!Number.isFinite(brightness)||brightness<-100||brightness>100||
    !Number.isFinite(contrast)||contrast<.25||contrast>3||
    !Number.isFinite(gamma)||gamma<.4||gamma>2.5)
  throw Error('モード2の画質設定が範囲外です');
 const imageWidth=width*sample, stride=imageWidth*4;
 const dots=Math.floor(width/2), lines=[];
 for(let y=0;y<height;y++){
  let line='';
  for(let x=0;x<dots;x++){
   let sum=0;
   for(let dy=0;dy<sample;dy++){
    const row=(y*sample+dy)*stride+x*2*sample*4;
    for(let dx=0;dx<sample*2;dx++){
     const p=row+dx*4;
     // Canvas is opaque, but alpha is respected for direct API tests.
     const alpha=pixels[p+3]/255;
     sum+=(.2126*pixels[p]+.7152*pixels[p+1]+.0722*pixels[p+2])*alpha;
    }
   }
   const luminance=sum/(sample*sample*2*255);
   const adjusted=clamp((luminance-.5)*contrast+.5+brightness/100);
   const tone=1-Math.pow(adjusted,gamma);
   // Fixed 4x4 Bayer matrix: deterministic, modest dithering avoids noise.
   const dither=(BAYER4[(y%4)*4+(x%4)]-7.5)/16*.18;
   const v=clamp(tone+dither);
   line+=v<1/3?'　':v<2/3?'・':'●';
  }
  // PC-98 79-column profiles need one non-rendering half-width column.
  if(width%2)line+=' ';
  lines.push(line);
 }
 return lines.join('\r\n')+'\r\n';
}
