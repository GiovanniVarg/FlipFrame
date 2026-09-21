import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {registerTransformationRoutes} from './transformation.mjs';
test('transformation HTTP review enforces ownership, approval and server-owned file paths',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'transform-http-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const media=path.join(folder,'candidate.mp4');fs.writeFileSync(media,'fixture');
 const p={id:'p',ownerId:'alice',activeRevisionId:'r',duration:1,revisions:[{id:'r',path:'/owned/source.mp4'}]};
 const db={jobs:{},assets:{a:{id:'a',projectId:'p',path:media,name:'Replacement'}}};const queued=[];
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.headers['x-owner']||'alice'};next();});
 registerTransformationRoutes(app,{db,projectById:(id,owner)=>{if(id!=='p'||owner!=='alice')throw Object.assign(Error('Not found'),{status:404});return p;},asyncRoute:fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next),enqueue:(p,q,res)=>{queued.push(q);res.status(202).json({id:'queued',status:'queued'});},mediaPath:id=>path.join(folder,id+'.webm'),id:()=>String(queued.length),candidateCapacity:()=>{}});
 app.use((err,req,res,next)=>res.status(err.status||400).json({error:err.message}));
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}/api/projects/p/transformation`;
 let r=await fetch(base+'/sources');const list=await r.json();assert.equal(list.length,1);assert.equal(list[0].path,undefined);
 r=await fetch(base+'/media?source=asset:a',{headers:{'x-owner':'bob'}});assert.equal(r.status,404);
 const masks=[0,1,2].map(f=>({time:f/30,points:[[.1,.1],[.2,.1],[.2,.2],[.1,.2]]}));
 const body={sourceId:'asset:a',baseRevisionId:'r',start:0,end:.1,masks,replacementMasks:masks,envelope:[[0,0],[.5,0],[.5,.5],[0,.5]],reviewed:false,candidateOffset:0,cameraPolicy:'fixed',source:'/untrusted/source',candidate:'/untrusted/candidate'};
 const post=b=>fetch(base+'/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 assert.equal((await post(body)).status,400);assert.equal(queued.length,0);
 assert.equal((await post({...body,reviewed:true})).status,202);assert.equal(queued[0].request.source,'/owned/source.mp4');assert.equal(queued[0].request.candidate,media);assert.equal(queued[0].request.action,'transformation');
});
