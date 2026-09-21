import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarkerService} from './markers.mjs';

function fixture(overrides={}){
 const projects={p:{id:'p',ownerId:'alice',duration:10,fps:30,activeRevisionId:'r2'},...overrides.projects};
 const db=overrides.db??{};let saves=0,ids=0;
 const service=createMarkerService({db,save:()=>saves++,getProject:(projectId,owner)=>{const p=projects[projectId];if(!p||p.ownerId!==owner)throw Object.assign(new Error('Project not found'),{status:404});return p;},id:()=>`m${++ids}`,now:()=> '2026-09-19T12:00:00.000Z'});
 return {db,service,saves:()=>saves};
}
const input={label:'Great reaction',note:'Use this beat',start:1.011,end:2.019,baseRevisionId:'r2',idempotencyKey:'marker-request-001'};

test('creation frame-snaps a bounded range and records revision provenance',()=>{
 const {service,saves}=fixture();const marker=service.create('p','alice',input);
 assert.deepEqual(marker,{id:'m1',label:'Great reaction',note:'Use this beat',start:1,end:2.033333333333333,baseRevisionId:'r2',createdAt:'2026-09-19T12:00:00.000Z',archived:false});
 assert.equal(saves(),1);
});

test('point markers are allowed but requested ranges that collapse after snapping are rejected',()=>{
 const {service}=fixture();
 assert.equal(service.create('p','alice',{...input,start:3.011,end:3.011,idempotencyKey:'point-key-001'}).start,3);
 assert.throws(()=>service.create('p','alice',{...input,start:3.001,end:3.01,idempotencyKey:'range-collapse'}),/one frame|range/i);
});

test('creation rejects stale revisions, invalid bounds and malformed metadata before mutation',()=>{
 for(const patch of [
  {baseRevisionId:'r1'},{start:-1},{end:11},{start:NaN},{end:Infinity},{label:' '},{label:'x'.repeat(81)},{note:'x'.repeat(1001)},{idempotencyKey:'short'}
 ]){
  const {service,db,saves}=fixture();assert.throws(()=>service.create('p','alice',{...input,...patch}),/revision|time|label|note|idempotency/i);assert.equal(saves(),0);assert.deepEqual(db,{});
 }
});

test('owner isolation applies to reads and mutations',()=>{
 const {service}=fixture();service.create('p','alice',input);
 assert.throws(()=>service.list('p','bob'),/not found/i);
 assert.throws(()=>service.update('p','bob','m1',{archived:true}),/not found/i);
});

test('an exact idempotent retry returns the saved marker while a conflicting reuse rejects',()=>{
 const {service,saves}=fixture();const first=service.create('p','alice',input),retry=service.create('p','alice',input);
 assert.deepEqual(retry,first);assert.equal(saves(),1);
 assert.throws(()=>service.create('p','alice',{...input,label:'Different'}),/different inputs/i);
 assert.throws(()=>service.create('p','alice',{...input,start:1.012}),/different inputs/i);
});

test('archive and restore preserve timing while updates allow only editable fields',()=>{
 const {service}=fixture();const original=service.create('p','alice',input);
 const archived=service.update('p','alice',original.id,{label:'  Keeper  ',note:'',archived:true});
 assert.equal(archived.label,'Keeper');assert.equal(archived.archived,true);assert.equal(archived.start,original.start);assert.equal(archived.baseRevisionId,'r2');
 assert.equal(service.update('p','alice',original.id,{archived:false}).archived,false);
 assert.throws(()=>service.update('p','alice',original.id,{start:4}),/only label, note, or archived/i);
 assert.throws(()=>service.update('p','alice',original.id,{}),/at least one/i);
});

test('the 200 marker limit includes archived markers',()=>{
 const db={markers:{p:Array.from({length:200},(_,i)=>({id:`m${i}`,label:'x',note:'',start:0,end:0,baseRevisionId:'r2',createdAt:'2026-09-19T12:00:00.000Z',archived:i===0}))}};
 const {service}=fixture({db});assert.throws(()=>service.create('p','alice',input),/200/);
});

test('markers from older revisions remain readable and selectable metadata is unchanged',()=>{
 const db={markers:{p:[{id:'old',label:'Earlier take',note:'',start:4,end:4,baseRevisionId:'r1',createdAt:'2026-09-18T12:00:00.000Z',archived:false}]}};
 const {service}=fixture({db});assert.equal(service.list('p','alice')[0].baseRevisionId,'r1');
});

test('terminal points identify the final source frame while ranges may end at the exact media boundary',()=>{
 for(const duration of [10,10.02]){
  const {service}=fixture({projects:{p:{id:'p',ownerId:'alice',duration,fps:30,activeRevisionId:'r2'}}});
  const point=service.create('p','alice',{...input,start:duration,end:duration,idempotencyKey:'terminal-point'});
  assert.equal(point.start,point.end);assert.ok(point.start<duration);assert.ok(Math.abs(point.start*30-Math.round(point.start*30))<1e-8);
  const range=service.create('p','alice',{...input,start:9.9,end:duration,idempotencyKey:'terminal-range'});
  assert.equal(range.end,duration);assert.ok(range.start<range.end);
 }
});
