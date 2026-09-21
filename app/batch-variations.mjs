import {randomUUID} from 'node:crypto';
import {buildEditPlan} from './conversation.mjs';
import {ownedReference} from './reference-images.mjs';
export function createBatches({db,save,getProject,queue,budgetLimit,schedule=()=>{}}){
 // Recover links written by older non-atomic enqueue code without submitting anything.
 let recovered=false;
 for(const p of Object.values(db.projects||{}))for(const b of Object.values(p.batches||{})){
  if(b.jobIds?.length||!Array.isArray(b.plans))continue;
  const jobs=b.plans.map(plan=>Object.values(db.jobs).find(j=>j.projectId===p.id&&j.idempotencyKey==='batch-'+b.id+'-'+plan.id)).filter(Boolean);
  if(jobs.length){b.jobIds=jobs.map(j=>j.id);for(const j of jobs)j.batchId=b.id;recovered=true;}
 }
 if(recovered)save();
 function readiness(p,b){
 const limit=budgetLimit(),reserved=db.spend?.reserved??0,spent=db.spend?.spent??0;
 const valid=[limit,reserved,spent].every(Number.isFinite)&&limit>0&&reserved>=0&&spent>=0;
 const available=valid?Math.max(0,limit-reserved-spent):0;
 let reason='';
 if(!valid)reason='A valid workspace budget is required.';
 else if(p.activeRevisionId!==b.baseRevisionId)reason='Revision changed. Prepare a new batch.';
 else if(!Number.isFinite(Date.parse(b.createdAt))||Date.now()-Date.parse(b.createdAt)>15*60000)reason='Batch review expired. Prepare a new batch.';
 else if(Object.values(db.jobs).some(j=>j.provider&&['queued','running','unknown'].includes(j.status))||Object.values(db.originals||{}).some(j=>['queued','running','unknown'].includes(j.status)))reason='Finish or reconcile existing provider work before running a batch.';
 else if(!Number.isFinite(b.hold)||b.hold<=0||b.hold>available)reason='Not enough unreserved budget for this batch. No generation was queued.';
 return {canApprove:!reason&&!b.jobIds.length,blockedReason:b.jobIds.length?'':reason,availableBudget:available};
 }
 const snapshot=(p,b)=>({...b,...readiness(p,b),jobs:b.jobIds.map((id,index)=>{const job=db.jobs[id],candidate=job?.result?.id&&db.candidates[job.result.id];return {id,version:index+1,status:job?.status||'unavailable',error:job?.error,candidateId:candidate?.projectId===p.id?candidate.id:undefined};})});
 const get=(pid,owner,id)=>{const p=getProject(pid,owner),b=p.batches?.[id];if(!b)throw Error('Batch not found');return [p,b]};
 const prepare=(pid,owner,input)=>{const p=getProject(pid,owner);if(!Array.isArray(input.prompts)||input.prompts.length<2||input.prompts.length>3||input.prompts.some(t=>typeof t!=='string'||!t.trim()||t.length>3000))throw Error('Provide two or three prompts, each up to 3000 characters.');if(Object.values(p.batches||{}).filter(b=>!b.jobIds.length&&Date.now()-Date.parse(b.createdAt)<=15*60000).length>=30)throw Error('Batch plan limit reached.');
 const ref=ownedReference(db,pid,input.referenceImageId);const plans=input.prompts.map(text=>buildEditPlan(p,{...input,text},{action:'picture',source:'manual'}));if(plans.some(plan=>plan.start!==input.start||plan.end!==input.end))throw Error('Every version must use the selected range. Remove time instructions from the prompts.');if(plans.some(p=>p.status!=='ready'||p.route.estimatedUsd>5))throw Error('Select a shorter range or Draft quality.');
 const total=Number(plans.reduce((n,p)=>n+p.route.estimatedUsd,0).toFixed(2));const b={id:randomUUID(),baseRevisionId:p.activeRevisionId,plans,referenceImageId:ref?.id,total,hold:Number((total*2).toFixed(2)),createdAt:new Date().toISOString(),jobIds:[]};const old=p.batches;p.batches={...Object.fromEntries(Object.entries(old||{}).filter(([,v])=>v.jobIds.length||!Number.isFinite(Date.parse(v.createdAt))||Date.now()-Date.parse(v.createdAt)<=15*60000)),[b.id]:b};try{save()}catch(e){p.batches=old;throw e}return snapshot(p,b);};
 const run=(pid,owner,id,input)=>{const [p,b]=get(pid,owner,id);if(b.jobIds.length)return snapshot(p,b);if(input.confirmed!==true)throw Error('Confirm the combined cost first.');const check=readiness(p,b);if(!check.canApprove)throw Error(check.blockedReason);
 const reference=ownedReference(db,pid,b.referenceImageId),before=new Set(Object.keys(db.jobs));try{b.jobIds=b.plans.map(plan=>queue(p,{baseRevisionId:b.baseRevisionId,start:plan.start,end:plan.end,kind:'video',operation:'picture',prompt:plan.editInstruction??plan.instruction,resolution:plan.route.resolution,approvedEstimateUsd:plan.route.estimatedUsd,idempotencyKey:'batch-'+b.id+'-'+plan.id},reference?db.assets[reference.id].path:undefined,reference?.id,{deferCommit:true}).id);for(const jobId of b.jobIds)db.jobs[jobId].batchId=b.id;save()}catch(e){for(const id of Object.keys(db.jobs))if(!before.has(id))delete db.jobs[id];b.jobIds=[];throw e}schedule();return snapshot(p,b)};
 return {prepare,run,list:(pid,owner)=>{const p=getProject(pid,owner);return Object.values(p.batches||{}).map(b=>snapshot(p,b))}};
}
export function registerBatches(app,deps){const s=createBatches(deps);app.get('/api/projects/:id/batches',(req,res,next)=>{try{res.json(s.list(req.params.id,req.user.id))}catch(e){next(e)}});app.post('/api/projects/:id/batches',(req,res,next)=>{try{res.json(s.prepare(req.params.id,req.user.id,req.body))}catch(e){next(e)}});app.post('/api/projects/:id/batches/:batchId/run',(req,res,next)=>{try{res.json(s.run(req.params.id,req.user.id,req.params.batchId,req.body))}catch(e){next(e)}});}
