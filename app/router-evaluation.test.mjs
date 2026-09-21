import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyEdit,EDIT_ACTIONS} from './decision-router.mjs';
import {buildEditPlan} from './conversation.mjs';
const dataset=JSON.parse(fs.readFileSync(new URL('./router-evaluation.json',import.meta.url),'utf8'));

test('offline dataset separates deterministic coverage from unestablished live model accuracy',()=>{
 assert.ok(dataset.cases.length>=40);assert.equal(new Set(dataset.cases.map(c=>c.id)).size,dataset.cases.length);
 assert.ok(dataset.limitations.some(line=>line.includes('does not establish live Jev accuracy')));
 for(const category of ['exact-local','creative-freeform','preservation-constraint','unsupported','negation-or-condition','multiple-actions','invalid-temporal-scope'])assert.ok(dataset.cases.some(c=>c.category===category));
 assert.ok(dataset.cases.filter(c=>c.partition==='held-out').length>=10);
 for(const item of dataset.cases){assert.ok(EDIT_ACTIONS.includes(item.expectedOfflineAction));assert.ok(EDIT_ACTIONS.includes(item.humanIntent));}
});
for(const item of dataset.cases)test(`offline ${item.id}: ${item.text}`,async()=>{
 let networkCalls=0;
 const result=await classifyEdit({text:item.text,context:{selectedRange:{start:1,end:3},availableCapabilities:EDIT_ACTIONS}},
  {env:{},fetchImpl:async()=>{networkCalls++;throw new Error('Offline evaluation must never make a network request');}});
 assert.equal(networkCalls,0);assert.equal(result.action,item.expectedOfflineAction);
 if(item.expectedOfflineReason)assert.equal(result.reason,item.expectedOfflineReason);
 assert.notEqual(result.source,'jev');
 if(item.planCheck){const build=()=>buildEditPlan(dataset.projectFixture,{text:item.text,start:1,end:3,baseRevisionId:'r',quality:'standard'},result);
  if(item.planCheck.reject)assert.throws(build,/time|range|seconds/i);
  else{const plan=build();assert.ok(plan.start===item.planCheck.start);assert.equal(plan.end,item.planCheck.end);}
 }
});


test('report offline safety conformance separately from non-abstained intent coverage',async t=>{
 let conforming=0,matched=0,abstained=0,scopeRejected=0;
 const targets=dataset.cases.filter(item=>item.humanIntent!=='clarify');
 for(const item of dataset.cases){
  const result=await classifyEdit({text:item.text,context:{selectedRange:{start:1,end:3},availableCapabilities:EDIT_ACTIONS}},{env:{},fetchImpl:async()=>{throw new Error('Network forbidden');}});
  if(result.action===item.expectedOfflineAction&&(!item.expectedOfflineReason||result.reason===item.expectedOfflineReason))conforming++;
  if(result.action==='clarify')abstained++;
  if(item.humanIntent!=='clarify'&&result.action!=='clarify'&&result.action===item.humanIntent)matched++;
  if(item.planCheck?.reject){assert.throws(()=>buildEditPlan(dataset.projectFixture,{text:item.text,start:1,end:3,baseRevisionId:'r',quality:'standard'},result));scopeRejected++;}
 }
 assert.equal(conforming,dataset.cases.length);
 t.diagnostic(`Offline safety/fallback conformance: ${conforming}/${dataset.cases.length} labeled cases. This includes expected safe abstention and is NOT intent accuracy.`);
 t.diagnostic(`Exact non-abstained intent coverage: ${matched}/${targets.length} cases with a non-clarify human intent, including explicit unsupported labels. Every abstention is excluded from the numerator. This is authored-case local-rule coverage, not live Jev accuracy.`);
 t.diagnostic(`Abstentions: ${abstained}/${dataset.cases.length} cases. Invalid temporal scopes rejected by the deterministic planner: ${scopeRejected}/${dataset.cases.filter(item=>item.planCheck?.reject).length}.`);
 t.diagnostic('Live Jev accuracy, calibration, cost, and held-out live results: NOT ESTABLISHED; zero model requests.');
});
