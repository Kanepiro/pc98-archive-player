import test from 'node:test';
import assert from 'node:assert/strict';
import {shapeDescriptor,glyphScore,selectMode4Glyphs,judgeMode4,MODE4_LIMIT} from '../public/tsl-mode4-grid60.js';
test('a distant extra stroke costs more than the equivalent missing stroke',()=>{
 const one=new Float32Array(576),two=new Float32Array(576);
 for(let y=0;y<24;y++){one[y*24+6]=1;two[y*24+6]=two[y*24+18]=1;}
 const t1=shapeDescriptor(one,'target'),t2=shapeDescriptor(two,'target'),g1=shapeDescriptor(one,'glyph'),g2=shapeDescriptor(two,'glyph');
 assert.ok(Math.abs(glyphScore(t1,g2)-.65)<1e-6);
 assert.ok(Math.abs(glyphScore(t2,g1)-.35)<1e-6);
 assert.equal(glyphScore(t1,g1),0);
 const atlas=[{char:'∥',features:g2},{char:'｜',features:g1}],targets=[t1];targets.edgeCounts=[24];
 const result=selectMode4Glyphs(targets,atlas);assert.equal(result.indices[0],1);
 assert.equal(judgeMode4(targets,result,atlas)[0].output,'｜');
 assert.equal(judgeMode4(targets,{indices:[0],scores:[glyphScore(t1,g2)]},atlas)[0].accepted,false);
 assert.equal(MODE4_LIMIT,.34);
 assert.throws(()=>shapeDescriptor(one,'invalid'));
});
