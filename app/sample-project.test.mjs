import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {createProjectImporter,createSampleProjectService,registerSampleProjectRoutes} from './sample-project.mjs';
import {canReadMedia} from './access.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sample-project-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const db={projects:{},assets:{},candidates:{},jobs:{},spend:{spent:0,reserved:0}},calls=[];let busy=false,saves=0;
 const fixturePath=path.join(root,'sample-source.mp4'),mediaPath=(key,ext='mp4')=>path.join(dir,key+'.'+ext);
 const dependencies={db,save:()=>saves++,mediaPath,mediaUrl:p=>'/media/'+path.basename(p),storageAvailable:()=>{},acquireMedia(){if(busy)throw Object.assign(new Error('Busy'),{status:409});busy=true;},releaseMedia(){busy=false;},
 async runMedia(request){calls.push(request.action);if(request.action==='probe')return {duration:8,width:640,height:360};if(request.action==='normalize'){fs.copyFileSync(request.source,request.output);return {duration:8,width:640,height:360};}if(request.action==='analyze'){fs.writeFileSync(request.output,'thumbnail');return {peaks:[.1,.2]};}throw new Error('Unexpected media operation');}};
 const importProject=createProjectImporter(dependencies),sampleDependencies={db,importProject,fixturePath,uploadDirectory:dir};
 return {dir,db,calls,dependencies,sampleDependencies,fixturePath,create:createSampleProjectService(sampleDependencies),saves:()=>saves};
}

test('sample copies are independently owned, preserve fixture, and make no generation jobs or spending',async t=>{
 const f=fixture(t),before=digest(f.fixturePath);const alice=await f.create('alice'),bob=await f.create('bob');
 assert.notEqual(alice.id,bob.id);assert.notEqual(alice.sourcePath,bob.sourcePath);assert.notEqual(alice.sourceUrl,bob.sourceUrl);
 assert.equal(alice.ownerId,'alice');assert.equal(bob.ownerId,'bob');assert.equal(digest(alice.sourcePath),before);assert.equal(digest(f.fixturePath),before);
 assert.match(alice.sample.description,/Not a Higgsfield generation/);assert.equal(alice.sample.kind,'synthetic-practice');
 assert.equal(canReadMedia(f.db,path.basename(alice.sourcePath),'bob'),false);assert.equal(canReadMedia(f.db,path.basename(alice.sourcePath),'alice'),true);
 assert.deepEqual(f.calls,['probe','normalize','analyze','probe','normalize','analyze']);assert.deepEqual(f.db.jobs,{});assert.deepEqual(f.db.spend,{spent:0,reserved:0});
});

test('concurrent clicks and restarted retries return one project, distinct explicit keys create independent copies',async t=>{
 const f=fixture(t);const [a,b]=await Promise.all([f.create('alice',{idempotencyKey:'request-001'}),f.create('alice',{idempotencyKey:'request-001'})]);assert.equal(a.id,b.id);assert.equal(f.saves(),1);
 const restart=createSampleProjectService(f.sampleDependencies);assert.equal((await restart('alice',{idempotencyKey:'request-001'})).id,a.id);assert.equal(f.saves(),1);
 const second=await restart('alice',{idempotencyKey:'request-002'});assert.notEqual(second.id,a.id);assert.notEqual(second.revisions[0].path,a.revisions[0].path);
});

test('invalid input, project capacity and media failures do not leave partial projects or upload copies',async t=>{
 const f=fixture(t);await assert.rejects(f.create('',{}),{status:401});await assert.rejects(f.create('alice',{provider:'anything'}));await assert.rejects(f.create('alice',{idempotencyKey:'bad'}));
 for(let i=0;i<20;i++)f.db.projects[i]={ownerId:'full'};
 const before=fs.readdirSync(f.dir);await assert.rejects(f.create('full'),{status:429});assert.deepEqual(fs.readdirSync(f.dir),before);
 const broken=createSampleProjectService({...f.sampleDependencies,importProject:createProjectImporter({...f.dependencies,runMedia:async()=>{throw new Error('Invalid video');}})});
 await assert.rejects(broken('alice'),/Invalid video/);assert.equal(Object.values(f.db.projects).filter(p=>p.ownerId==='alice').length,0);assert.deepEqual(fs.readdirSync(f.dir),before);
});

test('HTTP example returns an ordinary public project and separates authenticated owners',async t=>{
 const f=fixture(t),app=express();app.use(express.json());app.use((req,res,next)=>{if(!req.headers['x-owner'])return res.status(401).json({error:'Sign in'});req.user={id:req.headers['x-owner']};next();});
 registerSampleProjectRoutes(app,{...f.sampleDependencies,publicProject:p=>({...p,sourcePath:undefined,revisions:p.revisions.map(({path,...r})=>r)})});app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/api/projects/example`,post=owner=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(owner?{'x-owner':owner}:{})},body:'{}'});
 assert.equal((await post()).status,401);const response=await post('alice');assert.equal(response.status,201);const a=await response.json();assert.equal(a.sourcePath,undefined);assert.equal(a.revisions[0].path,undefined);assert.ok(a.sourceUrl.startsWith('/media/'));
 assert.equal((await (await post('alice')).json()).id,a.id);assert.notEqual((await (await post('bob')).json()).id,a.id);
});

test('bundled synthetic fixture passes actual probe, normalization and thumbnail analysis',async t=>{
 const f=fixture(t),hash=digest(f.fixturePath);
 const runMedia=async request=>{const file=path.join(f.dir,randomUUID()+'.json');fs.writeFileSync(file,JSON.stringify(request));try{return JSON.parse(execFileSync('python',[path.join(root,'media_engine.py'),file],{cwd:root,encoding:'utf8',windowsHide:true}));}finally{fs.rmSync(file,{force:true});}};
 const create=createSampleProjectService({...f.sampleDependencies,importProject:createProjectImporter({...f.dependencies,runMedia})});
 const project=await create('alice');assert.ok(Math.abs(project.duration-8)<1/30);assert.equal(project.fps,30);assert.equal(project.width,640);assert.equal(project.height,360);assert.ok(project.waveform.length);assert.ok(project.thumbnailUrl.endsWith('.jpg'));assert.equal(digest(f.fixturePath),hash);
 const output=await runMedia({action:'probe',source:project.revisions[0].path});assert.equal(output.hasAudio,true);assert.equal(output.fps,30);assert.deepEqual(f.db.spend,{spent:0,reserved:0});
});


test('source import accepts industrial footage and keeps the 2 GiB / 60 minute admission boundary',async t=>{
 const f=fixture(t);let duration=127.208333;
 const importer=createProjectImporter({...f.dependencies,runMedia:async request=>{
  if(request.action==='probe')return {duration,width:1920,height:1080};
  const result=await f.dependencies.runMedia(request);return {...result,duration};
 }});
 const upload=size=>{const target=path.join(f.dir,randomUUID()+'.mp4');fs.copyFileSync(f.fixturePath,target);return {path:target,originalname:'Industrial.mp4',size};};
 const project=await importer(upload(387630426),'alice');assert.equal(project.duration,duration);
 duration=3600;assert.equal((await importer(upload(2*1024**3),'alice')).duration,3600);
 await assert.rejects(importer(upload(2*1024**3+1),'alice'),/2 GiB/);
 duration=3600.01;await assert.rejects(importer(upload(500*1024**2),'alice'),/60 minutes/);
 assert.equal(Object.values(f.db.projects).length,2);
});

