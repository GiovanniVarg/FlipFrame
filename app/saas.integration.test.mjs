import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';import {spawn} from 'node:child_process';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('authenticated app isolates project, media, jobs and allows restore after trash',async()=>{
 const port=await freePort(),base='http://127.0.0.1:'+port,dir=fs.mkdtempSync(path.join(os.tmpdir(),'lab-saas-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),LAB_MODE:'authenticated-local',APP_ORIGIN:base,LAB_DATA_DIR:dir,HF_CREDENTIALS:'',HIGGSFIELD_API_KEY:'',HIGGSFIELD_API_SECRET:'',HIGGSFIELD_TEST_BUDGET_USD:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',b=>log+=b);child.stdout.on('data',b=>log+=b);
 const call=async(url,body,cookie,method)=>{const response=await fetch(base+url,{method:method||(body===undefined?'GET':'POST'),headers:{...(body===undefined?{}:body instanceof FormData?{Origin:base}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});return response;};
 try{let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,log);
  assert.equal((await call('/api/projects')).status,401);
  const signup=async(email)=>{const response=await call('/api/auth/signup',{email,password:'a sufficiently long test passphrase'});assert.equal(response.status,201);return response.headers.get('set-cookie').split(';')[0];};
  const alice=await signup('alice@integration.test'),bob=await signup('bob@integration.test');
  const form=new FormData();form.append('file',new Blob([fs.readFileSync(new URL('./test-source.mp4',import.meta.url))],{type:'video/mp4'}),'Private footage.mp4');const uploaded=await call('/api/projects',form,alice);assert.equal(uploaded.status,201,await uploaded.clone().text());const p=await uploaded.json();assert.ok(p.thumbnailUrl);assert.equal(p.waveform.length,96);
  assert.equal((await call('/api/projects/'+p.id,undefined,bob)).status,404);assert.deepEqual(await (await call('/api/projects',undefined,bob)).json(),[]);
  assert.equal((await call(p.sourceUrl,undefined,bob)).status,404);assert.equal((await call(p.thumbnailUrl,undefined,bob)).status,404);assert.equal((await call(p.sourceUrl,undefined,alice)).status,200);
  const submitted=await call('/api/projects/'+p.id+'/render',{operation:'mute',start:1,end:2,baseRevisionId:p.activeRevisionId},alice);assert.equal(submitted.status,202);const job=await submitted.json();assert.equal((await call('/api/jobs/'+job.id,undefined,bob)).status,404);
  let finished;for(let i=0;i<120;i++){finished=await(await call('/api/jobs/'+job.id,undefined,alice)).json();if(['completed','failed'].includes(finished.status))break;await new Promise(r=>setTimeout(r,100));}assert.equal(finished.status,'completed',JSON.stringify(finished));assert.equal((await call(finished.result.url,undefined,bob)).status,404);
  const generationInput={kind:'video',prompt:'Warm sunset',start:1,end:2,baseRevisionId:p.activeRevisionId,idempotencyKey:'isolation-generation-test'};
  const generated=await call('/api/projects/'+p.id+'/generate',generationInput,alice);assert.equal(generated.status,409);
  assert.equal((await call('/api/projects/'+p.id+'/generate',generationInput,bob)).status,404);
  const chat='/api/projects/'+p.id+'/conversation';
  const prepared=await(await call(chat,{text:generationInput.prompt,intent:'picture',start:1,end:2,baseRevisionId:p.activeRevisionId,idempotencyKey:'reviewed-isolation-generation'},alice)).json();
  const plan=prepared.plans.find(item=>item.id===prepared.requestedPlanId);assert.ok(plan);
  const execute=chat+'/plans/'+plan.id+'/execute';
  assert.equal((await call(execute,{baseRevisionId:p.activeRevisionId},bob)).status,404);
  const accepted=await call(execute,{baseRevisionId:p.activeRevisionId},alice);assert.equal(accepted.status,400);assert.match((await accepted.json()).error,/credentials are not configured/);
  assert.equal(finished.generation,undefined);assert.equal(finished.providerState,undefined);assert.equal(finished.workRequest,undefined);
  assert.equal((await call('/api/jobs/'+job.id+'/recover',{},bob)).status,404);
  const jobs=await(await call('/api/projects/'+p.id+'/jobs',undefined,alice)).json();assert.equal(jobs.length,1,'Rejected generation never enters the queue');
  assert.equal((await call('/api/projects/'+p.id+'/trash',{},bob)).status,404);assert.equal((await call('/api/projects/'+p.id+'/trash',{},alice)).status,200);assert.equal((await(await call('/api/projects',undefined,alice)).json()).length,0);assert.equal((await(await call('/api/trash',undefined,alice)).json()).length,1);assert.equal((await call('/api/projects/'+p.id+'/restore',{},alice)).status,200);
  assert.equal((await call('/api/auth/logout',{},alice)).status,200);assert.equal((await call(p.sourceUrl,undefined,alice)).status,401);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:300});}
});
