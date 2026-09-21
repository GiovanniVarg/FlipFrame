import test from 'node:test';import assert from 'node:assert/strict';
import {EDITOR_WORKFLOWS} from './editor-workflows.mjs';import {classifyEdit} from './decision-router.mjs';import {buildEditPlan} from './conversation.mjs';
const p={activeRevisionId:'r',duration:5,width:1280,height:720};
test('all guided workflows route without paid classification and require a plan',async()=>{
 for(const [action,w] of Object.entries(EDITOR_WORKFLOWS)){
  const decision=await classifyEdit({text:w.command},{env:{},fetchImpl:()=>{throw Error('must not call provider')}});
  assert.equal(decision.action,action,w.command);
  const plan=buildEditPlan(p,{text:w.command,baseRevisionId:'r',start:0,end:5},decision);
  assert.equal(plan.uiAction,w.uiAction);assert.equal(plan.route.kind,'ui');assert.equal(plan.route.estimatedUsd,0);assert.equal(plan.status,'ready');
 }
});
test('negative requests never start guided workflows',async()=>{
 for(const w of Object.values(EDITOR_WORKFLOWS))assert.equal((await classifyEdit({text:'do not '+w.command},{env:{}})).action,'clarify');
});

test('candidate workflows bind the reviewed candidate and never execute on suggestion',async()=>{
 const {createConversationService}=await import('./conversation.mjs');
 const project={...p,id:'p'};let executions=0;
 const db={candidates:{a:{id:'a',projectId:'p',baseRevisionId:'r'},foreign:{id:'foreign',projectId:'other',baseRevisionId:'r'}}};
 const service=createConversationService({db,save(){},getProject:()=>project,classify:async()=>({action:'fix_outline',source:'rules'}),execute:async()=>{executions++;return {uiAction:'fix_outline'}}});
 const input={text:'fix outline',baseRevisionId:'r',reviewCandidateId:'a',idempotencyKey:'fix-request-001'};
 const response=await service.message('p','owner',input);const plan=response.plans.at(-1);
 assert.equal(plan.targetCandidateId,'a');assert.equal(executions,0);
 await service.execute('p','owner',plan.id,{baseRevisionId:'r'});assert.equal(executions,1);
 const wrong=await service.message('p','owner',{...input,reviewCandidateId:'foreign',idempotencyKey:'fix-request-002'});
 assert.equal(wrong.plans.at(-1).status,'needs_input');
 await assert.rejects(()=>service.execute('p','owner',wrong.plans.at(-1).id,{baseRevisionId:'r'}),/candidate/);
});
