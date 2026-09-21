import test from 'node:test';import assert from 'node:assert/strict';import {verifiedObjectRepair} from './object-repair-contract.mjs';
test('verification proof is mandatory and bounded',()=>{
 for(const result of [{},{ok:true,verifiedFrames:0,framesRepaired:1},{ok:true,verifiedFrames:3,framesRepaired:4},{ok:true,verifiedFrames:3.5,framesRepaired:1}])assert.throws(()=>verifiedObjectRepair(result),/pixel-preservation/);
 assert.deepEqual(verifiedObjectRepair({ok:true,verifiedFrames:151,framesRepaired:151}),{pipeline:'adaptive-object-repair-v1',verifiedFrames:151,editedFrames:151,outsideCoverage:'preserved',requiresVisualReview:true});
});

test('diagnostics survive proof creation and malformed flags fail closed',()=>{
 const base={ok:true,verifiedFrames:30,framesRepaired:20};const qualityDiagnostics={version:1,flaggedFrames:1,warnings:[{frame:3,seconds:.1,reasons:['wide-cleanup']}]};assert.deepEqual(verifiedObjectRepair({...base,qualityDiagnostics}).qualityDiagnostics,qualityDiagnostics);
 assert.throws(()=>verifiedObjectRepair({...base,qualityDiagnostics:{...qualityDiagnostics,flaggedFrames:21}}),/diagnostics/);
 assert.throws(()=>verifiedObjectRepair({...base,qualityDiagnostics:{...qualityDiagnostics,warnings:[{frame:3,seconds:NaN,reasons:[]}]}}),/diagnostics/);
});
