// Local face-geometry guide for the AA composer. The face detector returns six
// keypoints (two eyes, nose, mouth, two ears). We retain the observed outlines,
// but regularize tiny features into legible strokes at the TEXT GRID resolution.
// Not generative AI: only deterministic geometry, no paid calls or uploads.
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const strokePath=(target,priority,w,h,points,strength,importance)=>{
 for(let i=1;i<points.length;i++){
  const [ax,ay]=points[i-1],[bx,by]=points[i];
  const length=Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)*2));
  for(let k=0;k<=length;k++){
   const t=k/length,x=ax+(bx-ax)*t,y=ay+(by-ay)*t;
   const left=Math.max(0,Math.floor(x-2)),right=Math.min(w,Math.ceil(x+3));
   const top=Math.max(0,Math.floor(y-2)),bottom=Math.min(h,Math.ceil(y+3));
   for(let yy=top;yy<bottom;yy++)for(let xx=left;xx<right;xx++){
    const d=Math.hypot(xx+.5-x,yy+.5-y);
    const s=strength*clamp(1.55-d,0,1);
    const index=yy*w+xx;
    target[index]=Math.max(target[index],s);
    priority[index]=Math.max(priority[index],importance*clamp(2.5-d*.5,.2,1));
   }
  }
 }
};
const ellipse=(cx,cy,rx,ry,a=0,b=Math.PI*2,segments=44)=>{
 const points=[];
 for(let i=0;i<=segments;i++){
  const t=a+(b-a)*i/segments;
  points.push([cx+rx*Math.cos(t),cy+ry*Math.sin(t)]);
 }
 return points;
};
const arc=(cx,cy,rx,ry,start,end,segments=14)=>ellipse(cx,cy,rx,ry,start,end,segments);
export function guideArtisanFaces(field,structure,regions,ops=null){
 const path=ops?.path||strokePath;
 const {w,h}=field;if(!Array.isArray(regions)||!regions.length)return {...structure,faceGuides:0};
 const target=ops?structure.target:Float32Array.from(structure.target),
  importance=ops?structure.importance:Float32Array.from(structure.importance);
 let faceGuides=0;
 for(const face of regions){
  if(face.kind!=='face'||face.confidence<.6||!Array.isArray(face.landmarks)||face.landmarks.length<4)continue;
  const bx=face.x*w,by=face.y*h,bw=face.w*w,bh=face.h*h;
  if(bw<9||bh<7)continue;
  // An AA illustrator first abstracts the face: real photographs have pores,
  // wrinkles, highlights and texture that create noisy random characters.
  // Retain the surrounding hair/shoulder contours, but replace fine interior
  // texture with a compact sketch anchored to detected features.
  const ellipseX=bx+bw*.5,ellipseY=by+bh*.48;
  const erx=Math.max(3,bw*.52),ery=Math.max(3,bh*.57);
  if(ops)ops.clear(bx,by,bw,bh,ellipseX,ellipseY,erx,ery);
  else for(let y=Math.max(0,Math.floor(by-bh*.10));y<Math.min(h,Math.ceil(by+bh*1.13));y++)
   for(let x=Math.max(0,Math.floor(bx-bw*.10));x<Math.min(w,Math.ceil(bx+bw*1.1));x++){
    const d=((x-ellipseX)/erx)**2+((y-ellipseY)/ery)**2;
    if(d<.77){
     const idx=y*w+x;
     target[idx]*=.07;
     importance[idx]=Math.min(importance[idx],1.2);
    }
   }
  const points=face.landmarks;
  const get=i=>[points[i].x*w,points[i].y*h];
  const [eyeA,eyeB,nose,mouth]=[get(0),get(1),get(2),get(3)];
  // Ignore impossible landmark geometry rather than hallucinating a face.
  const distEyes=Math.abs(eyeA[0]-eyeB[0]);
  if(distEyes<Math.max(2,bw*.10)||distEyes>bw*.9)continue;
  const eyeSize=clamp(bw*.055,1.05,3.2);
  const pen=Math.max(.7,Math.min(1,Math.min(w,h)/38));
  const importanceFeature=2.7;
  for(const [ex,ey] of [eyeA,eyeB]){
   // Almond eye with a small dark pupil, retaining detected eye locations.
   path(target,importance,w,h,arc(ex,ey,eyeSize*1.4,eyeSize*.66,
    Math.PI*.87,Math.PI*2.13,16),.98*pen,importanceFeature);
   path(target,importance,w,h,arc(ex,ey,eyeSize*1.35,eyeSize*.62,
    -Math.PI*.15,Math.PI*1.15,16),.85*pen,importanceFeature);
   path(target,importance,w,h,[[ex,ey-eyeSize*.5],[ex,ey+eyeSize*.55]],.82*pen,importanceFeature);
   // Upper eyebrow, separated from the eye and oriented by face geometry.
   path(target,importance,w,h,arc(ex,ey-eyeSize*2.55,eyeSize*1.65,eyeSize*.28,
    Math.PI*1.08,Math.PI*1.95,10),.8*pen,2.2);
  }
  const [nx,ny]=nose;
  path(target,importance,w,h,[[nx-eyeSize*.35,ny-eyeSize*.6],
   [nx,ny+eyeSize*.35],[nx+eyeSize*.65,ny+eyeSize*.45]],.68*pen,2.1);
  const [mx,my]=mouth,mouthWidth=Math.max(eyeSize,distEyes*.32);
  path(target,importance,w,h,arc(mx,my-mouthWidth*.10,
   mouthWidth,mouthWidth*.18,Math.PI*.08,Math.PI*.92,14),.95*pen,importanceFeature);
  // A suggested U-shaped face contour provides coherent volume in AA;
  // pre-existing strong image contours remain untouched.
  const centerX=bx+bw*.5,centerY=by+bh*.48,rx=bw*.43,ry=bh*.54;
  path(target,importance,w,h,ellipse(centerX,centerY,rx,ry),.85,2.15);
  // Upper hair contour and a few bangs follow head geometry while preserving
  // genuine source hair outside the face. Curves, not dense letter-shaped blobs.
  const hairY=by+bh*.18;
  path(target,importance,w,h,arc(centerX,hairY,bw*.49,bh*.29,
   Math.PI*1.05,Math.PI*1.95,30),.65,1.65);
  for(const d of [-.27,0,.27]){
   const x=centerX+d*bw;
   path(target,importance,w,h,[[x-bw*.06,by+bh*.06],
    [x,by+bh*.19],[x+bw*.025,by+bh*.29]],.55,1.65);
  }
  faceGuides++;
 }
 return {...structure,target,importance,faceGuides};
}

export function artisanFaceGpuCommands(field,structure,regions){
 const commands=[];let current=null;
 const result=guideArtisanFaces(field,structure,regions,{
  clear(...ellipse){current={ellipse,points:[]};commands.push(current);},
  path(target,priority,w,h,points,strength,importance){
   for(let i=1;i<points.length;i++){
    const [ax,ay]=points[i-1],[bx,by]=points[i];const length=Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)*2));
    for(let k=0;k<=length;k++){const t=k/length;current.points.push(ax+(bx-ax)*t,ay+(by-ay)*t,strength,importance);}
   }
  }
 });
 return {commands,faceGuides:result.faceGuides};
}
