import test from 'node:test';import assert from 'node:assert/strict';import {createBatches} from './batch-variations.mjs';
const input={prompts:['Make the sky orange','Make the sky blue'],baseRevisionId:'r',start:0,end:5,quality:'standard'};
function setup(limit=50,failAt=0){const p={id:'p',ownerId:'a',duration:8,width:1280,height:720,activeRevisionId:'r'},db={projects:{p},jobs:{},spend:{spent:0,reserved:0}};let calls=0;const s=createBatches({db,save(){},getProject(id,owner){if(id!=='p'||owner!=='a')throw Error('not found');return p},budgetLimit:()=>limit,queue(p,i){if(++calls===failAt)throw Error('queue failed');const j={id:'j'+calls,provider:'higgsfield',status:'queued',input:i};db.jobs[j.id]=j;return j}});return {s,db,p,get calls(){return calls}}}
test('review creates no jobs and execution is idempotent',()=>{const x=setup(),b=x.s.prepare('p','a',input);assert.equal(x.calls,0);assert.equal(b.hold,b.total*2);assert.throws(()=>x.s.run('p','a',b.id,{}));x.s.run('p','a',b.id,{confirmed:true});x.s.run('p','a',b.id,{confirmed:true});assert.equal(x.calls,2)});
test('budget, revision and owner gates queue nothing',()=>{const x=setup(1),b=x.s.prepare('p','a',input);assert.throws(()=>x.s.run('p','a',b.id,{confirmed:true}),/budget/);assert.equal(x.calls,0);x.p.activeRevisionId='new';assert.throws(()=>x.s.run('p','a',b.id,{confirmed:true}),/Revision/);assert.throws(()=>x.s.list('p','b'));});
test('failed queue rolls back every new job',()=>{const x=setup(50,2),b=x.s.prepare('p','a',input);assert.throws(()=>x.s.run('p','a',b.id,{confirmed:true}));assert.equal(Object.keys(x.db.jobs).length,0);assert.equal(b.jobIds.length,0)});

test('review exposes budget block before approval and rejects a changed prompt range',()=>{const x=setup(1),b=x.s.prepare('p','a',input);assert.equal(b.canApprove,false);assert.match(b.blockedReason,/budget/);assert.equal(b.availableBudget,1);assert.throws(()=>x.s.prepare('p','a',{...input,prompts:['Make sky blue from 1 to 3 seconds','Make sky orange']}),/selected range/);assert.equal(x.calls,0)});
test('completed versions link only to candidates owned by the batch project',()=>{const x=setup();const b=x.s.prepare('p','a',input);const run=x.s.run('p','a',b.id,{confirmed:true});x.db.candidates={c:{id:'c',projectId:'p'},foreign:{id:'foreign',projectId:'q'}};x.db.jobs[run.jobIds[0]].result={id:'c'};x.db.jobs[run.jobIds[1]].result={id:'foreign'};const result=x.s.list('p','a')[0];assert.equal(result.jobs[0].candidateId,'c');assert.equal(result.jobs[1].candidateId,undefined);assert.equal(result.jobs[1].version,2)});
test('invalid ledger and expired review disable approval',()=>{const x=setup();const b=x.s.prepare('p','a',input);x.db.spend.reserved=NaN;assert.equal(x.s.list('p','a')[0].canApprove,false);assert.throws(()=>x.s.run('p','a',b.id,{confirmed:true}),/budget/);x.db.spend.reserved=0;x.p.batches[b.id].createdAt='2000-01-01';assert.match(x.s.list('p','a')[0].blockedReason,/expired/)});

test('batch persists jobs and links together before scheduling',()=>{
 const p={id:'p',duration:8,width:1280,height:720,activeRevisionId:'r'},db={projects:{p},jobs:{},spend:{spent:0,reserved:0}};const snapshots=[];let scheduled=0;
 const save=()=>snapshots.push(structuredClone(db));
 const s=createBatches({db,save,getProject:()=>p,budgetLimit:()=>50,schedule(){scheduled++;assert.equal(snapshots.at(-1).projects.p.batches[b.id].jobIds.length,2)},queue(p,input,ref,refId,options){assert.equal(options.deferCommit,true);const j={id:'j'+Object.keys(db.jobs).length};db.jobs[j.id]=j;return j}});
 const b=s.prepare('p','a',input);s.run('p','a',b.id,{confirmed:true});assert.equal(scheduled,1);assert.equal(snapshots.length,2);
 for(const snapshot of snapshots)for(const j of Object.values(snapshot.jobs)){assert.equal(j.batchId,b.id);assert.ok(snapshot.projects.p.batches[b.id].jobIds.includes(j.id));}
});
test('failed atomic save rolls back memory and never schedules',()=>{
 const p={id:'p',duration:8,width:1280,height:720,activeRevisionId:'r'},db={projects:{p},jobs:{},spend:{spent:0,reserved:0}};let fail=false,scheduled=0;
 const s=createBatches({db,save(){if(fail)throw Error('disk full')},getProject:()=>p,budgetLimit:()=>50,schedule(){scheduled++},queue(){const j={id:'j'+Object.keys(db.jobs).length};db.jobs[j.id]=j;return j}});
 const b=s.prepare('p','a',input);fail=true;assert.throws(()=>s.run('p','a',b.id,{confirmed:true}),/disk full/);assert.equal(Object.keys(db.jobs).length,0);assert.equal(p.batches[b.id].jobIds.length,0);assert.equal(scheduled,0);
});
test('expired unsubmitted plans do not exhaust capacity; submitted history survives',()=>{
 const x=setup();for(let i=0;i<30;i++)x.p.batches={...x.p.batches,['old'+i]:{jobIds:[],createdAt:'2000-01-01'}};
 x.p.batches.kept={jobIds:['historic'],createdAt:'2000-01-01'};x.s.prepare('p','a',input);assert.equal(Object.keys(x.p.batches).length,2);assert.ok(x.p.batches.kept);
});

test('legacy orphan jobs reconnect without submitting missing versions',()=>{
 const p={id:'p',activeRevisionId:'r',batches:{b:{id:'b',plans:[{id:'one'},{id:'two'}],jobIds:[],createdAt:new Date().toISOString(),baseRevisionId:'r',hold:1}}},db={projects:{p},jobs:{j:{id:'j',projectId:'p',idempotencyKey:'batch-b-one',status:'queued',provider:'higgsfield'}},spend:{spent:0,reserved:0}};let saves=0;
 const s=createBatches({db,save(){saves++},getProject:()=>p,budgetLimit:()=>50,queue(){throw Error('must not enqueue')}});
 assert.equal(saves,1);assert.deepEqual(p.batches.b.jobIds,['j']);assert.equal(db.jobs.j.batchId,'b');assert.deepEqual(s.run('p','a','b',{confirmed:true}).jobIds,['j']);
});
