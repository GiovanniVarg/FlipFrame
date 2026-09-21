import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerMarkerRoutes} from './markers.mjs';

async function serve(db){
 const projects={a:{id:'a',ownerId:'alice',duration:8,fps:24,activeRevisionId:'ra',sourcePath:'C:/secret/alice.mp4'},b:{id:'b',ownerId:'bob',duration:8,fps:24,activeRevisionId:'rb'}};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:req.headers['x-test-owner']};next();});
 registerMarkerRoutes(app,{db,save:()=>{},getProject:(projectId,owner)=>{const p=projects[projectId];if(!p||p.ownerId!==owner)throw Object.assign(new Error('Project not found'),{status:404});return p;},id:()=> 'http-marker',now:()=> '2026-09-19T12:00:00.000Z'});
 app.use((error,_req,res,_next)=>res.status(error.status||400).json({error:error.message}));
 const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
 return {base:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
async function call(base,path,owner,body){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'x-test-owner':owner,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}

test('HTTP marker routes isolate owners and retain safe data after a service reload',async()=>{
 const db={};let host=await serve(db);
 try{
  const input={label:'Opening beat',note:'Hold on the smile',start:1,end:2,baseRevisionId:'ra',idempotencyKey:'http-marker-key'};
  const created=await call(host.base,'/api/projects/a/markers','alice',input);assert.equal(created.status,201);assert.equal((await created.json()).id,'http-marker');
  assert.equal((await call(host.base,'/api/projects/a/markers','bob')).status,404);
  assert.equal((await call(host.base,'/api/projects/a/markers/http-marker/update','bob',{archived:true})).status,404);
  const archived=await call(host.base,'/api/projects/a/markers/http-marker/update','alice',{archived:true});assert.equal(archived.status,200);assert.equal((await archived.json()).archived,true);
 }finally{await host.close();}
 host=await serve(db);
 try{
  const response=await call(host.base,'/api/projects/a/markers','alice');assert.equal(response.status,200);const markers=await response.json();
  assert.equal(markers.length,1);assert.equal(markers[0].archived,true);assert.equal(markers[0].baseRevisionId,'ra');assert.doesNotMatch(JSON.stringify(markers),/sourcePath|secret|ownerId/i);
 }finally{await host.close();}
});
