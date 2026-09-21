import test from 'node:test';import assert from 'node:assert/strict';
import {buildEditPlan,computeGenerationWindow,createConversationService} from './conversation.mjs';
const p={id:'p',duration:8,width:1280,height:720,activeRevisionId:'r'};
const input={text:'Mute from 1 to 3 seconds',baseRevisionId:'r',start:0,end:8,quality:'standard'};
test('explicit time range and local mute never need a model',()=>{const plan=buildEditPlan(p,input,{action:'mute',source:'rules'});assert.equal(plan.start,1);assert.equal(plan.end,3);assert.equal(plan.route.kind,'local');assert.equal(plan.route.estimatedUsd,0)});
test('bad range fails closed and timestamps are parsed in code',()=>{assert.throws(()=>buildEditPlan(p,{...input,text:'Mute from 7 to 3 seconds'},{action:'mute'}),/range/i);const x=buildEditPlan(p,{...input,text:'Mute 00:01 to 00:03'},{action:'mute'});assert.equal(x.start,1);assert.equal(x.end,3)});
test('generation bounds account for selected context and explicit draft',()=>{const a=buildEditPlan(p,{...input,text:'Make the sky orange',start:1,end:4},{action:'picture'});const b=buildEditPlan(p,{...input,text:'Make the sky orange',start:1,end:4,quality:'draft'},{action:'picture'});assert.equal(a.route.resolution,'720p');assert.equal(b.route.resolution,'480p');assert.ok(b.route.estimatedUsd<a.route.estimatedUsd);assert.equal(computeGenerationWindow(p,1,4,'720p').processEnd,5)});
test('object and uploaded audio require explicit input without invented boundaries',()=>{assert.equal(buildEditPlan(p,input,{action:'object'}).status,'needs_input');assert.equal(buildEditPlan(p,input,{action:'replace_audio'}).status,'needs_input')});
test('saved moment requests produce reviewed UI plans without changing footage or charging',()=>{
 const open=buildEditPlan(p,{...input,text:'Show saved moments'},{action:'open_markers',source:'rules'});
 const add=buildEditPlan(p,{...input,text:'Save selection',start:2,end:4},{action:'add_marker',source:'rules'});
 assert.equal(open.route.kind,'ui');assert.equal(open.route.estimatedUsd,0);assert.equal(open.uiAction,'markers');
 assert.equal(add.route.kind,'ui');assert.equal(add.route.estimatedUsd,0);assert.equal(add.uiAction,'add_marker');assert.equal(add.start,2);assert.equal(add.end,4);
});
test('stale revision, unsupported quality and ambiguous gain reject',()=>{assert.throws(()=>buildEditPlan(p,{...input,baseRevisionId:'old'},{action:'mute'}),/revision/);assert.throws(()=>buildEditPlan(p,{...input,quality:'magic'},{action:'picture'}),/quality/i);assert.equal(buildEditPlan(p,{...input,text:'make it quieter'},{action:'gain'}).status,'needs_input')});

test('gain amounts do not become timestamps or invalid negative times, including scope prevalidation',()=>{
 for(const [text,gainDb,start,end] of [
  ['increase volume to 6 dB',6,1,5],
  ['set gain to -6 dB',-6,1,5],
  ['gain -6 dB from 2 to 4 seconds',-6,2,4],
  ['set volume to +3 dB from 1 to 3 seconds',3,1,3],
  ['set gain to -3 dB at 2 seconds',-3,2,2+1/30],
 ]){
  const request={...input,text,start:1,end:5};
  for(const action of ['gain','clarify']){
   const plan=buildEditPlan(p,request,{action,source:'rules'});
   assert.equal(plan.start,start,text);assert.ok(Math.abs(plan.end-end)<1e-6,text);
   assert.equal(plan.instruction,text);
   if(action==='gain'){assert.equal(plan.gainDb,gainDb,text);assert.equal(plan.operation,'gain');}
  }
 }
});

test('undo last-edit phrasing and non-temporal first references retain the selected scope',()=>{
 for(const [text,action] of [['undo the last edit','undo'],['undo last edit','undo'],['show the first revision','open_history']]){
  for(const selectedAction of [action,'clarify']){
   const plan=buildEditPlan(p,{...input,text,start:1,end:5},{action:selectedAction,source:'rules'});
   assert.equal(plan.action,selectedAction);assert.equal(plan.start,1);assert.equal(plan.end,5);
  }
 }
});

test('excluding gain values still rejects malformed or negative explicit temporal scopes',()=>{
 for(const text of ['set gain to -6 dB from -2 to 3 seconds','set gain to 6 dB at -2 seconds','gain -6 dB from 1 to later','Mute the first few seconds','Mute the last -2 seconds','Mute first 3']){
  for(const action of ['gain','clarify'])assert.throws(()=>buildEditPlan(p,{...input,text},{action}),/time|range|seconds/i,text);
 }
});
test('conversation request and execution are persistent and idempotent',async()=>{const db={jobs:{}};let calls=0,execs=0;const service=createConversationService({db,save:()=>{},getProject:()=>p,classify:async()=>{calls++;return {action:'mute',source:'rules'}},execute:async()=>{execs++;return {uiAction:'play'}}});const req={...input,idempotencyKey:'request-key-001'};const result=await service.message('p','owner',req);assert.equal(result.messages.length,2);const same=await service.message('p','owner',req);assert.equal(calls,1);assert.equal(same.plans[0].id,result.plans[0].id);await service.execute('p','owner',result.plans[0].id,{baseRevisionId:'r'});await service.execute('p','owner',result.plans[0].id,{baseRevisionId:'r'});assert.equal(execs,1);assert.equal(service.snapshot('p','owner').plans[0].status,'completed');await assert.rejects(()=>service.message('p','owner',{...req,text:'Different'}),/different/)});

test('explicit edit intents build reviewable plans without classification or execution',async()=>{
 const db={jobs:{}};let calls=0,execs=0;
 const service=createConversationService({db,save:()=>{},getProject:()=>p,classify:async()=>{calls++;return {action:'clarify'}},execute:async()=>{execs++;return {}}});
 for(const [intent,text] of [['mute','Silence this section.'],['gain','Lower the volume by 6 dB.'],['replace_audio','Use my recording.'],['replace_picture','Use my replacement.'],['picture','Make the sky orange.'],['object','Change the socks at 3 seconds.'],['generate_audio','Create a calm soundtrack.']]){
  const result=await service.message('p','owner',{...input,text,start:1,end:4,intent,idempotencyKey:`manual-${intent}-001`});
  const plan=result.plans.at(-1),user=result.messages.at(-2);
  assert.equal(plan.action,intent);assert.equal(plan.decision.source,'manual');
  assert.ok(['ready','needs_input'].includes(plan.status));assert.equal(plan.jobId,undefined);
  assert.equal(user.intent,intent);assert.equal(user.text,text);assert.equal(user.quality,'standard');
  assert.equal(Object.hasOwn(plan,'instruction'),false);assert.equal(Object.hasOwn(plan,'editInstruction'),false);
  if(intent==='object'){assert.equal(plan.uiAction,'select_object');assert.equal(plan.status,'needs_input');assert.equal(plan.start,3);assert.match(db.conversations.p.plans.at(-1).editInstruction,/selected interval/);}
 }
 assert.equal(calls,0);assert.equal(execs,0);assert.deepEqual(db.jobs,{});
});

test('invalid explicit intents reject before saving or classification',async()=>{
 const db={jobs:{}};let saves=0,calls=0;
 const service=createConversationService({db,save:()=>saves++,getProject:()=>p,classify:async()=>{calls++;return {action:'mute'}},execute:async()=>{throw new Error('Unexpected execution')}});
 for(const intent of ['apply','undo','export','clarify','execute_shell','PICTURE','',null,false,{},[]]){
  await assert.rejects(()=>service.message('p','owner',{...input,intent,idempotencyKey:'invalid-intent-001'}),/intent|kind of change/i);
 }
 assert.equal(saves,0);assert.equal(calls,0);assert.equal(db.conversations.p?.messages.length??0,0);
});

test('manual intent remains subject to range, revision, and quality validation before saving',async()=>{
 const db={jobs:{}};let saves=0,calls=0;
 const service=createConversationService({db,save:()=>saves++,getProject:()=>p,classify:async()=>{calls++;return {action:'picture'}},execute:async()=>{throw new Error('Unexpected execution')}});
 for(const patch of [{baseRevisionId:'stale'},{quality:'ultra'},{start:8,end:9},{text:'Change socks at 99 seconds'}]){
  await assert.rejects(()=>service.message('p','owner',{...input,text:'Change this.',intent:'picture',idempotencyKey:'invalid-manual-scope',...patch}),/range|revision|quality/i);
 }
 assert.equal(saves,0);assert.equal(calls,0);assert.equal(db.conversations.p?.messages.length??0,0);
});

test('idempotency distinguishes changed explicit intent and preserves an identical selection',async()=>{
 const db={jobs:{}};let calls=0;
 const service=createConversationService({db,save:()=>{},getProject:()=>p,classify:async()=>{calls++;return {action:'picture'}},execute:async()=>({})});
 const request={...input,text:'Make this warmer.',intent:'picture',idempotencyKey:'manual-idempotency'};
 const first=await service.message('p','owner',request),same=await service.message('p','owner',request);
 assert.equal(first.plans[0].id,same.plans[0].id);assert.equal(same.messages.length,2);
 await assert.rejects(()=>service.message('p','owner',{...request,intent:'object'}),/different inputs/i);
 await assert.rejects(()=>service.message('p','owner',{...request,intent:undefined}),/different inputs/i);
 assert.equal(calls,0);assert.equal(db.conversations.p.plans.length,1);
});

test('uncertain classification invites an edit-type choice without claiming the instruction lacks detail',async()=>{
 const db={jobs:{}};
 const service=createConversationService({db,save:()=>{},getProject:()=>p,classify:async()=>({action:'clarify',source:'clarify',confidence:.66}),execute:async()=>{throw new Error('Unexpected execution')}});
 const result=await service.message('p','owner',{...input,text:'Change the socks to black at 3 seconds.',idempotencyKey:'uncertain-choice'});
 const plan=result.plans[0];assert.equal(plan.status,'needs_input');assert.match(plan.explanation,/choose.*kind of change/i);
 assert.equal(Object.hasOwn(result.messages[0],'intent'),false);
});

test('user messages persist explicit Draft and default Standard quality across reload',async()=>{
 const db={jobs:{}};
 const options={db,save:()=>{},getProject:()=>p,classify:async()=>({action:'clarify',source:'clarify'}),execute:async()=>{throw new Error('Unexpected execution')}};
 const service=createConversationService(options);
 await service.message('p','owner',{...input,text:'Change the socks.',quality:'draft',idempotencyKey:'draft-clarification'});
 await service.message('p','owner',{...input,text:'Change the socks.',quality:'draft',intent:'object',idempotencyKey:'draft-manual-choice'});
 await service.message('p','owner',{...input,text:'Make this warmer.',quality:undefined,idempotencyKey:'standard-clarification'});
 const reloaded=createConversationService({...options,db:structuredClone(db)}).snapshot('p','owner');
 assert.deepEqual(reloaded.messages.filter(message=>message.role==='user').map(message=>({quality:message.quality,intent:message.intent})),[
  {quality:'draft',intent:undefined},{quality:'draft',intent:'object'},{quality:'standard',intent:undefined},
 ]);
 assert.equal(reloaded.plans[1].route.resolution,'480p');
});

test('explicit temporal language never silently falls back or drops units/signs',()=>{
 for(const text of ['Mute from -2 to 3 seconds','Mute 3 to 5 minutes','Mute the first few seconds','Mute from 1 to 3 and from 4 to 5 seconds'])assert.throws(()=>buildEditPlan(p,{...input,text},{action:'mute'}),/time|range|seconds/i);
 const first=buildEditPlan(p,{...input,text:'Mute the first 3 seconds'},{action:'mute'});assert.equal(first.end,3);
 const frame=buildEditPlan(p,{...input,text:'Change the socks at 3 seconds'},{action:'object'});assert.equal(frame.start,3);assert.ok(Math.abs(frame.end-3-1/30)<1e-6);
});
test('orphaned routing request becomes explicit interrupted response without replay',async()=>{
 const db={jobs:{}};let release;const service=createConversationService({db,save:()=>{},getProject:()=>p,classify:()=>new Promise(r=>release=r),execute:()=>{}});const pending=service.message('p','o',{...input,idempotencyKey:'orphan-request'});const snapshot=structuredClone(db);
 const resumed=createConversationService({db:snapshot,save:()=>{},getProject:()=>p,classify:()=>{throw new Error('must not replay')},execute:()=>{}});const data=await resumed.message('p','o',{...input,idempotencyKey:'orphan-request'});assert.match(data.messages.at(-1).text,/interrupted/i);assert.equal(snapshot.conversations.p.requests['orphan-request'].status,'interrupted');release({action:'mute'});await pending;
});

test('reload reveals interrupted routing once, without reissuing a request',async()=>{
 const db={jobs:{}};let release;const service=createConversationService({db,save:()=>{},getProject:()=>p,classify:()=>new Promise(r=>release=r),execute:()=>{}});const pending=service.message('p','o',{...input,idempotencyKey:'reload-request'});
 assert.equal(service.snapshot('p','o').messages.length,1);
 const resumed=createConversationService({db:structuredClone(db),save:()=>{},getProject:()=>p,classify:()=>{throw new Error('must not call')},execute:()=>{}});
 assert.match(resumed.snapshot('p','o').messages.at(-1).text,/interrupted/i);assert.equal(resumed.snapshot('p','o').messages.length,2);
 release({action:'mute'});await pending;
});

test('provider edit instruction removes project times while preserving user history',()=>{
 for(const text of ['Change socks at 3 seconds','Change socks from 3 to 5 seconds','Change socks in the last 2 seconds']){
  const plan=buildEditPlan(p,{...input,text},{action:'object'});assert.equal(plan.instruction,text);assert.doesNotMatch(plan.editInstruction,/at 3|3 to 5|last 2/);assert.match(plan.editInstruction,/selected interval/);
 }
});


test('generation plans disclose processing context separately from the unchanged application range',()=>{
 for(const [start,end,processStart,processEnd] of [[0,2,0,4],[3,5,2,6],[6,8,4,8]]){
  for(const action of ['picture','object','generate_audio']){
   const plan=buildEditPlan(p,{...input,text:'Create the requested change',start,end},{action});
   assert.ok(plan.start===start);assert.equal(plan.end,end);
   assert.equal(plan.processStart,processStart);assert.equal(plan.processEnd,processEnd);
   assert.equal(plan.inputDuration,processEnd-processStart+Math.max(0,.5-(processEnd-end)));
  }
 }
 const local=buildEditPlan(p,input,{action:'mute'});assert.equal(local.processStart,undefined);assert.equal(local.inputDuration,undefined);
});

test('idempotent preparation identifies its original plan after later messages',async()=>{
 const db={jobs:{},candidates:{}};const service=createConversationService({db,save:()=>{},getProject:()=>p,classify:async()=>({action:'mute'}),execute:async()=>({})});
 const request={...input,idempotencyKey:'original-plan-id'};
 const first=await service.message('p','o',request);
 const later=await service.message('p','o',{...request,text:'Mute from 2 to 4 seconds',idempotencyKey:'newer-plan-id'});
 const retry=await service.message('p','o',request);
 assert.equal(first.requestedPlanId,first.plans[0].id);
 assert.notEqual(first.requestedPlanId,later.requestedPlanId);
 assert.equal(retry.requestedPlanId,first.requestedPlanId);
 assert.notEqual(retry.requestedPlanId,retry.plans.at(-1).id);
});

test('short provider selections get context and too-short sources fail before upload',()=>{const w=computeGenerationWindow({duration:6,width:752,height:416},0,1.8);assert.equal(w.processEnd,4);assert.equal(w.pricingDimensions.inputSeconds,4);assert.throws(()=>computeGenerationWindow({duration:3,width:752,height:416},0,1),/4 seconds/);});

test('reference attachments are project-owned, frozen with plans and included in idempotency',async()=>{
 const db={jobs:{},assets:{ref:{id:'ref',projectId:'p',kind:'reference-image',name:'desired.png',url:'/media/ref.png',path:'private'},foreign:{id:'foreign',projectId:'other',kind:'reference-image'}}};
 const service=createConversationService({db,save:()=>{},getProject:()=>p,classify:async()=>({action:'picture'}),execute:async()=>({})});
 const request={...input,text:'Make the sky match this',referenceImageId:'ref',idempotencyKey:'reference-test-001'};
 const reply=await service.message('p','owner',request);assert.equal(reply.plans[0].referenceImage.id,'ref');assert.equal(reply.messages[0].referenceImage.id,'ref');assert.equal(reply.plans[0].referenceImage.path,undefined);
 db.assets.ref.name='later';assert.equal(service.snapshot('p','owner').plans[0].referenceImage.name,'desired.png');
 await assert.rejects(()=>service.message('p','owner',{...request,referenceImageId:undefined}),/different/);
 await assert.rejects(()=>service.message('p','owner',{...request,referenceImageId:'foreign',idempotencyKey:'foreign-reference-001'}),/project/);
});

test('routing receives active object and selected range without authorizing execution',async()=>{let context;const service=createConversationService({db:{jobs:{}},save:()=>{},getProject:()=>p,classify:async request=>{context=request.context;return {action:'object',source:'jev'};}});const result=await service.message('p','owner',{...input,text:'Change its material',start:2,end:4,idempotencyKey:'object-context-test',selectionContext:{hasMask:true,reviewed:true,maskCount:60,objectName:'Car'}});assert.equal(context.hasMask,true);assert.equal(context.selectedObjectName,'Car');assert.deepEqual(context.selectedRange,{start:2,end:4});assert.equal(result.plans[0].status,'needs_input');});

test('references to the current frame or selected frames inherit the visible timeline range',()=>{
 for(const text of ['have in this frame a hyperrealistic transformers movie transformation from the car into a mechanical humanoid robot','Change the car across the selected frames','Make this frame cinematic','Replace the object within the current time range']){
 const plan=buildEditPlan(p,{...input,text,start:76/30,end:151/30},{action:'object'});assert.equal(plan.start,76/30,text);assert.equal(plan.end,151/30,text);
 }
 const explicit=buildEditPlan(p,{...input,text:'Change this frame at 3 seconds',start:76/30,end:151/30},{action:'object'});assert.equal(explicit.start,3);assert.ok(Math.abs(explicit.end-3-1/30)<1e-6);
 assert.throws(()=>buildEditPlan(p,{...input,text:'Change this frame from -2 to 3 seconds'},{action:'object'}),/nonnegative/);
});

test('end selection prices input tail protection',()=>{const w=computeGenerationWindow({duration:5,width:1280,height:720},2.5,5);assert.equal(w.processEnd,5);assert.equal(w.tailPadding,.5);assert.equal(w.pricingDimensions.inputSeconds,4.5);assert.equal(w.pricingDimensions.outputSeconds,4.5);});
