import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function availablePort(){const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));return port;}

test('restart resumes durable local render and quarantines provider work without resubmission',{timeout:90000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'video-lab-queue-test-'));
 const media=path.join(directory,'media');fs.mkdirSync(media);
 const source=path.join(media,'source.mp4'),output=path.join(media,'candidate.mp4');
 fs.copyFileSync(path.join(root,'test-source.mp4'),source);
 const createdAt=new Date().toISOString();
 const project={id:'queue-project',ownerId:'local-owner',name:'Queue recovery fixture',duration:6,width:640,height:360,fps:30,sourcePath:source,sourceUrl:'/media/source.mp4',activeRevisionId:'original',revisions:[{id:'original',path:source,url:'/media/source.mp4',label:'Original',createdAt}]};
 const providerState={requestId:'do-not-resubmit-paid-request',status:'running'};
 const state={projects:{[project.id]:project},assets:{},candidates:{},spend:{spent:0,reserved:1.25},jobs:{
  local:{id:'local',projectId:project.id,status:'running',createdAt,workRequest:{kind:'render',candidateId:'candidate',baseRevisionId:'original',request:{action:'render',source,output,start:1,end:3,operation:'mute'}}},
  provider:{id:'provider',projectId:project.id,status:'running',createdAt,provider:'higgsfield',providerState}
 }};
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(state));
 const networkLog=path.join(directory,'network-attempts.jsonl');
 const preload=path.join(directory,'deny-network.mjs');
 fs.writeFileSync(preload,`import fs from 'node:fs';globalThis.fetch=async function(input){fs.appendFileSync(${JSON.stringify(networkLog)},JSON.stringify({url:String(input)})+'\\n');throw new Error('Queue recovery test forbids outbound network');};`);
 let child,logs='';
 async function launch(){
  const port=await availablePort();const base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['--import',pathToFileURL(preload).href,path.join(root,'server.mjs')],{cwd:root,windowsHide:true,env:{...process.env,LAB_DATA_DIR:directory,LAB_MODE:'local',PORT:String(port),HF_CREDENTIALS:'',HIGGSFIELD_API_KEY:'',HIGGSFIELD_API_SECRET:'',HIGGSFIELD_TEST_BUDGET_USD:'0'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{logs=(logs+chunk).slice(-12000);});child.stderr.on('data',chunk=>{logs=(logs+chunk).slice(-12000);});
  child.on('error',error=>{logs+=error.message;});
  for(let i=0;i<100;i++){
   assert.equal(child.exitCode,null,'Server exited before readiness: '+logs);
   try{const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)});if(response.ok)return base;}catch{}
   await pause(100);
  }
  throw new Error('Server readiness timeout: '+logs);
 }
 async function stop(){
  if(!child||child.exitCode!==null)return;
  const target=child;const closed=new Promise(resolve=>target.once('close',resolve));
  target.kill('SIGTERM');
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(target.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  await Promise.race([closed,pause(3000)]);child=undefined;
 }
 async function job(base,name){const response=await fetch(base+'/api/jobs/'+name,{signal:AbortSignal.timeout(2000)});assert.equal(response.status,200);return response.json();}
 try{
  let base=await launch();
  const quarantined=await job(base,'provider');assert.equal(quarantined.status,'unknown');assert.match(quarantined.error,/restarted/);
  let recovered;
  for(let i=0;i<180;i++){
   recovered=await job(base,'local');
   if(recovered.status==='completed')break;
   assert.notEqual(recovered.status,'failed',recovered.error);await pause(200);
  }
  assert.equal(recovered.status,'completed','Local render failed to resume: '+logs);
  assert.equal(recovered.result.id,'candidate');assert.equal(recovered.result.baseRevisionId,'original');
  assert.ok(fs.statSync(output).size>1000);
  const result=await fetch(base+recovered.result.url);assert.equal(result.status,200);assert.match(result.headers.get('content-type'),/video/);
  const original=await (await fetch(base+'/api/projects/'+project.id)).json();assert.equal(original.activeRevisionId,'original');assert.equal(original.revisions.length,1);
  assert.ok(!fs.existsSync(networkLog),'Recovery attempted outbound provider traffic');
  const outputModified=fs.statSync(output).mtimeMs;
  await stop();
  // A second boot reads SQLite, proving recovery was durably saved rather than only in memory.
  base=await launch();
  assert.equal((await job(base,'local')).status,'completed');assert.equal((await job(base,'provider')).status,'unknown');
  await pause(300);assert.equal(fs.statSync(output).mtimeMs,outputModified,'Completed render was erroneously rerun');
  assert.ok(!fs.existsSync(networkLog),'Second boot attempted outbound provider traffic');
  const capabilities=await (await fetch(base+'/api/capabilities')).json();assert.equal(capabilities.budget.reserved,1.25);assert.equal(capabilities.budget.spent,0);
 }catch(error){console.error(logs);throw error;}finally{
  await stop();
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));
  fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
