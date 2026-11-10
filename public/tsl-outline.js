// Mode 2: sparse contours using Shift-JIS full-width line-drawing glyphs.
// Each double-byte glyph occupies exactly two half-width TSL columns.
export const OUTLINE_GLYPHS = Object.freeze({
 '│':[0x84,0xa0], '─':[0x84,0x9f], '┃':[0x84,0xab], '━':[0x84,0xaa],
 '／':[0x81,0x5e], '＼':[0x81,0x5f]
});
export const OUTLINE_GLYPH_SET = new Set(Object.keys(OUTLINE_GLYPHS));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

export function displayColumns(line,conversionMode='legacy'){
 let cols=0;
 for(const char of line){
  if(char===' '){cols++;continue;}
  if(conversionMode==='outline'&&OUTLINE_GLYPH_SET.has(char)){cols+=2;continue;}
  throw Error('画面データに未対応の文字があります');
 }
 return cols;
}

export function encodeOutlineFrame(lines){
 const size=lines.reduce((n,line)=>n+displayColumns(line,'outline')+2,0)+3;
 const bytes=new Uint8Array(size);let i=0;
 for(const line of lines){
  for(const char of line){
   if(char===' '){bytes[i++]=0x20;continue;}
   const [a,b]=OUTLINE_GLYPHS[char];
   bytes[i++]=a;bytes[i++]=b;
  }
  bytes[i++]=13;bytes[i++]=10;
 }
 bytes[i++]=12;bytes[i++]=13;bytes[i++]=10;
 if(i!==size)throw Error('Shift-JISの出力サイズが一致しません');
 return bytes;
}

// Detect color and luminance boundaries on square full-width glyph cells.
// Two half-width columns = one full-width glyph, so the screen aspect is kept.
export function rgbaToOutline(pixels,width,height,{sample=4,outlineThreshold=40}={}){
 if(!Number.isInteger(width)||width<4||!Number.isInteger(height)||height<4||!Number.isInteger(sample)||sample<1||
    pixels.length!==width*height*sample*sample*4)throw Error('画素数が一致しません');
 if(!Number.isFinite(outlineThreshold)||outlineThreshold<10||outlineThreshold>140)throw Error('輪郭感度が範囲外です');
 const groupWidth=Math.ceil(width/2),n=groupWidth*height;
 const colors=new Float32Array(n*3),gradient=new Float32Array(n);
 const dxs=new Float32Array(n),dys=new Float32Array(n);
 const sourceWidth=width*sample;
 for(let y=0;y<height;y++)for(let gx=0;gx<groupWidth;gx++){
  const span=Math.min(sourceWidth-gx*2*sample,2*sample);
  let r=0,g=0,b=0;
  for(let sy=0;sy<sample;sy++)for(let sx=0;sx<span;sx++){
   const p=((y*sample+sy)*sourceWidth+gx*2*sample+sx)*4;
   const a=pixels[p+3]/255;
   r+=pixels[p]*a;g+=pixels[p+1]*a;b+=pixels[p+2]*a;
  }
  const i=(y*groupWidth+gx)*3,denom=sample*span;
  colors[i]=r/denom;colors[i+1]=g/denom;colors[i+2]=b/denom;
 }
 const at=(x,y,c)=>colors[(clamp(y,0,height-1)*groupWidth+clamp(x,0,groupWidth-1))*3+c];
 for(let y=0;y<height;y++)for(let x=0;x<groupWidth;x++){
  const i=y*groupWidth+x;
  let combined=0,dominant=0,angleX=0,angleY=0;
  for(let c=0;c<3;c++){
   const gx=(at(x+1,y,c)-at(x-1,y,c))*.5;
   const gy=(at(x,y+1,c)-at(x,y-1,c))*.5;
   combined+=gx*gx+gy*gy;
   const power=gx*gx+gy*gy;
   if(power>dominant){dominant=power;angleX=gx;angleY=gy;}
  }
  gradient[i]=Math.sqrt(combined/3);
  dxs[i]=angleX;dys[i]=angleY;
 }
 // Flat fills remain spaces. In textured scenes, retain only strong contours.
 const sorted=Array.from(gradient).sort((a,b)=>a-b);
 const cutoff=Math.max(outlineThreshold,sorted[Math.floor(n*.72)]||0);
 const strengthAt=(x,y)=>gradient[clamp(y,0,height-1)*groupWidth+clamp(x,0,groupWidth-1)];
 const lines=[];
 for(let y=0;y<height;y++){
  let row='';
  for(let x=0;x<groupWidth;x++){
   if(x*2+1>=width){row+=' ';continue;}
   const i=y*groupWidth+x,m=gradient[i];
   if(m<cutoff||m<=0){row+='  ';continue;}
   const dx=dxs[i],dy=dys[i],ax=Math.abs(dx),ay=Math.abs(dy);
   const sx=Math.sign(dx)||1,sy=Math.sign(dy)||1;
   let n1,n2;
   // Non-maximum suppression: draw thin edges rather than thick filled bands.
   if(ax>ay*2.4){n1=strengthAt(x-1,y);n2=strengthAt(x+1,y);}
   else if(ay>ax*2.4){n1=strengthAt(x,y-1);n2=strengthAt(x,y+1);}
   else{n1=strengthAt(x-sx,y-sy);n2=strengthAt(x+sx,y+sy);}
   if(m<n1||m<=n2){row+='  ';continue;}
   const heavy=m>=Math.max(70,cutoff*2);
   if(ax>=ay*1.55)row+=heavy?'┃':'│';
   else if(ay>=ax*1.55)row+=heavy?'━':'─';
   else row+=(dx*dy>0?'＼':'／');
  }
  lines.push(row);
 }
 return lines.join('\r\n')+'\r\n';
}
