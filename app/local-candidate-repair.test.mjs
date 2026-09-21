import test from 'node:test';
import assert from 'node:assert/strict';
import {repairSource,validateProtectedAreas} from './local-candidate-repair.mjs';
const project={id:'p',activeRevisionId:'r'};
const candidate={id:'c',projectId:'p',baseRevisionId:'r'};
const generation={candidateId:'c',operation:'object',baseRevisionId:'r',start:0,end:5,paths:{trimmed:'/saved.mp4'}};
const db={candidates:{c:candidate},jobs:{j:{projectId:'p',status:'completed',generation}}};
test('local repair reuses retained generated footage and original interval',()=>{
 assert.equal(repairSource(db,project,'c',()=>true),generation);
 db.candidates.next={...candidate,id:'next',repairSourceCandidateId:'c'};
 assert.equal(repairSource(db,project,'next',()=>true),generation);
});
test('cross-project, stale, missing and non-object sources fail closed',()=>{
 assert.throws(()=>repairSource(db,{...project,id:'other'},'c',()=>true));
 assert.throws(()=>repairSource(db,{...project,activeRevisionId:'new'},'c',()=>true));
 assert.throws(()=>repairSource(db,project,'c',()=>false),/retained/);
 assert.throws(()=>repairSource({...db,jobs:{}},project,'c',()=>true));
});
test('protected polygons reject malformed or excessive input',()=>{
 assert.deepEqual(validateProtectedAreas(undefined),[]);
 assert.deepEqual(validateProtectedAreas([[[0,0],[1,0],[1,1]]]),[[[0,0],[1,0],[1,1]]]);
 for(const bad of [null,{},[[[0,0],[1,0]]],[[[NaN,0],[1,0],[1,1]]],[[[2,0],[1,0],[1,1]]],Array(21).fill([[0,0],[1,0],[1,1]])])assert.throws(()=>validateProtectedAreas(bad));
});

test('a collapsed keep-unchanged polygon is rejected',()=>{
 assert.throws(()=>validateProtectedAreas([[[.1,.1],[.2,.2],[.3,.3]]]),/area/);
});
