import test from 'node:test';import assert from 'node:assert/strict';
import {formulaEstimate,publicPriceQuote,preparedShape,assumedOutputShape} from './pricing.mjs';
test('formula preserves subcent price with integer nanodollar multiplication',()=>{const q=formulaEstimate({width:1280,height:720,inputSeconds:5,outputSeconds:5});assert.equal(q.computedNanoUsd,'2773440000');assert.equal(q.estimatedUsd,2.77344);assert.equal(q.roundingAllowanceUsd,0);const tiny=formulaEstimate({width:1,height:1,inputSeconds:0,outputSeconds:1});assert.equal(tiny.billableVideoTokens,1);assert.equal(tiny.computedNanoUsd,'12840');assert.equal(tiny.estimatedUsd,.000013);assert.equal(tiny.roundingAllowanceUsd,.00000016);assert.equal(tiny.rateVerifiedAt,null);});
test('preparation sizing matches fixed encoder aspect policies',()=>{assert.deepEqual(preparedShape(1440,1080),{width:1280,height:720});assert.deepEqual(preparedShape(1080,1440),{width:720,height:1280});assert.deepEqual(preparedShape(800,800,'480p'),{width:480,height:480});assert.deepEqual(assumedOutputShape(1280,720),{width:1280,height:768});});
test('quote projection omits provider request body and keeps hold distinct',()=>{const q=formulaEstimate({width:1280,height:720,inputSeconds:5,outputSeconds:5});const safe=publicPriceQuote({...q,body:{prompt:'private',video_url:'signed'},bodyFingerprint:'private'},5.54688);assert.equal(safe.body,undefined);assert.equal(safe.bodyFingerprint,undefined);assert.equal(safe.safetyBufferUsd,2.77344);assert.equal(safe.isHardCap,false);});

test('frame fraction pricing does not add phantom tokens at integer boundaries',()=>{
 for(let frames=1;frames<300;frames++){
  const q=formulaEstimate({width:1280,height:720,inputSeconds:frames/30,outputSeconds:frames/30});
  assert.equal(q.billableVideoTokens,frames*1440);
 }
 const plan=formulaEstimate({width:1280,height:720,inputSeconds:0,outputSeconds:5},{creation:true});assert.match(plan.rateSourceUrl,/text-to-video/);assert.equal(plan.rateVerifiedAt,null);assert.match(plan.rateProvenance,/Pinned local/);
});
