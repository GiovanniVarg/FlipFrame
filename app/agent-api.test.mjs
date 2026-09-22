import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerAgentApi} from './agent-api.mjs';
async function fixture(t,mode='local') {
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'flipframe-agent-test-'));
 const app=express();app.use(express.json());registerAgentApi(app,{dataDir,mode});
 app.get('/api/projects/:id',(req,res)=>res.json({id:req.params.id,query:req.query,rewritten:req.url}));
 app.post('/api/projects/:id/conversation',(req,res)=>res.json({id:req.params.id,body:req.body}));
 app.get('/api/settings',(req,res)=>res.json({mustNotReach:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dataDir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,options={})=>fetch(base+url,options);
 const enable=async()=>{const res=await request('/api/settings/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true})});return res.json();};
 return {request,enable,dataDir};
}
test('agent token is shown only at creation, stored hashed, revocable',async t=>{
 const {request,enable,dataDir}=await fixture(t);
 assert.equal((await request('/api/agent/v1/discovery')).status,401);
 const {token}=await enable();assert.ok(token);
 assert.ok(!fs.readFileSync(path.join(dataDir,'agent-access.json'),'utf8').includes(token));
 const status=await (await request('/api/settings/agent')).json();assert.deepEqual(status,{enabled:true,baseUrl:'/api/agent/v1'});
 const headers={Authorization:`Bearer ${token}`};assert.equal((await request('/api/agent/v1/discovery',{headers})).status,200);
 await request('/api/settings/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false})});
 assert.equal((await request('/api/agent/v1/discovery',{headers})).status,401);
});
test('rotation invalidates old token and allowlist preserves method/query/body',async t=>{
 const {request,enable}=await fixture(t);const old=await enable();const {token}=await enable();
 assert.equal((await request('/api/agent/v1/discovery',{headers:{Authorization:`Bearer ${old.token}`}})).status,401);
 const headers={Authorization:`Bearer ${token}`};
 const result=await (await request('/api/agent/v1/projects/project-1?view=latest',{headers})).json();assert.equal(result.id,'project-1');assert.equal(result.query.view,'latest');assert.equal(result.rewritten,'/api/projects/project-1?view=latest');
 const posted=await(await request('/api/agent/v1/projects/project-1/conversation',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({text:'mute',idempotencyKey:'test-request'})})).json();assert.equal(posted.body.text,'mute');
 for(const url of ['/api/agent/v1/settings','/api/agent/v1/projects/project-1/../../settings','/api/agent/v1/projects/bad%2Fid','/api/agent/v1/projects/project-1/delete'])assert.equal((await request(url,{headers})).status,404);
 assert.equal((await request('/api/agent/v1/projects/project-1',{method:'DELETE',headers})).status,404);
});
for(const mode of ['saas','authenticated-local'])test(mode+' disables token management and agent routes',async t=>{const {request,enable}=await fixture(t,mode);assert.equal((await request('/api/settings/agent')).status,403);assert.equal((await request('/api/agent/v1/discovery')).status,403);assert.equal((await enable()).enabled,undefined);});
