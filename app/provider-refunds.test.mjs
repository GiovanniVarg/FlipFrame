import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseProviderFailure} from './provider-refunds.mjs';
test('confirmed free outcomes release only their own hold, once',()=>{
 for(const status of ['failed','nsfw','canceled']){
  const state={spend:{spent:3,reserved:5}},record={quote:{reservedUsd:2},generation:{reservedUsd:2}};
  assert.equal(releaseProviderFailure(state,record,{status,requestId:'verified'},record.generation),true);
  assert.deepEqual(state.spend,{spent:3,reserved:3});assert.equal(record.reconciliation.actualUsd,0);
  assert.equal(releaseProviderFailure(state,record,{status},record.generation),false);
  assert.equal(state.spend.reserved,3);
 }
});
test('local failures cannot release completed, pending or unknown provider work',()=>{
 for(const status of ['completed','queued','in_progress','unknown']){
  const state={spend:{spent:0,reserved:2}},record={status:'failed',reservedUsd:2};
  assert.equal(releaseProviderFailure(state,record,{status}),false);assert.equal(state.spend.reserved,2);
 }
});
test('legacy originals release their hold and inconsistent ledgers are unchanged',()=>{
 const state={spend:{spent:0,reserved:2}},record={hold:2};
 releaseProviderFailure(state,record,{status:'failed'});assert.equal(record.hold,0);assert.equal(state.spend.reserved,0);
 const bad={spend:{spent:0,reserved:1}},r={reservedUsd:2};
 assert.throws(()=>releaseProviderFailure(bad,r,{status:'failed'}),/mismatch/);assert.equal(bad.spend.reserved,1);assert.equal(r.reconciliation,undefined);
});
