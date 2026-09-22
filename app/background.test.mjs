import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEdit} from './domain.mjs';
import {buildEditPlan} from './conversation.mjs';
const points=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]];
const holes=[[[.4,.4],[.6,.4],[.6,.6],[.4,.6]]];
const p={activeRevisionId:'r',duration:5,width:1280,height:720};
const input=()=>({baseRevisionId:'r',operation:'background',start:0,end:2/30,scope:'range',masks:[{time:0,points,holes},{time:1/30,points,holes}]});
test('background validation preserves hole geometry and requires every visible frame',()=>{
 const result=validateEdit(p,input());assert.deepEqual(result.masks[0].holes,holes);assert.equal(result.scope,'range');
 const missing=input();missing.end=3/30;assert.throws(()=>validateEdit(p,missing),/every visible frame/);
 const bad=input();bad.masks[0].holes=[[[NaN,0],[0,1],[1,1]]];assert.throws(()=>validateEdit(p,bad),/openings/);
});
test('background plan is explicit, paid and requires reviewed foreground mask',()=>{
 const plan=buildEditPlan(p,{baseRevisionId:'r',text:'Change the background to underwater',start:0,end:2},{action:'background',source:'manual'});
 assert.equal(plan.action,'background');assert.equal(plan.operation,'background');assert.equal(plan.requiresMask,true);assert.equal(plan.status,'needs_input');assert.equal(plan.route.kind,'higgsfield');assert.match(plan.explanation,/original/);
});
test('background masks are scoped before generation and off-grid input is rejected',()=>{
 const extra=input();extra.masks.push({time:2/30,points,holes});
 assert.equal(validateEdit(p,extra).masks.length,2);
 const off=input();off.masks.splice(1,0,{time:.01,points,holes});assert.throws(()=>validateEdit(p,off),/exact video frames/);
 const outside=input();outside.masks[0].holes=[[[0,0],[.05,0],[.05,.05]]];assert.throws(()=>validateEdit(p,outside),/inside the object/);
});
