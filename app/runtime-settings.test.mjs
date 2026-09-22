import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {createSettingsStore,loadRuntimeSettings,registerRuntimeSettings,validateSettings,publicSettings,settingsReadiness} from './runtime-settings.mjs';
function fixture(t){const ROOT=fs.mkdtempSync(path.join(os.tmpdir(),'settings-test-'));t.after(()=>fs.rmSync(ROOT,{recursive:true,force:true}));return ROOT;}
test('settings preserve originals and blank keys; sanitized output; reload persists overrides',t=>{
 const ROOT=fixture(t),original='UNKNOWN=preserve\nHF_CREDENTIALS=fake-original\n';fs.writeFileSync(path.join(ROOT,'.env.local'),original);
 const env={HF_CREDENTIALS:'fake-original',TYPESAFE_API_KEY:'fake-existing'};const store=createSettingsStore({ROOT,env});
 const response=store.save({HF_CREDENTIALS:'',LLM_API_KEY:'fake-new',SAM2_DEVICE:'cuda',REASONING_PROVIDER:'anthropic'});
 assert.equal(env.HF_CREDENTIALS,'fake-original');assert.equal(fs.readFileSync(path.join(ROOT,'.env.local'),'utf8'),original);
 assert.equal(JSON.stringify(response).includes('fake-'),false);assert.equal(response.configured.LLM_API_KEY,true);
 const reloaded={};loadRuntimeSettings(ROOT,reloaded);assert.equal(reloaded.LLM_API_KEY,'fake-new');assert.equal(reloaded.SAM2_DEVICE,'cuda');
 assert.equal(fs.existsSync(path.join(ROOT,'.local-settings','HF_CREDENTIALS')),false);
});
test('validation rejects unknown settings, malformed secrets, unsafe URLs before saving',()=>{
 for(const input of [{LAB_MODE:'local'},{SAM2_DEVICE:'mps'},{LLM_API_KEY:'bad\nvalue'},{LLM_BASE_URL:'http://example.com'},{LLM_BASE_URL:'https://user:pass@example.com'},{LLM_BASE_URL:'https://example.com?key=foo'},{LLM_BASE_URL:'file:///etc/passwd'},[]])assert.throws(()=>validateSettings(input));
 assert.equal(validateSettings({LLM_BASE_URL:'http://localhost:11434/v1'}).LLM_BASE_URL,'http://localhost:11434/v1');
});
async function server(t,MODE='local'){
 const app=express();app.use(express.json());registerRuntimeSettings(app,{ROOT:fixture(t),MODE,env:{},asyncRoute:fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next)});
 const http=app.listen(0,'127.0.0.1');await new Promise(resolve=>http.once('listening',resolve));t.after(()=>new Promise(resolve=>{http.closeAllConnections();http.close(resolve);}));return `http://127.0.0.1:${http.address().port}`;
}
test('settings routes are local-only, JSON-only and same-origin',async t=>{
 for(const mode of ['saas','authenticated-local']){const url=await server(t,mode);assert.equal((await fetch(url+'/api/settings')).status,403);assert.equal((await fetch(url+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);}
 const url=await server(t);assert.equal((await fetch(url+'/api/settings',{method:'POST',body:'x'})).status,415);
 assert.equal((await fetch(url+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'})).status,403);
 const saved=await fetch(url+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:JSON.stringify({LLM_API_KEY:'fake-secret'})});assert.equal(saved.status,200);assert.equal((await saved.text()).includes('fake-secret'),false);
 const hardware=await (await fetch(url+'/api/settings/hardware')).json();assert.deepEqual(hardware.devices,['cpu']);
});

test('readiness distinguishes empty example malformed and usable credentials',()=>{
 assert.deepEqual(settingsReadiness({}),{assistant:false,video:false});
 for(const secret of ['', '   ','your-api-key','replace-me','<your-key>']){
  assert.equal(settingsReadiness({TYPESAFE_API_KEY:secret}).assistant,false);
 }
 for(const credentials of ['missingcolon','id:','id:secret:extra','your-key-id:your-key-secret','key-id:key-secret']){
  assert.equal(settingsReadiness({HF_CREDENTIALS:credentials}).video,false);
  assert.throws(()=>validateSettings({HF_CREDENTIALS:credentials}));
 }
 assert.deepEqual(settingsReadiness({TYPESAFE_API_KEY:'test-active-token',HF_CREDENTIALS:'test-id:test-secret'}),{assistant:true,video:true});
 const legacy=publicSettings({HIGGSFIELD_API_KEY:'test-id',HIGGSFIELD_API_SECRET:'test-secret'});
 assert.equal(legacy.readiness.video,true);assert.equal(legacy.configured.HF_CREDENTIALS,true);
 assert.equal(JSON.stringify(legacy).includes('test-secret'),false);
});
test('generic readiness requires model and openai-compatible endpoint',()=>{
 const env={REASONING_PROVIDER:'openai-compatible',LLM_API_KEY:'test-active-token',LLM_MODEL:'model-one'};
 assert.equal(settingsReadiness(env).assistant,false);
 assert.equal(settingsReadiness({...env,LLM_BASE_URL:'http://localhost:11434/v1'}).assistant,true);
 assert.equal(settingsReadiness({...env,LLM_BASE_URL:'https://user:pass@example.com'}).assistant,false);
 assert.equal(settingsReadiness({...env,REASONING_PROVIDER:'anthropic'}).assistant,true);
 assert.equal(settingsReadiness({...env,REASONING_PROVIDER:'gemini',LLM_MODEL:'your-model'}).assistant,false);
});
test('saved overrides determine readiness without replacing existing env files',t=>{
 const ROOT=fixture(t),env={TYPESAFE_API_KEY:'test-active-token'};
 const store=createSettingsStore({ROOT,env});assert.equal(store.snapshot().readiness.assistant,true);
 const saved=store.save({REASONING_PROVIDER:'gemini',LLM_MODEL:'model-one',LLM_API_KEY:'test-other-token'});
 assert.equal(saved.readiness.assistant,true);
 const reloaded={TYPESAFE_API_KEY:'test-active-token'};loadRuntimeSettings(ROOT,reloaded);
 assert.equal(settingsReadiness(reloaded).assistant,true);
 assert.equal(JSON.stringify(saved).includes('test-other-token'),false);
});

test('old placeholder override loads as not-ready instead of blocking startup',t=>{
 const ROOT=fixture(t);fs.mkdirSync(path.join(ROOT,'.local-settings'));
 fs.writeFileSync(path.join(ROOT,'.local-settings','HF_CREDENTIALS'),'your-key-id:your-key-secret');
 const env={};loadRuntimeSettings(ROOT,env);assert.equal(settingsReadiness(env).video,false);
});
