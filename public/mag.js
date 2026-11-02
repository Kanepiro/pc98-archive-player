// Independent implementation of MAGBIBLE.DOC + its errata (Woody RINN).
// Preserve the GRB palette's stored 8-bit channel values.
export function decodeMAG(input) {
 const b=input instanceof Uint8Array?input:new Uint8Array(input);
 const fail=message=>{throw Error('MAG: '+message);};
 if(b.length<40||String.fromCharCode(...b.subarray(0,8))!=='MAKI02  ')fail('ヘッダーが不正です');
 const eof=b.indexOf(0x1a,8);if(eof<0||eof>1024*1024)fail('コメント終端がありません');
 let base=eof+1;while(base<b.length&&b[base]!==0)base++;
 if(base+32>b.length)fail('ヘッダーが途中で切れています');
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength),u16=n=>v.getUint16(base+n,true),u32=n=>v.getUint32(base+n,true);
 const machine=b[base+1],flags=b[base+2],mode=b[base+3],colors=mode&128?256:16;
 if(machine===3&&flags!==0)fail('MSXの機種依存モードは未対応です');
 const x1=u16(4),y1=u16(6),x2=u16(8),y2=u16(10),unit=colors===16?8:4;
 if(x2<x1||y2<y1)fail('画像の座標が不正です');
 const originX=Math.floor(x1/unit)*unit,width=(Math.floor(x2/unit)-Math.floor(x1/unit)+1)*unit,height=y2-y1+1;
 if(width>8192||height>8192||width*height>16777216)fail('画像が大きすぎます');
 const a=base+u32(12),bp=base+u32(16),bs=u32(20),pp=base+u32(24),ps=u32(28),pal=base+32;
 const rowBytes=width/(colors===16?2:1),perRow=rowBytes/4,neededA=Math.ceil(perRow*height/8);
 if(a<pal+colors*3||bp<a+neededA||pp<bp+bs||pp+ps>b.length)fail('格納位置またはサイズが不正です');
 const packed=new Uint8Array(rowBytes*height),line=new Uint8Array(perRow);
 const back=[0,2,4,8,rowBytes,rowBytes+2,2*rowBytes,2*rowBytes+2,2*rowBytes+4,4*rowBytes,4*rowBytes+2,4*rowBytes+4,8*rowBytes,8*rowBytes+2,8*rowBytes+4,16*rowBytes];
 let bit=0,bpos=bp,ppos=pp,out=0;
 for(let y=0;y<height;y++)for(let x=0;x<perRow;x++){
  if(b[a+(bit>>3)]&(128>>(bit&7))){if(bpos>=bp+bs)fail('フラグBが不足しています');line[x]^=b[bpos++];}bit++;
  for(const code of [line[x]>>4,line[x]&15]){
   if(code===0){if(ppos+2>pp+ps)fail('ピクセルデータが不足しています');packed[out++]=b[ppos++];packed[out++]=b[ppos++];}
   else {const from=out-back[code];if(from<0)fail('コピー位置が範囲外です');packed[out++]=packed[from];packed[out++]=packed[from+1];}
  }
 }
 const rgba=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<width*height;i++){
  const index=colors===16?((i&1)?packed[i>>1]&15:packed[i>>1]>>4):packed[i],p=pal+index*3,o=i*4;
  rgba[o]=b[p+1];rgba[o+1]=b[p];rgba[o+2]=b[p+2];rgba[o+3]=255;
 }
 return {width,height,rgba,colors,pixelAspect:mode&1?2:1,originX,originY:y1,machine,flags,mode};
}
