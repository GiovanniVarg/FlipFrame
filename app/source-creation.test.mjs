import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createSourceCreationService,registerSourceCreationRoutes,sourceCreationEstimate} from './source-creation.mjs';

const request={prompt:'A cinematic view of a paper balloon over the ocean',duration:4,resolution:'720p',aspectRatio:'16:9',idempotencyKey:'source-plan-001'};
function fixture(){
 const db={sourceCreations:{},jobs:{},spend:{spent:0,reserved:0}},calls={estimate:0,submit:0,poll:0,import:0};let persisted,importFailure=false;
 const projects=new Map();
 const deps={db,save:()=>{persisted=structuredClone(db);},budgetLimit:80,pollDelay:0,pollAttempts:2,
 adapter:{async estimateGeneration(){calls.estimate++;return {estimatedUsd:.25};},async submitGeneration(input){calls.submit++;const r=Object.values(persisted.sourceCreations)[0];assert.equal(r.submission,'attempting');assert.equal(persisted.spend.reserved,.5);assert.equal(input.kind,'text-to-video');return {requestId:'accepted-1',status:'queued',statusUrl:'https://api.higgsfield.ai/requests/accepted-1/status'};},async pollGeneration(previous){calls.poll++;return {...previous,status:'completed',outputUrl:'https://cdn.example/generated.mp4?token=PRIVATE'};}},
 async importGenerated(record,url){calls.import++;assert.ok(url.startsWith('https://'));if(!projects.has(record.id))projects.set(record.id,{projectId:'project-'+record.id});if(importFailure)throw new Error('PRIVATE /secret/path');return projects.get(record.id);}};
 const service=createSourceCreationService(deps);
 return {db,calls,deps,service,projects,get persisted(){return persisted;},set importFailure(value){importFailure=value;}};
}
async function execute(f,plan){await f.service.execute('alice',plan.id);await f.service.waitForIdle(plan.id);return f.service.get('alice',plan.id);}

test('plans are validated, owner protected, immutable and idempotent without a network call',()=>{
 const f=fixture(),a=f.service.plan('alice',request),same=f.service.plan('alice',request);assert.equal(a.id,same.id);assert.equal(a.status,'planned');assert.equal(a.estimatedUsd,1.98);assert.deepEqual(f.calls,{estimate:0,submit:0,poll:0,import:0});
 assert.throws(()=>f.service.plan('alice',{...request,prompt:'different'}),{status:409});assert.throws(()=>f.service.get('bob',a.id),{status:404});assert.deepEqual(f.service.list('bob'),[]);
 assert.notEqual(f.service.plan('bob',request).id,a.id);
 for(const patch of [{duration:3},{duration:11},{duration:4.5},{resolution:'1080p'},{aspectRatio:'4:3'},{prompt:' '},{prompt:'x'.repeat(3001)},{approvedEstimateUsd:10},{idempotencyKey:'short'}])assert.throws(()=>f.service.plan('alice',{...request,...patch}));
 assert.equal(sourceCreationEstimate({...request,resolution:'480p'}).estimatedUsd,.93);
 assert.deepEqual(sourceCreationEstimate({...request,aspectRatio:'9:16'}).pricingDimensions,{width:768,height:1280,inputSeconds:0,outputSeconds:4});
});

test('one confirmed lifecycle reserves before POST, imports one project and returns no provider metadata',async()=>{
 const f=fixture(),plan=f.service.plan('alice',request);const [a,b]=await Promise.all([f.service.execute('alice',plan.id),f.service.execute('alice',plan.id)]);assert.equal(a.id,b.id);await f.service.waitForIdle(plan.id);
 const result=f.service.get('alice',plan.id);assert.equal(result.status,'completed');assert.ok(result.projectId);assert.equal(result.reservedUsd,.5);assert.equal(f.db.spend.reserved,.5);assert.equal(f.calls.submit,1);assert.equal(f.projects.size,1);assert.ok(!/PRIVATE|requestId|outputUrl|providerState|ownerId/.test(JSON.stringify(result)));
 await f.service.execute('alice',plan.id);assert.equal(f.calls.submit,1);
});

test('quote above reviewed plan, over-budget quote and expired quote cannot submit',async()=>{
 for(const scenario of ['higher','budget','expired']){
  const f=fixture(),plan=f.service.plan('alice',request);let time=0;f.deps.now=()=>time;
  if(scenario==='higher')f.deps.adapter.estimateGeneration=async()=>({estimatedUsd:plan.estimatedUsd+.01});
  if(scenario==='budget')f.deps.budgetLimit=.1;
  if(scenario==='expired')f.deps.adapter.estimateGeneration=async()=>{time=300000;return {estimatedUsd:.25};};
  f.service=createSourceCreationService(f.deps);const result=await execute(f,plan);assert.equal(result.status,'failed');assert.equal(f.calls.submit,0);assert.equal(f.db.spend.reserved,0);
 }
});

test('lost submission response quarantines spend and rejects execute or recover replay',async()=>{
 const f=fixture(),plan=f.service.plan('alice',request);f.deps.adapter.submitGeneration=async()=>{f.calls.submit++;throw new Error('PRIVATE');};
 const result=await execute(f,plan);assert.equal(result.status,'unknown');assert.equal(result.recoverable,false);assert.equal(f.db.spend.reserved,.5);
 await assert.rejects(f.service.execute('alice',plan.id),{status:409});await assert.rejects(f.service.recover('alice',plan.id),{status:409});assert.equal(f.calls.submit,1);
 const second=f.service.plan('alice',{...request,idempotencyKey:'another-plan-001'});await assert.rejects(f.service.execute('alice',second.id),{status:409});
});

test('startup does not execute interrupted work and durable ambiguous marker cannot replay',async()=>{
 const f=fixture(),plan=f.service.plan('alice',request),r=f.db.sourceCreations[plan.id];Object.assign(r,{status:'running',submission:'attempting',reserved:true,reservedUsd:.5});f.db.spend.reserved=.5;
 const restarted=createSourceCreationService(f.deps);assert.equal(restarted.get('alice',plan.id).status,'unknown');await assert.rejects(restarted.recover('alice',plan.id),{status:409});assert.deepEqual(f.calls,{estimate:0,submit:0,poll:0,import:0});assert.equal(f.db.spend.reserved,.5);
});

test('accepted request resumes polling after restart without another estimate, hold or POST',async()=>{
 const f=fixture(),plan=f.service.plan('alice',request);const poll=f.deps.adapter.pollGeneration;f.deps.adapter.pollGeneration=async()=>{f.calls.poll++;throw new Error('PRIVATE');};
 assert.equal((await execute(f,plan)).recoverable,true);assert.equal(f.calls.submit,1);f.deps.adapter.pollGeneration=poll;
 f.service=createSourceCreationService(f.deps);await f.service.recover('alice',plan.id);await f.service.waitForIdle(plan.id);assert.equal(f.service.get('alice',plan.id).status,'completed');assert.equal(f.calls.submit,1);assert.equal(f.calls.estimate,1);assert.equal(f.db.spend.reserved,.5);
});

test('known unknown acceptance recovers by identity without a second POST',async()=>{
 const f=fixture(),plan=f.service.plan('alice',request);f.deps.adapter.submitGeneration=async()=>{f.calls.submit++;return {status:'unknown',requestId:'accepted-1',statusUrl:'https://api.higgsfield.ai/requests/accepted-1/status'};};
 assert.equal((await execute(f,plan)).status,'completed');assert.equal(f.calls.submit,1);assert.equal(f.calls.poll,1);assert.equal(f.db.spend.reserved,.5);
});

test('definite rejected POST and provider-confirmed failure release holds',async()=>{
 for(const accepted of [false,true]){
  const f=fixture(),plan=f.service.plan('alice',request);f.deps.adapter.submitGeneration=async()=>{f.calls.submit++;return {status:'failed',...(accepted?{requestId:'accepted-1'}:{})};};
  const result=await execute(f,plan);assert.equal(result.status,'failed');assert.equal(result.recoverable,false);assert.equal(f.db.spend.reserved,0);await assert.rejects(f.service.recover('alice',plan.id),{status:409});assert.equal(f.calls.submit,1);
 }
});

test('idempotent import recovers a completed generation after project creation without paid replay',async()=>{
 const f=fixture(),plan=f.service.plan('alice',request);f.importFailure=true;const failed=await execute(f,plan);assert.equal(failed.status,'failed');assert.equal(failed.recoverable,true);assert.equal(f.projects.size,1);assert.ok(!failed.error.includes('PRIVATE'));
 f.importFailure=false;await f.service.recover('alice',plan.id);await f.service.waitForIdle(plan.id);assert.equal(f.service.get('alice',plan.id).status,'completed');assert.equal(f.projects.size,1);assert.equal(f.calls.submit,1);assert.equal(f.calls.poll,1);assert.equal(f.calls.import,2);
});

test('unsent recovery refreshes pricing and never trusts prior smaller estimates',async()=>{
 const f=fixture(),plan=f.service.plan('alice',request);f.deps.budgetLimit=.1;f.service=createSourceCreationService(f.deps);await execute(f,plan);assert.equal(f.calls.submit,0);
 f.deps.budgetLimit=80;f.deps.adapter.estimateGeneration=async()=>{f.calls.estimate++;return {estimatedUsd:plan.estimatedUsd+.1};};f.service=createSourceCreationService(f.deps);
 await f.service.recover('alice',plan.id);await f.service.waitForIdle(plan.id);assert.equal(f.calls.estimate,2);assert.equal(f.calls.submit,0);assert.equal(f.db.spend.reserved,0);assert.match(f.service.get('alice',plan.id).error,/reviewed plan/);
});

test('adapter errors with status metadata cannot expose credentials or signed URLs',async()=>{
 const f=fixture(),plan=f.service.plan('alice',request);f.deps.adapter.estimateGeneration=async()=>{throw Object.assign(new Error('PRIVATE https://signed.invalid/token'),{status:403});};
 const result=await execute(f,plan);assert.ok(!/PRIVATE|signed.invalid/.test(JSON.stringify(result)));assert.equal(f.calls.submit,0);
});

test('bounded polling stops safely and malformed identity cannot release accepted billing hold',async()=>{
 const f=fixture(),plan=f.service.plan('alice',request);f.deps.adapter.pollGeneration=async previous=>{f.calls.poll++;return previous;};
 const pending=await execute(f,plan);assert.equal(pending.status,'failed');assert.equal(pending.recoverable,true);assert.equal(f.calls.poll,2);assert.equal(f.calls.submit,1);
 f.deps.adapter.pollGeneration=async()=>({status:'failed'});await f.service.recover('alice',plan.id);await f.service.waitForIdle(plan.id);assert.equal(f.db.spend.reserved,.5);assert.equal(f.calls.submit,1);
});

test('HTTP preparation is free, approval returns 202, and list/status/recovery enforce ownership',async t=>{
 const f=fixture(),app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.headers['x-owner']||'alice'};next();});const service=registerSourceCreationRoutes(app,f.deps);app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/api/creations/plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});assert.equal(response.status,201);const plan=await response.json();assert.equal(f.calls.submit,0);
 assert.equal((await fetch(base+'/api/creations/'+plan.id,{headers:{'x-owner':'bob'}})).status,404);
 for(const action of ['execute','recover'])assert.equal((await fetch(base+'/api/creations/'+plan.id+'/'+action,{method:'POST',headers:{'x-owner':'bob'}})).status,404);
 const execution=await fetch(base+'/api/creations/'+plan.id+'/execute',{method:'POST'});assert.equal(execution.status,202);await service.waitForIdle(plan.id);const status=await (await fetch(base+'/api/creations/'+plan.id)).json();assert.equal(status.status,'completed');
 assert.deepEqual(await (await fetch(base+'/api/creations',{headers:{'x-owner':'bob'}})).json(),[]);
});


test('failure saving the durable submission marker never sends a POST and holds exposure conservatively',async()=>{
 const f=fixture(),plan=f.service.plan('alice',request),save=f.deps.save;let once=true;
 f.deps.save=()=>{if(once&&f.db.sourceCreations[plan.id].submission==='attempting'){once=false;throw new Error('disk interrupted');}save();};
 f.service=createSourceCreationService(f.deps);const result=await execute(f,plan);assert.equal(result.status,'unknown');assert.equal(result.recoverable,false);assert.equal(f.calls.submit,0);assert.equal(f.db.spend.reserved,.5);
});

test('concurrent approved plans share the same budget without overspending',async()=>{
 const f=fixture();f.deps.budgetLimit=.75;f.deps.adapter.submitGeneration=async()=>{f.calls.submit++;return {status:'completed',requestId:'paid-once',outputUrl:'https://cdn.example/source.mp4'};};f.service=createSourceCreationService(f.deps);
 const first=f.service.plan('alice',request),second=f.service.plan('alice',{...request,idempotencyKey:'source-plan-002'});
 await Promise.all([f.service.execute('alice',first.id),f.service.execute('alice',second.id)]);await Promise.all([f.service.waitForIdle(first.id),f.service.waitForIdle(second.id)]);
 assert.equal(f.calls.submit,1);assert.equal(f.db.spend.reserved,.5);assert.deepEqual([f.service.get('alice',first.id).status,f.service.get('alice',second.id).status].sort(),['completed','failed']);
});
