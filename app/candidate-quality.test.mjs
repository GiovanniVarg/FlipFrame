import test from 'node:test';import assert from 'node:assert/strict';
import {qualityChecks} from './candidate-quality.mjs';
test('absent or malformed evidence never claims pixel preservation',()=>{
 for(const c of [{},{repairVerification:{verifiedFrames:151}},{repairVerification:{pipeline:'adaptive-object-repair-v1',verifiedFrames:151,editedFrames:200,outsideCoverage:'preserved'}}])assert.equal(qualityChecks(c)[0].status,'review');
});
test('valid proof is explicitly scoped outside cleanup coverage',()=>{
 const checks=qualityChecks({repairVerification:{pipeline:'adaptive-object-repair-v1',verifiedFrames:151,editedFrames:100,outsideCoverage:'preserved'}});
 assert.equal(checks[0].status,'verified');assert.match(checks[0].detail,/151/);assert.match(checks[0].detail,/outside/);
 assert.equal(checks.find(c=>c.id==='motion').status,'review');
});
test('a supplied reference requires human review, not an invented match score',()=>{
 const checks=qualityChecks({referenceImage:{id:'ref',url:'/media/ref.png',name:'shoe'}});
 assert.equal(checks.find(c=>c.id==='reference').status,'review');
 assert.equal(qualityChecks({}).some(c=>c.id==='reference'),false);
});

test('tracking warnings remain review-only and include timestamps',()=>{const checks=qualityChecks({repairVerification:{pipeline:'adaptive-object-repair-v1',verifiedFrames:30,editedFrames:30,outsideCoverage:'preserved',qualityDiagnostics:{flaggedFrames:2,warnings:[{seconds:1.2}]}}});const flag=checks.find(c=>c.id==='tracking-flags');assert.equal(flag.status,'review');assert.match(flag.detail,/1.20s/);assert.match(flag.detail,/not a measured accuracy/)});
