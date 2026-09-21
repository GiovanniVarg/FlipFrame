import test from 'node:test';
import assert from 'node:assert/strict';
import {repairMasks} from './src/repair-scope.ts';
const masks=[{time:1,points:[[0,0]]},{time:3,points:[[1,1]]}];
test('audio and picture keep selected scope despite single-frame object inspector state',()=>{
 for(const action of ['mute','gain','generate_audio','picture','replace_audio'])assert.equal(repairMasks(action,'frame',0,8,8,30,masks),masks);
});
test('single-frame object requires visible selection and chooses its matching mask instead of first mask',()=>{
 assert.deepEqual(repairMasks('object','frame',3,3+1/30,8,30,masks),[masks[1]]);
 assert.throws(()=>repairMasks('object','frame',0,8,8,30,masks),/not be narrowed/);
 assert.throws(()=>repairMasks('object','frame',1,2,8,30,masks),/not be narrowed/);
 assert.throws(()=>repairMasks('object','frame',2,2+1/30,8,30,masks),/not be narrowed/);
});
test('range object preserves all keyframes and final frame clamps to duration',()=>{
 assert.equal(repairMasks('object','range',0,8,8,30,masks),masks);
 const last=[{time:7.98}];assert.deepEqual(repairMasks('object','frame',7.98,8,8,30,last),last);
});
