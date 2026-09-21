import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createProjectDraftService,registerProjectDraftRoutes} from './project-drafts.mjs';

function fixture(db={assets:{audio:{projectId:'p'},foreign:{projectId:'other'}},candidates:{candidate:{projectId:'p'}}}){
 const project={id:'p',ownerId:'alice',duration:8,activeRevisionId:'r1'};let saves=0;
 const dependencies={db,save:()=>saves++,getProject:(id,owner)=>{if(id!=='p'||owner!=='alice')throw Object.assign(new Error('Project not found'),{status:404});return project;},now:()=> '2026-09-19T12:00:00.000Z'};
 return {db,project,dependencies,service:createProjectDraftService(dependencies),saves:()=>saves};
}
const input=(patch={})=>({baseRevisionId:'r1',expectedVersion:0,...patch});
const polygon=[[.1,.1],[.5,.1],[.5,.5]];

test('empty owner draft has current revision, version zero, and no mutation',()=>{
 const f=fixture();assert.deepEqual(f.service.read('p','alice'),{baseRevisionId:'r1',currentRevisionId:'r1',version:0,editor:{},conversation:{},updatedAt:null,stale:false});assert.equal(f.saves(),0);
 assert.throws(()=>f.service.read('p','bob'),{status:404});assert.throws(()=>f.service.write('p','bob',input({conversation:{text:'private'}})),{status:404});
});

test('sections merge atomically, preserve whitespace, and returned data cannot mutate persisted drafts',()=>{
 const f=fixture();const first=f.service.write('p','alice',input({editor:{start:1,end:3,time:2,prompt:' sunset ',points:polygon,masks:[{time:1,points:polygon,confidence:.9}],audioId:'audio',candidateId:'candidate'},conversation:{text:' unfinished thought ',quality:'draft'}}));
 first.editor.points[0][0]=1;assert.equal(f.service.read('p','alice').editor.points[0][0],.1);
 const next=f.service.write('p','alice',input({expectedVersion:1,editor:{time:2.5},conversation:{quality:'standard'}}));
 assert.equal(next.version,2);assert.equal(next.editor.start,1);assert.equal(next.editor.time,2.5);assert.equal(next.conversation.text,' unfinished thought ');assert.equal(next.conversation.quality,'standard');assert.equal(f.saves(),2);
});

test('stale writes and concurrent version conflicts cannot overwrite a saved draft',()=>{
 const f=fixture();f.service.write('p','alice',input({conversation:{text:'first'}}));
 assert.throws(()=>f.service.write('p','alice',input({conversation:{text:'lost update'}})),{status:409});
 assert.throws(()=>f.service.write('p','alice',input({baseRevisionId:'old',expectedVersion:1,conversation:{text:'wrong revision'}})),{status:409});
 assert.equal(f.service.read('p','alice').conversation.text,'first');assert.equal(f.saves(),1);
});

test('old revision remains inspectable but first current-revision write clears unsubmitted sections',()=>{
 const f=fixture();f.service.write('p','alice',input({editor:{points:polygon,start:1,end:2},conversation:{text:'old text'}}));f.project.activeRevisionId='r2';
 const stale=f.service.read('p','alice');assert.equal(stale.stale,true);assert.equal(stale.baseRevisionId,'r1');assert.equal(stale.currentRevisionId,'r2');assert.equal(stale.conversation.text,'old text');
 const next=f.service.write('p','alice',{baseRevisionId:'r2',expectedVersion:1,conversation:{text:'explicitly copied text'}});
 assert.equal(next.stale,false);assert.deepEqual(next.editor,{});assert.equal(next.version,2);
});

test('invalid fields, metadata, bounds, references and approvals reject before any save',()=>{
 for(const patch of [
  {reviewed:true},{editor:{reviewed:true}},{editor:{approvedEstimateUsd:1}},{conversation:{role:'assistant'}},
  {editor:{start:NaN}},{editor:{time:9}},{editor:{start:3,end:2}},{editor:{gain:13}},{editor:{mode:'anything'}},
  {editor:{prompt:'x'.repeat(3001)}},{conversation:{text:'x'.repeat(3001)}},{conversation:{quality:'ultra'}},
  {editor:{points:[[2,0]]}},{editor:{points:Array(257).fill([0,0])}},
  {editor:{masks:[{time:1,points:polygon,reviewed:true}]}},{editor:{masks:[{time:1,points:polygon},{time:1,points:polygon}]}},
  {editor:{masks:[{time:1,points:[[NaN,.1],[.5,.1],[.5,.5]]}]}},
  {editor:{masks:[{time:1,points:Array(501).fill([.1,.1])}]}},
  {editor:{masks:Array(1801).fill({time:1,points:polygon})}},
  {editor:{visibleRanges:[{start:1,end:3},{start:2,end:4}]}},{editor:{gaps:[{start:1,end:2,secret:'no'}]}},
  {editor:{audioId:'foreign'}},{editor:{candidateId:'audio'}},{editor:{visualId:'missing'}},
  {editor:null},{conversation:[]},{expectedVersion:-1},{expectedVersion:1.5}
 ]){const f=fixture();assert.throws(()=>f.service.write('p','alice',input(patch)));assert.equal(f.saves(),0);assert.equal(f.db.projectDrafts,undefined);}
 const f=fixture();assert.throws(()=>f.service.write('p','alice',JSON.parse('{"baseRevisionId":"r1","expectedVersion":0,"editor":{"__proto__":{}}}')));assert.equal(f.saves(),0);
});

test('combined stored draft is limited to four MiB and failed persistence rolls back',()=>{
 const f=fixture();const gaps=Array.from({length:1800},(_,i)=>({start:i/300,end:(i+.5)/300,reason:'x'.repeat(3000)}));
 assert.throws(()=>f.service.write('p','alice',input({editor:{gaps}})),{status:413});assert.equal(f.saves(),0);
 f.service.write('p','alice',input({conversation:{text:'saved'}}));
 const broken=createProjectDraftService({...f.dependencies,save:()=>{throw new Error('disk full');}});
 assert.throws(()=>broken.write('p','alice',input({expectedVersion:1,conversation:{text:'not saved'}})),/disk full/);
 assert.equal(f.service.read('p','alice').conversation.text,'saved');assert.equal(f.service.read('p','alice').version,1);
});

test('draft survives JSON persistence without approval metadata',()=>{
 const f=fixture();f.service.write('p','alice',input({editor:{start:0,end:8,scope:'range',masks:[{time:1,points:polygon}],gaps:[{start:2,end:3,reason:'occluded'}],visibleRanges:[{start:1,end:2}],audioId:'',visualId:'',candidateId:'candidate'},conversation:{text:'Continue this',quality:'draft'}}));
 const restored=fixture(JSON.parse(JSON.stringify(f.db)));assert.deepEqual(restored.service.read('p','alice'),f.service.read('p','alice'));assert.equal(restored.service.read('p','alice').editor.reviewed,undefined);
});

test('HTTP routes protect ownership, validate drafts, and serialize optimistic concurrent saves',async t=>{
 const f=fixture(),app=express();app.use(express.json({limit:'8mb'}));app.use((req,res,next)=>{req.user={id:req.headers['x-owner']||'alice'};next();});registerProjectDraftRoutes(app,f.dependencies);
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/api/projects/p/draft`;
 const post=body=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await fetch(url,{headers:{'x-owner':'bob'}})).status,404);
 const responses=await Promise.all([post(input({conversation:{text:'one'}})),post(input({conversation:{text:'two'}}))]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 assert.equal((await post(input({expectedVersion:1,editor:{reviewed:true}}))).status,400);
 assert.equal((await post(input({expectedVersion:1,baseRevisionId:'stale',editor:{time:1}}))).status,409);
 const result=await (await fetch(url)).json();assert.equal(result.version,1);assert.ok(['one','two'].includes(result.conversation.text));assert.equal(result.stale,false);
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-owner':'bob'},body:JSON.stringify(input({expectedVersion:1,conversation:{text:'leak'}}))})).status,404);
});


test('a partial update cannot grow the merged saved draft beyond four MiB',()=>{
 const f=fixture();const gaps=Array.from({length:1000},(_,i)=>({start:i/200,end:(i+.5)/200,reason:'x'.repeat(3000)}));
 f.service.write('p','alice',input({editor:{gaps}}));
 const points=Array(500).fill([.1234567890123456,.8765432109876543]);
 const masks=Array.from({length:70},(_,i)=>({time:i/10,points}));
 const update=input({expectedVersion:1,editor:{masks}});assert.ok(Buffer.byteLength(JSON.stringify(update))<4*1024*1024);
 assert.throws(()=>f.service.write('p','alice',update),{status:413});assert.equal(f.saves(),1);assert.equal(f.service.read('p','alice').editor.masks,undefined);
});


test('unfinished keyframes with differing vertex counts survive save and reload',()=>{
 const f=fixture();const masks=[{time:1,points:polygon},{time:2,points:[...polygon,[.2,.3]]}];
 f.service.write('p','alice',input({editor:{masks},conversation:{text:'Refine the second boundary'}}));
 const restored=fixture(JSON.parse(JSON.stringify(f.db)));
 assert.deepEqual(restored.service.read('p','alice').editor.masks,masks);
 assert.equal(restored.service.read('p','alice').conversation.text,'Refine the second boundary');
 assert.equal(restored.service.read('p','alice').editor.reviewed,undefined);
});

test('detailed SAM boundary remains editable and saveable as an authored polygon',()=>{
 const f=fixture();const points=Array.from({length:256},(_,i)=>[.5+.3*Math.cos(i*Math.PI/128),.5+.3*Math.sin(i*Math.PI/128)]);
 const saved=f.service.write('p','alice',input({editor:{points,masks:[{time:1,points}]}}));
 assert.equal(saved.editor.points.length,256);assert.deepEqual(saved.editor.masks[0].points,points);
});

test('reference draft persists, clears, and refuses foreign images',()=>{
 const f=fixture();f.db.assets.ref={id:'ref',projectId:'p',kind:'reference-image',url:'/media/ref.png'};
 const saved=f.service.write('p','alice',input({conversation:{referenceImageId:'ref'}}));assert.equal(saved.conversation.referenceImageId,'ref');
 assert.throws(()=>f.service.write('p','alice',input({expectedVersion:1,conversation:{referenceImageId:'foreign'}})),/project/);
 const cleared=f.service.write('p','alice',input({expectedVersion:1,conversation:{referenceImageId:''}}));assert.equal(cleared.conversation.referenceImageId,'');
});

test('correction drafts retain scoped protection and reject foreign candidates',()=>{
 const f=fixture();const result=f.service.write('p','alice',input({editor:{repairCandidateId:'candidate',protectedAreas:[polygon]}}));
 assert.equal(result.editor.repairCandidateId,'candidate');assert.deepEqual(result.editor.protectedAreas,[polygon]);
 assert.throws(()=>fixture().service.write('p','alice',input({editor:{repairCandidateId:'foreign'}})));
 assert.throws(()=>fixture().service.write('p','alice',input({editor:{protectedAreas:[[[2,0],[1,0],[1,1]]]}})));
});

test('named object selections survive reload independently and reject nested or duplicate entries',()=>{const f=fixture();const a={name:'Car',start:1,end:3,scope:'range',masks:[{time:1,points:polygon},{time:2,points:polygon}],visibleRanges:[],gaps:[]};const b={...a,name:'Plant'};const saved=f.service.write('p','alice',input({editor:{objectName:'Car',objectSelections:[a,b]}}));assert.deepEqual(saved.editor.objectSelections,[a,b]);saved.editor.objectSelections[0].masks[0].points[0][0]=.9;assert.equal(f.service.read('p','alice').editor.objectSelections[0].masks[0].points[0][0],.1);assert.throws(()=>f.service.write('p','alice',{...input({editor:{objectSelections:[a,a]}}),expectedVersion:1}),/unique/);assert.throws(()=>f.service.write('p','alice',{...input({editor:{objectSelections:[{...a,objectSelections:[]}]}}),expectedVersion:1}),/unsupported/);});
