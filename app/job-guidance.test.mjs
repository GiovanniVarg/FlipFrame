import test from 'node:test';
import assert from 'node:assert/strict';
import {jobGuidance} from './job-guidance.mjs';
import {publicJob} from './jobs.mjs';
test('accepted recovery never suggests free regeneration',()=>{const j=publicJob({status:'failed',generation:{providerState:{requestId:'abc',status:'completed'}}});assert.equal(j.recoveryMode,'check');assert.match(jobGuidance(j).detail,/billable/);assert.equal(jobGuidance(j).action,'Check existing request');});
test('preparation recovery explains possible paid submission',()=>{const j=publicJob({status:'failed',retryable:true,generation:{}});assert.equal(j.recoveryMode,'prepare');assert.match(jobGuidance(j).detail,/paid generation/);});
test('uncertain acceptance does not invite resubmission',()=>{const j=publicJob({status:'unknown',generation:{submission:'attempting'}});assert.equal(j.recoveryMode,undefined);assert.equal(jobGuidance(j).action,'View activity');assert.match(jobGuidance(j).detail,/not confirmed/);});
test('local processing carries no provider charge claim for generation',()=>{assert.match(jobGuidance({status:'running',type:'track'}).detail,/locally/);assert.doesNotMatch(jobGuidance({status:'running',type:'generation'}).detail,/runs locally/);});
