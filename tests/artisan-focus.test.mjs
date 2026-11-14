import test from 'node:test';
import assert from 'node:assert/strict';
import {artisanFocusRect,remapArtisanRegions} from '../public/tsl-artisan-focus.js';
test('Small and moving detections retain the user-selected source composition',()=>{
 const base={x:-100,y:20,width:840,height:472.5};
 for(const face of [
  {kind:'face',confidence:.94,x:.05,y:.1,w:.08,h:.1},
  {kind:'face',confidence:.99,x:.8,y:.2,w:.06,h:.07},
  {kind:'person',confidence:.9,x:.4,y:.15,w:.1,h:.3}
 ]){
  const previous={x:-400,y:-100,width:1568,height:882,zoom:2.45};
  assert.deepEqual(artisanFocusRect(base,[face],640,360,previous),{...base,zoom:1});
 }
 assert.deepEqual(artisanFocusRect(base,[],640,360),{...base,zoom:1});
});
test('Recognition boxes and landmarks remain aligned with the unchanged frame',()=>{
 const base={x:0,y:0,width:640,height:360};
 const face={kind:'face',confidence:.94,x:.4,y:.2,w:.2,h:.18,landmarks:[{x:.46,y:.27},{x:.55,y:.27}]};
 const [r]=remapArtisanRegions([face],base,artisanFocusRect(base,[face],640,360),640,360);
 for(const k of ['x','y','w','h'])assert.ok(Math.abs(r[k]-face[k])<1e-12);
 for(let i=0;i<face.landmarks.length;i++)for(const k of ['x','y'])assert.ok(Math.abs(r.landmarks[i][k]-face.landmarks[i][k])<1e-12);
});
