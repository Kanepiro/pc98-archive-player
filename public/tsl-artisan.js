// Mode 4: all displayable CP932 glyphs, filtered by their *rendered* clarity.
// The archive remains Shift-JIS/CP932, with single and double column glyphs.
let glyphMap;
export function cp932GlyphMap(){
 if(glyphMap)return glyphMap;
 const decoder=new TextDecoder('shift_jis');
 const map=new Map();
 const add=bytes=>{
  const char=decoder.decode(Uint8Array.from(bytes));
  if([...char].length!==1 || char==='\uFFFD' || char==='\uFEFF')return;
  const cp=char.codePointAt(0);
  if(cp<0x20 || (cp>=0x7f&&cp<=0x9f) || cp===0xad || cp===0x2028 || cp===0x2029)return;
  if(!map.has(char))map.set(char,bytes);
 };
 for(let b=0x20;b<=0x7e;b++)add([b]);
 for(let b=0xa1;b<=0xdf;b++)add([b]);
 for(let lead=0x81;lead<=0xfc;lead++){
  if(lead>0x9f&&lead<0xe0)continue;
  for(let trail=0x40;trail<=0xfc;trail++){
   if(trail===0x7f)continue;
   add([lead,trail]);
  }
 }
 glyphMap=map;
 return glyphMap;
}
export function artisanColumns(line){
 const glyphs=cp932GlyphMap();
 let sum=0;
 for(const char of line){
  const bytes=glyphs.get(char);
  if(!bytes)throw Error('モード4で使えないCP932文字: '+char);
  sum+=bytes.length;
 }
 return sum;
}
export function encodeArtisanFrame(lines){
 const glyphs=cp932GlyphMap();
 const bytes=new Uint8Array(lines.reduce((sum,line)=>sum+artisanColumns(line)+2,3));
 let offset=0;
 for(const line of lines){
  for(const char of line)for(const b of glyphs.get(char))bytes[offset++]=b;
  bytes[offset++]=13;bytes[offset++]=10;
 }
 bytes[offset++]=12;bytes[offset++]=13;bytes[offset++]=10;
 if(offset!==bytes.length)throw Error('モード4のCP932バイト数が不正です');
 return bytes;
}
// Complexity is assessed visually, NOT by a handwritten kanji blacklist.
// A dense many-stroke glyph that becomes a solid dark blob is discarded;
// a detailed glyph with useful, distinguishable structure remains eligible.
export function acceptableArtisanMask(gray,columns,width,height){
 let count=0,transitions=0,ink=0;
 const limit=width*height;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,v=gray[i];
  ink+=v;
  const black=v>.35;
  if(black)count++;
  if(x>0 && black!==(gray[i-1]>.35))transitions++;
  if(y>0 && black!==(gray[i-width]>.35))transitions++;
 }
 const density=count/limit,meanInk=ink/limit,crossings=transitions/limit;
 // At 20px many highly complex kanji collapse into a noisy square.
 // For double-column glyphs reject very tangled strokes, but preserve
 // readable simple kanji (川, 人, 森) and curved punctuation.
 if(columns===2 && (density>.38 || crossings>.46 || (density>.28&&crossings>.35)))return false;
 return density<.63&&meanInk<.58;
}
export async function makeArtisanGlyphAtlas(sample=6,signal,progress=()=>{}){
 if(!Number.isInteger(sample)||sample<4||sample>10)throw Error('モード4の標本数が不正です');
 const doc=document;
 const canvas=doc.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
 const small=doc.createElement('canvas'),mini=small.getContext('2d',{willReadFrequently:true});
 if(!ctx||!mini)throw Error('字形の描画に失敗しました');
 const entries=[...cp932GlyphMap()],atlas=[],unique=new Set();
 const font='20px monospace';
 const supported=async()=>{try{await doc.fonts?.ready;}catch{}};
 await supported();
 // Missing-font squares are duplicated under many CP932 code points; keep only
 // one copy of a rasterized silhouette to avoid wasting matching iterations.
 for(let index=0;index<entries.length;index++){
  if(signal?.aborted)throw new DOMException('解析を中止しました','AbortError');
  const [char,bytes]=entries[index],cols=bytes.length;
  canvas.width=12*cols;canvas.height=24;
  ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#fff';ctx.font=font;ctx.textBaseline='top';
  if(char!==' ')ctx.fillText(char,0,0,canvas.width);
  const raw=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const gray=new Float32Array(canvas.width*canvas.height);
  for(let i=0;i<gray.length;i++)gray[i]=raw[i*4]/255;
  if(char!==' '&&!acceptableArtisanMask(gray,cols,canvas.width,canvas.height))continue;
  small.width=sample*cols;small.height=sample;
  mini.fillStyle='#000';mini.fillRect(0,0,small.width,small.height);
  mini.imageSmoothingEnabled=true;mini.imageSmoothingQuality='high';
  mini.drawImage(canvas,0,0,small.width,small.height);
  const pixels=mini.getImageData(0,0,small.width,small.height).data;
  const mask=new Float32Array(sample*sample*cols);
  for(let i=0;i<mask.length;i++)mask[i]=pixels[i*4]/255;
  if(char!==' '&&mask.every(v=>v===0))continue;
  const id=cols+':'+Array.from(mask,v=>Math.round(v*31)).join(',');
  if(char!==' '&&unique.has(id))continue;
  unique.add(id);atlas.push({char,columns:cols,mask});
  if(index%350===349){progress(index+1,entries.length);await new Promise(resolve=>setTimeout(resolve,0));}
 }
 for(const essential of [' ','#','／']){
  if(!atlas.some(g=>g.char===essential))throw Error('モード4で必須字形が欠落: '+essential);
 }
 progress(entries.length,entries.length);
 return atlas;
}
