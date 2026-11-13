import test from 'node:test';
import assert from 'node:assert/strict';
import {artisanFocusRect,remapArtisanRegions} from '../public/tsl-artisan-focus.js';
test('small detected face is brought into the frame with matching remapped eye landmarks',()=>{
 const base={x:0,y:0,width:640,height:360};
 const face={kind:'face',confidence:.94,x:.4,y:.2,w:.2,h:.18,
  landmarks:[{x:.46,y:.27,label:'left_eye'},{x:.55,y:.27,label:'right_eye'}]};
 const focused=artisanFocusRect(base,[face],640,360);
 assert.ok(focused.zoom>2);
 const [updated]=remapArtisanRegions([face],base,focused,640,360);
 assert.ok(updated.h>face.h*2);
 assert.ok(updated.x>=0&&updated.x+updated.w<=1);
 assert.ok(updated.landmarks[0].x<updated.landmarks[1].x);
 const smooth=artisanFocusRect(base,[{...face,x:.41}],640,360,focused);
 assert.ok(Math.abs(smooth.x-focused.x)<Math.abs(artisanFocusRect(base,[{...face,x:.41}],640,360).x-focused.x));
});
test('large subject or no detection preserves original composition',()=>{
 const base={x:10,y:20,width:630,height:340};
 assert.deepEqual(artisanFocusRect(base,[],640,360),{...base,zoom:1});
 assert.deepEqual(artisanFocusRect(base,[{kind:'cat',confidence:.8,x:.1,y:.02,w:.8,h:.9}],640,360),{...base,zoom:1});
});
