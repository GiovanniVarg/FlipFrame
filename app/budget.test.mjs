import test from 'node:test';import assert from 'node:assert/strict';import {reserve} from './budget.mjs';
test('budget rejects nonfinite and over ceiling quote',()=>{for(const n of [NaN,Infinity,-1,81])assert.throws(()=>reserve({spent:0,reserved:0},80,n))});
test('reservation counts previous spend and unknown holds',()=>{assert.throws(()=>reserve({spent:20,reserved:59},80,1));assert.deepEqual(reserve({spent:1,reserved:1},80,.5),{spent:1,reserved:2})});

test('per-request guard admits bounded video edits and rejects above five dollars',()=>{assert.equal(reserve({spent:0,reserved:0},80,3).reserved,6);assert.throws(()=>reserve({spent:0,reserved:0},80,5.01));assert.throws(()=>reserve({spent:NaN,reserved:0},80,1));});
