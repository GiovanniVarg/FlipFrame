import test from 'node:test';import assert from 'node:assert/strict';import {reserve} from './budget.mjs';
test('budget rejects nonfinite and over ceiling quote',()=>{for(const n of [NaN,Infinity,-1,81])assert.throws(()=>reserve({spent:0,reserved:0},80,n))});
test('reservation counts previous spend and unknown holds',()=>{assert.throws(()=>reserve({spent:20,reserved:59},80,1));assert.deepEqual(reserve({spent:1,reserved:1},80,.5),{spent:1,reserved:2})});

test('per-request guard admits bounded video edits and rejects above five dollars',()=>{assert.equal(reserve({spent:0,reserved:0},80,3).reserved,6);assert.throws(()=>reserve({spent:0,reserved:0},80,5.01));assert.throws(()=>reserve({spent:NaN,reserved:0},80,1));});

test('exact microUSD hold does not reject an exact budget ceiling',async()=>{
 const {budgetHold}=await import('./budget.mjs');assert.equal(budgetHold(.000123),.000246);assert.equal(budgetHold(.00000001),.000001);
 assert.equal(reserve({spent:0,reserved:0},.000246,.000123).reserved,.000246);
});

test('existing decimal ledger permits exact ceiling without binary sum drift',()=>{
 assert.equal(reserve({spent:0,reserved:.1},.3,.1).reserved,.3);
 assert.equal(reserve({spent:.00000001,reserved:.1},.30000001,.1).reserved,.3);
 assert.throws(()=>reserve({spent:.00000002,reserved:.1},.30000001,.1),/exceeded/);
});
