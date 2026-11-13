import test from 'node:test';
import assert from 'node:assert/strict';
import {
 artisanContourField,contourDistance,makeArtisanGeometry,portMismatch,
 ArtisanComposer
} from '../public/tsl-artisan-engine.js';

function sprite(char,cols,S,points){
 const mask=new Float32Array(cols*S*S);
 for(const [x,y] of points)mask[y*cols*S+x]=1;
 return {char,columns:cols,mask};
}
const blank=(cols,S)=>sprite(' ',cols,S,[]);
function fill(width,height,S,r=255,g=r,b=r){
 const pixels=new Uint8ClampedArray(width*height*S*S*4);
 for(let i=0;i<pixels.length;i+=4){
  pixels[i]=r;pixels[i+1]=g;pixels[i+2]=b;pixels[i+3]=255;
 }
 return pixels;
}
test('Mode4 chamfer distance tolerates one-pixel line displacement',()=>{
 const t=new Float32Array(25);t[2+5*2]=1;
 const d=contourDistance(t,5,5);
 assert.equal(d[2+5*2],0);
 assert.equal(d[3+5*2],1);
 assert.ok(Math.abs(d[1+5*1]-Math.SQRT2)<.00001);
 assert.ok(d[0]>d[1]);
});
test('Mode4 geometry gives horizontal and vertical strokes different seam ports',()=>{
 const S=6;
 const horiz=sprite('─',2,S,Array.from({length:12},(_,x)=>[x,3]));
 const vert=sprite('／',2,S,Array.from({length:6},(_,y)=>[6,y]));
 const atlas=makeArtisanGeometry([blank(1,S),horiz,vert],S);
 const h=atlas[1],v=atlas[2];
 assert.ok(h.ports.left[3]>.5);
 assert.ok(h.ports.right[3]>.5);
 assert.equal(h.ports.top.reduce((a,b)=>a+b,0),0);
 assert.ok(v.ports.top[6]>.5&&v.ports.bottom[6]>.5);
 assert.ok(portMismatch(h.ports.right,h.ports.left)<.001);
 assert.ok(portMismatch(v.ports.right,h.ports.left)>.07);
});
test('Mode4 creates no fake art in a uniformly colored scene',()=>{
 const S=6,w=8,h=6;
 const atlas=[blank(1,S),sprite('／',2,S,[[0,0],[1,1],[2,2],[3,3],[4,4],[5,5],[6,5],[7,5]])];
 const engine=new ArtisanComposer(atlas,S);
 for(const [r,g,b] of [[240,240,240],[0,180,255],[50,50,50]]){
  const pixels=fill(w,h,S,r,g,b);
  const field=artisanContourField(pixels,w,h,S);
  assert.equal(field.target.reduce((a,b)=>a+b,0),0);
  const output=engine.convert(pixels,w,h);
  assert.equal(output,(' '.repeat(w)+'\r\n').repeat(h));
  assert.ok(engine.lastDiagnostics.final.total<=engine.lastDiagnostics.initial.total+1e-8);
 }
 const resumed=new ArtisanComposer(atlas,S);
 const saved=structuredClone(engine.snapshot());resumed.restore(saved);
 assert.equal(resumed.convert(fill(w,h,S,70),w,h),(' '.repeat(w)+'\r\n').repeat(h));
});
test('Mode4 connected contour has nonzero skeleton and row reflow never worsens the global objective',()=>{
 const S=6,w=10,h=8;
 const atlas=[
  blank(1,S),
  sprite('／',2,S,[[0,0],[1,1],[2,2],[3,3],[4,4],[5,5],[6,5],[7,5]]),
  sprite('─',2,S,Array.from({length:12},(_,x)=>[x,3])),
  sprite('│',2,S,Array.from({length:6},(_,y)=>[6,y])),
  sprite('┌',2,S,[[0,2],[1,2],[2,2],[3,2],[3,3],[3,4],[3,5]])
 ];
 const pixels=fill(w,h,S,242),W=w*S,H=h*S;
 for(let y=4;y<H-4;y++)for(let dx=-2;dx<=2;dx++){
  const x=Math.round(W*.32+Math.sin(y/8)*5)+dx;
  const p=(y*W+x)*4;pixels[p]=pixels[p+1]=pixels[p+2]=5;
 }
 const field=artisanContourField(pixels,w,h,S);
 assert.ok(field.target.some(x=>x>.4));
 const engine=new ArtisanComposer(atlas,S);
 const text=engine.convert(pixels,w,h);
 assert.equal(text.trimEnd().split('\r\n').length,h);
 assert.ok(engine.lastDiagnostics.final.total<=engine.lastDiagnostics.initial.total+1e-5,
  JSON.stringify(engine.lastDiagnostics));
 const outputChars=new Set([...text].filter(x=>x!=='\r'&&x!=='\n'));
 for(const c of outputChars)assert.ok(atlas.some(a=>a.char===c));
});
