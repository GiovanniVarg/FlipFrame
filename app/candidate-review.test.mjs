import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createCandidateReviewService,registerCandidateReviewRoutes} from './candidate-review.mjs';
import {publicJob} from './jobs.mjs';

function fixture(){
 const db={projects:{p:{id:'p',ownerId:'alice',activeRevisionId:'r',revisions:[{id:'r'}]},q:{id:'q',ownerId:'alice'}},candidates:{c:{id:'c',projectId:'p',path:'private/media.mp4'}},jobs:{j:{id:'j',projectId:'p',status:'completed',result:{id:'c',url:'/media/c.mp4'}}}};
 let persisted;
 const deps={db,save:()=>{persisted=JSON.stringify(db);},getProject:(id,owner)=>{const p=db.projects[id];if(!p||p.ownerId!==owner)throw Object.assign(new Error('Project not found'),{status:404});return p;},now:()=> '2026-09-19T12:00:00.000Z'};
 return {db,deps,snapshot:()=>JSON.parse(persisted)};
}
test('dismissal persists, same-state retry retains its timestamp, restore clears both records without changing revisions',()=>{
 const {db,deps,snapshot}=fixture(),review=createCandidateReviewService(deps),before=JSON.stringify(db.projects);
 const first=review('p','alice','c',{dismissed:true});
 assert.equal(first.dismissedAt,'2026-09-19T12:00:00.000Z');
 assert.deepEqual(review('p','alice','c',{dismissed:true}),first);
 assert.equal(snapshot().candidates.c.dismissedAt,first.dismissedAt);
 assert.equal(publicJob(snapshot().jobs.j).result.dismissedAt,first.dismissedAt);
 assert.deepEqual(Object.keys(first).sort(),['dismissedAt','id','projectId']);
 review('p','alice','c',{dismissed:false});
 assert.equal(snapshot().candidates.c.dismissedAt,null);
 assert.equal(publicJob(snapshot().jobs.j).result.dismissedAt,null);
 assert.equal(JSON.stringify(db.projects),before);
});
test('review rejects foreign owners, wrong projects, missing candidates and nonboolean input without saving',()=>{
 const {deps}=fixture();deps.save=()=>assert.fail('Invalid request saved');const review=createCandidateReviewService(deps);
 assert.throws(()=>review('p','bob','c',{dismissed:true}),/Project not found/);
 assert.throws(()=>review('q','alice','c',{dismissed:true}),/Candidate not found/);
 assert.throws(()=>review('p','alice','missing',{dismissed:true}),/Candidate not found/);
 for(const value of [null,{},[],{dismissed:'true'},{dismissed:1}])assert.throws(()=>review('p','alice','c',value),/boolean/);
});
test('HTTP dismissal and restore expose durable status through public jobs after service reload',async()=>{
 const {deps,snapshot}=fixture();
 async function serve(options){const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:req.headers['x-test-owner']};next();});registerCandidateReviewRoutes(app,options);app.get('/jobs',(_req,res)=>res.json(Object.values(options.db.jobs).map(publicJob)));app.use((error,_req,res,_next)=>res.status(error.status||400).json({error:error.message}));const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});return {base:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};}
 let host=await serve(deps);
 const post=(owner,body,path='/api/projects/p/candidates/c/review')=>fetch(host.base+path,{method:'POST',headers:{'x-test-owner':owner,'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await post('bob',{dismissed:true})).status,404);
  assert.equal((await post('alice',{dismissed:true},'/api/projects/q/candidates/c/review')).status,404);
  assert.equal((await post('alice',{dismissed:'true'})).status,400);
  const response=await post('alice',{dismissed:true});assert.equal(response.status,200);assert.doesNotMatch(JSON.stringify(await response.json()),/private|path/);
 }finally{await host.close();}
 const restored=snapshot();host=await serve({...deps,db:restored,save:()=>{}});
 try{
  let jobs=await (await fetch(host.base+'/jobs')).json();assert.equal(jobs[0].result.dismissedAt,'2026-09-19T12:00:00.000Z');
  assert.equal((await post('alice',{dismissed:false})).status,200);
  jobs=await (await fetch(host.base+'/jobs')).json();assert.equal(jobs[0].result.dismissedAt,null);
 }finally{await host.close();}
});
