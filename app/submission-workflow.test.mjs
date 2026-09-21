import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('submission rehearsal: sample, conversation, candidate, export and undo with provider network forbidden',{timeout:90000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lab-submission-'));
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const base=`http://127.0.0.1:${port}`,network=path.join(dir,'network-attempted');
 const preload=path.join(dir,'deny-network.mjs');fs.writeFileSync(preload,`import fs from 'node:fs';globalThis.fetch=async()=>{fs.writeFileSync(${JSON.stringify(network)},'blocked');throw Error('Provider network forbidden in rehearsal');};`);
 const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),LAB_MODE:'local',LAB_DATA_DIR:dir,TYPESAFE_API_KEY:'',HF_CREDENTIALS:'',HIGGSFIELD_API_KEY:'',HIGGSFIELD_API_SECRET:'',HIGGSFIELD_TEST_BUDGET_USD:'0'},stdio:'ignore'});
 const closed=new Promise(resolve=>child.once('close',resolve));let spawnError;child.on('error',e=>{spawnError=e});
 async function call(route,body){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;}
 try{
  let ready=false;for(let n=0;n<100;n++){if(spawnError)throw spawnError;if(child.exitCode!==null)throw Error('Rehearsal server exited');try{ready=(await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).ok;}catch{}if(ready)break;await pause(100)}assert.ok(ready,'Server did not start');
  const p=await call('/api/projects/example',{});assert.ok(p.sample);assert.equal((await call('/api/projects/example',{})).id,p.id,'Sample import is idempotent');
  const original=Buffer.from(await(await fetch(base+p.sourceUrl)).arrayBuffer());
  const route=`/api/projects/${p.id}/conversation`;
  const input={text:'Mute from 2 to 4 seconds',start:0,end:p.duration,baseRevisionId:p.activeRevisionId,quality:'standard',idempotencyKey:'submission-mute-rehearsal'};
  const reply=await call(route,input),plan=reply.plans.find(item=>item.id===reply.requestedPlanId);assert.ok(plan);assert.equal(plan.route.kind,'local');assert.equal(plan.start,2);assert.equal(plan.end,4);
  assert.equal((await call(`/api/projects/${p.id}/jobs`)).length,0,'Preparing a plan does not run an edit');
  const execute=`${route}/plans/${plan.id}/execute`,first=await call(execute,{baseRevisionId:p.activeRevisionId});assert.equal((await call(execute,{baseRevisionId:p.activeRevisionId})).job.id,first.job.id);
  let job;for(let n=0;n<150;n++){job=await call('/api/jobs/'+first.job.id);if(['completed','failed','unknown'].includes(job.status))break;await pause(200)}assert.equal(job.status,'completed',job.error);
  const candidate=job.result;assert.ok(candidate?.url);assert.equal((await call('/api/projects/'+p.id)).activeRevisionId,p.activeRevisionId,'Candidate is not auto-applied');
  const library=`/api/projects/${p.id}/candidates`;
  await call(`${library}/${candidate.id}/details`,{name:'Rehearsal favorite',favorite:true});
  await call(`${library}/${candidate.id}/review`,{dismissed:true});
  let saved=(await call(library)).find(c=>c.id===candidate.id);
  assert.equal(saved.name,'Rehearsal favorite');assert.equal(saved.favorite,true);assert.ok(saved.dismissedAt);assert.equal(saved.canApply,true);
  await call(`${library}/${candidate.id}/review`,{dismissed:false});
  assert.equal((await call(library)).find(c=>c.id===candidate.id).dismissedAt,null);
  assert.equal((await call(`/api/projects/${p.id}/jobs`)).length,1,'Saving and reopening never generates another job');
  const comparison=await call(`${library}/${candidate.id}/comparison`);assert.equal(comparison.originalUrl,p.revisions.find(r=>r.id===p.activeRevisionId).url);
  const note={key:'rehearsal-note',time:2,text:'Check soundtrack transition here.'};
  assert.equal((await call(`${library}/${candidate.id}/notes`,note)).length,1);
  assert.equal((await call(`${library}/${candidate.id}/notes`,note)).length,1,'Retry does not duplicate notes');
  const batch=await call(`/api/projects/${p.id}/batches`,{baseRevisionId:p.activeRevisionId,start:0,end:5,quality:'standard',prompts:['Use warm lighting','Use cool lighting']});
  assert.equal(batch.canApprove,false,'Zero-budget rehearsal must block generation');
  const blocked=await fetch(base+`/api/projects/${p.id}/batches/${batch.id}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true})});assert.equal(blocked.ok,false);
  assert.equal((await call(`/api/projects/${p.id}/jobs`)).length,1,'Blocked batch never queues generation');
  const applied=await call(`/api/projects/${p.id}/apply`,{candidateId:candidate.id,baseRevisionId:p.activeRevisionId});assert.equal(applied.activeRevisionId,candidate.id);
  assert.equal((await call(library)).find(c=>c.id===candidate.id).canApply,false,'Applied candidates cannot be applied again');
  const exported=await fetch(base+candidate.url,{headers:{Range:'bytes=0-63'}});assert.equal(exported.status,206);assert.match(exported.headers.get('content-type'),/video/);assert.equal((await exported.arrayBuffer()).byteLength,64);
  const restored=await call(`/api/projects/${p.id}/undo`,{});assert.equal(restored.activeRevisionId,p.activeRevisionId);assert.deepEqual(Buffer.from(await(await fetch(base+p.sourceUrl)).arrayBuffer()),original,'Source bytes preserved');
  const budget=(await call('/api/capabilities')).budget;assert.equal(budget.reserved,0);assert.equal(budget.spent,0);assert.equal(fs.existsSync(network),false,'No provider request attempted');
 }finally{
  if(child.exitCode===null)child.kill();await Promise.race([closed,pause(3000)]);
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));
  if(child.exitCode!==null)fs.rmSync(dir,{recursive:true,force:true});
 }
});
