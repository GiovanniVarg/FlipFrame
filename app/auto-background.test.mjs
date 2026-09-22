import test from 'node:test';import assert from 'node:assert/strict';
import express from 'express';import {registerAutoBackground} from './auto-background.mjs';
test('auto detection uses owned active source and queues a reviewable cancellable selection',async t=>{
 let ready=true,work;const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:'owner'};next()});
 registerAutoBackground(app,{getProject:(id,owner)=>{assert.equal(id,'p');assert.equal(owner,'owner');return {id,activeRevisionId:'r',duration:4,revisions:[{id:'r',path:'owned-source.mp4'}]}},ready:()=>ready,enqueue:(p,w,res)=>{work=w;res.status(202).json({id:'j'})},asyncRoute:fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next)});
 app.use((error,req,res,next)=>res.status(400).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const send=body=>fetch(`http://127.0.0.1:${server.address().port}/api/projects/p/auto-background`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await send({baseRevisionId:'old',time:0})).status,400);assert.equal(work,undefined);
 assert.equal((await send({baseRevisionId:'r',time:4})).status,400);
 ready=false;assert.equal((await send({baseRevisionId:'r',time:0})).status,503);ready=true;
 assert.equal((await send({baseRevisionId:'r',time:.05,source:'untrusted-path'})).status,202);
 assert.equal(work.kind,'segment');assert.equal(work.request.source,'owned-source.mp4');assert.equal(work.request.time,1/30);assert.equal(work.request.action,'auto_background');
});
