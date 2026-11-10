// Mode 2: sparse, shape-aware contours using Shift-JIS full-width and ASCII.
// Every double-byte character occupies two half-width TSL columns.
const FULL_WIDTH_GLYPHS={
 '│':[0x84,0xa0], '─':[0x84,0x9f], '┃':[0x84,0xab], '━':[0x84,0xaa],
 '／':[0x81,0x5e], '＼':[0x81,0x5f],
 '┌':[0x84,0xa1], '┐':[0x84,0xa2], '└':[0x84,0xa4], '┘':[0x84,0xa3],
 '├':[0x84,0xa5], '┤':[0x84,0xa7], '┬':[0x84,0xa6], '┴':[0x84,0xa8], '┼':[0x84,0xa9],
 '┏':[0x84,0xac], '┓':[0x84,0xad], '┗':[0x84,0xaf], '┛':[0x84,0xae],
 '┣':[0x84,0xb0], '┫':[0x84,0xb2], '┳':[0x84,0xb1], '┻':[0x84,0xb3], '╋':[0x84,0xb4],
 '（':[0x81,0x69], '）':[0x81,0x6a], '〈':[0x81,0x71], '〉':[0x81,0x72],
 '「':[0x81,0x75], '」':[0x81,0x76], '『':[0x81,0x77], '』':[0x81,0x78],
 '・':[0x81,0x45], '。':[0x81,0x42], '○':[0x81,0x9b], '◇':[0x81,0x9e],
 '＋':[0x81,0x7b], '×':[0x81,0x7e],
 '＿':[0x81,0x51], '―':[0x81,0x5c], '￣':[0x81,0x50], '｜':[0x81,0x62]
};
const ASCII_GLYPHS="|-/\\_.,:;()<>+*~'";
export const OUTLINE_GLYPHS=Object.freeze({
 ...FULL_WIDTH_GLYPHS,
 ...Object.fromEntries([...ASCII_GLYPHS].map(c=>[c,[c.charCodeAt(0)]]))
});
export const OUTLINE_GLYPH_SET=new Set(Object.keys(OUTLINE_GLYPHS));
export const OUTLINE_GLYPH_COUNT=OUTLINE_GLYPH_SET.size;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const CORNER_GLYPHS=Object.freeze({
 3:['└','┗'],9:['┘','┛'],6:['┌','┏'],12:['┐','┓'],
 7:['├','┣'],13:['┤','┫'],14:['┬','┳'],11:['┴','┻'],15:['┼','╋']
});

export function displayColumns(line,conversionMode='legacy'){
 let cols=0;
 for(const char of line){
  if(char===' '){cols++;continue;}
  const bytes=conversionMode==='outline'&&OUTLINE_GLYPHS[char];
  if(!bytes)throw Error('画面データに未対応の文字があります');
  cols+=bytes.length;
 }
 return cols;
}
export function encodeOutlineFrame(lines){
 const size=lines.reduce((n,line)=>n+displayColumns(line,'outline')+2,0)+3;
 const bytes=new Uint8Array(size);let i=0;
 for(const line of lines){
  for(const char of line){
   if(char===' '){bytes[i++]=0x20;continue;}
   for(const b of OUTLINE_GLYPHS[char])bytes[i++]=b;
  }
  bytes[i++]=13;bytes[i++]=10;
 }
 bytes[i++]=12;bytes[i++]=13;bytes[i++]=10;
 if(i!==size)throw Error('Shift-JISの出力サイズが一致しません');
 return bytes;
}

// RGB edges on double-column glyph cells. Flat fills are always spaces.
export function rgbaToOutline(pixels,width,height,{sample=4,outlineThreshold=20}={}){
 if(!Number.isInteger(width)||width<4||!Number.isInteger(height)||height<4||
    !Number.isInteger(sample)||sample<1||
    pixels.length!==width*height*sample*sample*4)throw Error('画素数が一致しません');
 if(!Number.isFinite(outlineThreshold)||outlineThreshold<5||outlineThreshold>140)
  throw Error('輪郭感度が範囲外です');

 const gw=Math.ceil(width/2),n=gw*height,sourceWidth=width*sample;
 const colors=new Float32Array(n*3),strength=new Float32Array(n);
 const gradX=new Float32Array(n),gradY=new Float32Array(n),edge=new Uint8Array(n);
 // Preserve the two half-width samples separately. Averaging both first
 // used to erase fine contours that were narrower than a full-width glyph.
 const fineColors=new Float32Array(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const f=(y*width+x)*3;
  for(let sy=0;sy<sample;sy++)for(let sx=0;sx<sample;sx++){
   const p=((y*sample+sy)*sourceWidth+x*sample+sx)*4,a=pixels[p+3]/255;
   fineColors[f]+=pixels[p]*a;fineColors[f+1]+=pixels[p+1]*a;fineColors[f+2]+=pixels[p+2]*a;
  }
  const denom=sample*sample;
  fineColors[f]/=denom;fineColors[f+1]/=denom;fineColors[f+2]/=denom;
 }
 for(let y=0;y<height;y++)for(let x=0;x<gw;x++){
  const i=(y*gw+x)*3,first=(y*width+x*2)*3;
  const count=x*2+1<width?2:1;
  for(let c=0;c<3;c++){
   colors[i+c]=(fineColors[first+c]+(count===2?fineColors[first+3+c]:0))/count;
  }
 }
 const at=(x,y,c)=>colors[(clamp(y,0,height-1)*gw+clamp(x,0,gw-1))*3+c];
 const peak=(x,y)=>strength[clamp(y,0,height-1)*gw+clamp(x,0,gw-1)];
 for(let y=0;y<height;y++)for(let x=0;x<gw;x++){
  const i=y*gw+x;
  let total=0,dominant=0;
  for(let c=0;c<3;c++){
   const dx=(at(x+1,y,c)-at(x-1,y,c))*.5,dy=(at(x,y+1,c)-at(x,y-1,c))*.5;
   const power=dx*dx+dy*dy;total+=power;
   if(power>dominant){dominant=power;gradX[i]=dx;gradY[i]=dy;}
  }
  strength[i]=Math.sqrt(total/3);
 }
 const sorted=Array.from(strength).sort((a,b)=>a-b);
 // The former 72nd-percentile hard cutoff missed weak facial and hair lines.
 // Keep the adaptive noise filter, but allow moderately faint edges through.
 const cutoff=Math.max(outlineThreshold,(sorted[Math.floor(n*.6)]||0)*.7);
 for(let y=0;y<height;y++)for(let x=0;x<gw;x++){
  const i=y*gw+x,m=strength[i];
  if(m<cutoff||m<=0)continue;
  const dx=gradX[i],dy=gradY[i],ax=Math.abs(dx),ay=Math.abs(dy);
  const sx=Math.sign(dx)||1,sy=Math.sign(dy)||1;
  let a,b;
  if(ax>ay*2.4){a=peak(x-1,y);b=peak(x+1,y);}
  else if(ay>ax*2.4){a=peak(x,y-1);b=peak(x,y+1);}
  else{a=peak(x-sx,y-sy);b=peak(x+sx,y+sy);}
  if(m>=a&&m>b)edge[i]=1;
 }
 // Second, half-width detail pass. Small eyes, hair strands and thin
 // silhouettes can exist between two samples of a full-width symbol.
 // ASCII strokes fill those gaps without painting flat color regions.
 const nf=width*height;
 const fineStrength=new Float32Array(nf),fineX=new Float32Array(nf),fineY=new Float32Array(nf);
 const fineEdge=new Uint8Array(nf);
 const fAt=(x,y,c)=>fineColors[(clamp(y,0,height-1)*width+clamp(x,0,width-1))*3+c];
 const fPeak=(x,y)=>fineStrength[clamp(y,0,height-1)*width+clamp(x,0,width-1)];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x;
  let sum=0,dominant=0;
  for(let c=0;c<3;c++){
   const dx=(fAt(x+1,y,c)-fAt(x-1,y,c))*.5;
   const dy=(fAt(x,y+1,c)-fAt(x,y-1,c))*.5;
   const power=dx*dx+dy*dy;sum+=power;
   if(power>dominant){dominant=power;fineX[i]=dx;fineY[i]=dy;}
  }
  fineStrength[i]=Math.sqrt(sum/3);
 }
 const detailCutoff=Math.max(6,outlineThreshold*.62);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,m=fineStrength[i];
  if(m<detailCutoff)continue;
  const dx=fineX[i],dy=fineY[i],ax=Math.abs(dx),ay=Math.abs(dy);
  const sx=Math.sign(dx)||1,sy=Math.sign(dy)||1;
  let a,b;
  if(ax>ay*2.4){a=fPeak(x-1,y);b=fPeak(x+1,y);}
  else if(ay>ax*2.4){a=fPeak(x,y-1);b=fPeak(x,y+1);}
  else{a=fPeak(x-sx,y-sy);b=fPeak(x+sx,y+sy);}
  if(m>=a&&m>b)fineEdge[i]=1;
 }
 const fineChar=(x,y)=>{
  const i=y*width+x;
  if(!fineEdge[i])return ' ';
  const dx=fineX[i],dy=fineY[i],ax=Math.abs(dx),ay=Math.abs(dy),m=fineStrength[i];
  if(m<detailCutoff*1.35)return '.';
  if(ax>ay*2.1)return '|';
  if(ay>ax*2.1)return '-';
  return dx*dy>=0?'\\':'/';
 };
 const active=(x,y)=>x>=0&&x<gw&&y>=0&&y<height&&edge[y*gw+x]!==0;
 const lines=[];
 for(let y=0;y<height;y++){
  let row='';
  for(let x=0;x<gw;x++){
   if(x*2+1>=width){row+=' ';continue;}
   const i=y*gw+x,m=strength[i];
   if(!edge[i]){
    row+=fineChar(x*2,y)+fineChar(x*2+1,y);
    continue;
   }
   const N=active(x,y-1),E=active(x+1,y),S=active(x,y+1),W=active(x-1,y);
   const NE=active(x+1,y-1),NW=active(x-1,y-1);
   const SE=active(x+1,y+1),SW=active(x-1,y+1);
   const mask=(N?1:0)|(E?2:0)|(S?4:0)|(W?8:0);
   const heavy=m>=Math.max(66,cutoff*1.8),faint=m<Math.max(66,cutoff*1.5);
   const dx=gradX[i],dy=gradY[i],ax=Math.abs(dx),ay=Math.abs(dy);
   let glyph;

   // A continuous diagonal has balanced x/y gradients; don't mistake its
   // adjacent pixels for square box corners.
   const diagonal=ax>0&&ay>0&&Math.min(ax,ay)/Math.max(ax,ay)>.55;
   if(CORNER_GLYPHS[mask]&&!diagonal)glyph=CORNER_GLYPHS[mask][heavy?1:0];
   else if(diagonal&&mask!==15)glyph=dx*dy>=0?(heavy?'＼':'\\'):(heavy?'／':'/');
   else if(mask===5){
    if(NW&&SW&&!NE&&!SE)glyph=heavy?'）':')';
    else if(NE&&SE&&!NW&&!SW)glyph=heavy?'（':'(';
    else glyph=heavy?'┃':faint?'|':'│';
   }else if(mask===10){
    if(NW&&NE&&!SW&&!SE)glyph='￣';
    else if(SW&&SE&&!NW&&!NE)glyph='＿';
    else glyph=heavy?'━':faint?'-':'─';
   }else if(mask===0){
    if(NW&&SW&&!NE&&!SE)glyph='〈';
    else if(NE&&SE&&!NW&&!SW)glyph='〉';
    else if((NE&&SW)||(ax>0&&ay>0&&dx*dy<0))glyph=heavy?'／':'/';
    else if((NW&&SE)||(ax>0&&ay>0&&dx*dy>0))glyph=heavy?'＼':'\\';
    else glyph=heavy?'・':'.';
   }else if(mask===1||mask===4){
    glyph=heavy?'｜':faint?':':'│';
   }else if(mask===2||mask===8){
    glyph=heavy?'―':faint?'-':'─';
   }else{
    if(ax>ay*1.6)glyph=heavy?'┃':faint?'|':'│';
    else if(ay>ax*1.6)glyph=heavy?'━':faint?'-':'─';
    else glyph=dx*dy>=0?(heavy?'＼':'\\'):(heavy?'／':'/');
   }
   if(!OUTLINE_GLYPHS[glyph])throw Error('輪郭文字の選択に失敗しました');
   if(OUTLINE_GLYPHS[glyph].length===1)row+=(x+y)%2?(' '+glyph):(glyph+' ');
   else row+=glyph;
  }
  lines.push(row);
 }
 return lines.join('\r\n')+'\r\n';
}
