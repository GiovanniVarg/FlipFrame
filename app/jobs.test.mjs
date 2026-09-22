import test from 'node:test';import assert from 'node:assert/strict';import {findDuplicate,requestFingerprint,publicJob,recoverable} from './jobs.mjs';
test('idempotency survives key order and rejects changed payload',()=>{const j={id:'j',projectId:'p',idempotencyKey:'abcd1234',inputFingerprint:requestFingerprint({prompt:'edit',start:1})};const db={jobs:{j}};assert.equal(findDuplicate(db,'p',{start:1,prompt:'edit',idempotencyKey:'abcd1234'}),j);assert.throws(()=>findDuplicate(db,'p',{start:2,prompt:'edit',idempotencyKey:'abcd1234'}),/different/);assert.equal(findDuplicate(db,'other',{start:1,prompt:'edit',idempotencyKey:'abcd1234'}),undefined)});
test('public jobs omit server paths and signed inputs',()=>{const j={id:'j',status:'failed',provider:'higgsfield',generation:{source:'private',videoUrl:'signed',baseRevisionId:'r',submission:'accepted'},providerState:{requestId:'remote',status:'completed'},workRequest:{request:{source:'private'}},result:{id:'c',url:'/media/c.mp4',path:'private',baseRevisionId:'r'}};const p=publicJob(j);assert.equal(p.recoverable,true);assert.equal(p.baseRevisionId,'r');assert.ok(!JSON.stringify(p).includes('private'));assert.ok(!JSON.stringify(p).includes('signed'));assert.equal(p.type,'generation')});
test('only accepted provider work can be recovered without a new submission',()=>{assert.equal(recoverable({status:'unknown',generation:{submission:'attempting'}}),false);assert.equal(recoverable({status:'unknown',generation:{},providerState:{requestId:'r',status:'queued'}}),true);assert.equal(recoverable({status:'failed',generation:{},providerState:{requestId:'r',status:'failed'}}),false)});

test('known accepted ID can reconcile an unknown response',()=>{assert.equal(recoverable({status:'unknown',generation:{},providerState:{status:'unknown',requestId:'known',statusUrl:'https://api.higgsfield.ai/requests/known/status'}}),true)});

test('saved candidates expose their actual interval for review',()=>{const j=publicJob({id:'j',result:{id:'c',url:'/media/c.mp4'},generation:{start:1,end:4,operation:'picture'}});assert.equal(j.result.start,1);assert.equal(j.result.end,4);assert.equal(j.result.operation,'picture')});

test('incomplete completed output cannot advertise a recovery that adds missing frames',()=>{assert.equal(recoverable({status:'failed',failureCode:'OUTPUT_TOO_SHORT',generation:{},providerState:{requestId:'r',status:'completed'}}),false)});

test('confirmed charges require reconciliation and never expose evidence notes',()=>{
 const estimated={status:'completed',quote:{estimatedUsd:4.8,reservedUsd:9.6}};
 assert.equal(publicJob(estimated).confirmedCharge,undefined);
 const result=publicJob({...estimated,reconciliation:{actualUsd:0.094,outcome:'completed',at:'2026-09-22T00:00:00Z',evidence:'private operator evidence'}});
 assert.deepEqual(result.confirmedCharge,{actualUsd:0.094,outcome:'completed',confirmedAt:'2026-09-22T00:00:00Z'});
 assert.ok(!JSON.stringify(result).includes('private operator'));
 assert.equal(publicJob({...estimated,reconciliation:{actualUsd:0,outcome:'failed'}}).confirmedCharge.actualUsd,0);
 for(const r of [{actualUsd:-1,outcome:'completed'},{actualUsd:NaN,outcome:'completed'},{actualUsd:1,outcome:'running'}])assert.equal(publicJob({...estimated,reconciliation:r}).confirmedCharge,undefined);
});
