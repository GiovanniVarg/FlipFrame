import test from 'node:test';import assert from 'node:assert/strict';
import {createCandidateLibrary} from './candidate-library.mjs';
function fixture(){const db={candidates:{a:{id:'a',projectId:'p',baseRevisionId:'r',url:'/media/a.webm',path:'secret',createdAt:'2026-09-20'},b:{id:'b',projectId:'p',baseRevisionId:'old',url:'/media/b.webm',dismissedAt:'date'},foreign:{id:'foreign',projectId:'q',url:'/media/foreign'}},jobs:{},projects:{p:{id:'p',activeRevisionId:'r',revisions:[]}}};const lib=createCandidateLibrary({db,save(){},getProject:(id,owner)=>{if(id!=='p'||owner!=='owner')throw Error('Not found');return db.projects.p;}});return {db,lib};}
test('library is owner isolated and reports old revisions without exposing paths',()=>{const {lib}=fixture();const list=lib.list('p','owner');assert.equal(list.length,2);assert.equal(list.find(c=>c.id==='a').canApply,true);assert.equal(list.find(c=>c.id==='b').canApply,false);assert.equal(JSON.stringify(list).includes('secret'),false);assert.throws(()=>lib.list('p','other'));});
test('favorites and names persist without changing revision or generation state',()=>{const {db,lib}=fixture();lib.update('p','owner','a',{name:'Blue mug',favorite:true});assert.equal(lib.list('p','owner')[0].name,'Blue mug');assert.equal(db.candidates.a.favorite,true);assert.equal(db.projects.p.activeRevisionId,'r');assert.deepEqual(db.jobs,{});assert.throws(()=>lib.update('p','owner','foreign',{favorite:true}));assert.throws(()=>lib.update('p','owner','a',{favorite:'yes'}));assert.throws(()=>lib.update('p','owner','a',{name:'x'.repeat(81)}));});

test('failed persistence rolls back candidate and job metadata',()=>{
 const db={candidates:{a:{id:'a',projectId:'p',name:'Original'}},jobs:{j:{projectId:'p',result:{id:'a',name:'Original'}}}};
 const lib=createCandidateLibrary({db,getProject:()=>({id:'p'}),save(){throw Error('disk full')}});
 assert.throws(()=>lib.update('p','owner','a',{name:'Changed',favorite:true}),/disk full/);
 assert.equal(db.candidates.a.name,'Original');assert.equal(db.jobs.j.result.name,'Original');assert.equal(db.candidates.a.favorite,undefined);
});
test('HTTP library gates owners and persists metadata across service restart',async()=>{
 const {default:express}=await import('express');const {registerCandidateLibraryRoutes}=await import('./candidate-library.mjs');
 const {db}=fixture();let persisted;
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.headers['x-owner']};next()});
 registerCandidateLibraryRoutes(app,{db,save(){persisted=JSON.stringify(db)},getProject:(id,owner)=>{if(id!=='p'||owner!=='owner')throw Object.assign(Error('Not found'),{status:404});return db.projects.p;}});
 app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/api/projects/p/candidates',{headers:{'x-owner':'other'}})).status,404);
  const update=await fetch(base+'/api/projects/p/candidates/a/details',{method:'POST',headers:{'x-owner':'owner','content-type':'application/json'},body:JSON.stringify({favorite:true,name:'Favorite take'})});assert.equal(update.status,200);assert.equal((await update.json()).name,'Favorite take');
  const restored=JSON.parse(persisted);const lib=createCandidateLibrary({db:restored,save(){},getProject:()=>restored.projects.p});assert.equal(lib.list('p','owner')[0].favorite,true);assert.equal(lib.list('p','owner')[0].name,'Favorite take');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('an undone candidate remains comparable without applying the revision twice',()=>{const {db,lib}=fixture();db.projects.p.revisions.push({id:'a'});const a=lib.list('p','owner').find(c=>c.id==='a');assert.equal(a.canApply,false);assert.equal(a.canCompare,true);assert.equal(lib.list('p','owner').find(c=>c.id==='b').canCompare,false);});
