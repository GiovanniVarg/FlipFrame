import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('conversation plans persist, isolate owners and execute local edits once',async()=>{
 const base='http://127.0.0.1:'+await port(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lab-chat-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:new URL(base).port,LAB_MODE:'authenticated-local',APP_ORIGIN:base,LAB_DATA_DIR:dir,TYPESAFE_API_KEY:'',HF_CREDENTIALS:'',HIGGSFIELD_API_KEY:'',HIGGSFIELD_API_SECRET:'',HIGGSFIELD_TEST_BUDGET_USD:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',b=>log+=b);child.stdout.on('data',b=>log+=b);
 const call=async(url,body,cookie)=>fetch(base+url,{method:body===undefined?'GET':'POST',headers:{Origin:base,...(body===undefined||body instanceof FormData?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,log);
  const signup=async(email)=>{const r=await call('/api/auth/signup',{email,password:'a sufficiently long test passphrase'});assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0]};const a=await signup('a@chat.test'),b=await signup('b@chat.test');
  const form=new FormData();form.append('file',new Blob([fs.readFileSync(new URL('./test-source.mp4',import.meta.url))]),'Conversation QA.mp4');const p=await(await call('/api/projects',form,a)).json();
  const route='/api/projects/'+p.id+'/conversation';assert.equal((await call(route,undefined,b)).status,404);
  const input={text:'Mute from 1 to 3 seconds',baseRevisionId:p.activeRevisionId,start:0,end:p.duration,quality:'standard',idempotencyKey:'chat-mute-test-1'};
  const reply=await(await call(route,input,a)).json();assert.equal(reply.messages.length,2);const plan=reply.plans[0];assert.equal(plan.route.kind,'local');assert.equal(plan.start,1);assert.equal(plan.end,3);
  assert.equal((await(await call(route,input,a)).json()).plans.length,1);assert.equal((await call(route,{...input,text:'undo'},a)).status,400);
  const execute=route+'/plans/'+plan.id+'/execute';assert.equal((await call(execute,{baseRevisionId:p.activeRevisionId},b)).status,404);
  const first=await(await call(execute,{baseRevisionId:p.activeRevisionId},a)).json();const second=await(await call(execute,{baseRevisionId:p.activeRevisionId},a)).json();assert.equal(first.job.id,second.job.id);assert.equal(first.job.generation,undefined);
  let j;for(let i=0;i<600;i++){j=await(await call('/api/jobs/'+first.job.id,undefined,a)).json();if(['completed','failed'].includes(j.status))break;await new Promise(r=>setTimeout(r,150));}assert.equal(j.status,'completed',JSON.stringify(j));
  const apply=await(await call(route,{...input,text:'apply',idempotencyKey:'chat-apply-test-1'},a)).json();const ap=apply.plans.at(-1);const applied=await(await call(route+'/plans/'+ap.id+'/execute',{baseRevisionId:p.activeRevisionId,candidateId:j.result.id},a)).json();assert.equal(applied.project.activeRevisionId,j.result.id);
  const stale=await call(route+'/plans/'+plan.id+'/execute',{baseRevisionId:j.result.id},a);assert.equal(stale.status,200);assert.equal((await stale.json()).job.id,j.id,'Completed job is not replayed after revision change');
  const undo=await(await call(route,{...input,text:'undo',baseRevisionId:j.result.id,idempotencyKey:'chat-undo-test-1'},a)).json();const undone=await(await call(route+'/plans/'+undo.plans.at(-1).id+'/execute',{baseRevisionId:j.result.id},a)).json();assert.equal(undone.project.activeRevisionId,p.activeRevisionId);
  const replay=await(await call(route+'/plans/'+ap.id+'/execute',{baseRevisionId:p.activeRevisionId,candidateId:j.result.id},a)).json();assert.equal(replay.project.activeRevisionId,p.activeRevisionId,'Idempotent reply reflects current project');
  const trimReply=await(await call(route,{...input,text:'trim selected range',start:1,end:3,idempotencyKey:'chat-trim-test'},a)).json();const tp=trimReply.plans.at(-1);assert.equal(tp.tool,'trim');
  const tj=await(await call(route+'/plans/'+tp.id+'/execute',{baseRevisionId:p.activeRevisionId},a)).json();assert.ok(tj.job,JSON.stringify(tj));
  let trimmed;for(let i=0;i<600;i++){trimmed=await(await call('/api/jobs/'+tj.job.id,undefined,a)).json();if(['completed','failed'].includes(trimmed.status))break;await new Promise(r=>setTimeout(r,150));}assert.equal(trimmed.status,'completed',JSON.stringify(trimmed));assert.equal(trimmed.result.mediaMetadata.duration,2);
  const appliedTrim=await(await call('/api/projects/'+p.id+'/apply',{candidateId:trimmed.result.id,baseRevisionId:p.activeRevisionId},a)).json();assert.equal(appliedTrim.duration,2);
  const restored=await(await call('/api/projects/'+p.id+'/undo',{},a)).json();assert.equal(restored.duration,p.duration);assert.equal(restored.activeRevisionId,p.activeRevisionId);
  assert.equal((await(await call('/api/capabilities',undefined,a)).json()).budget.reserved,0);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:300});}
});
