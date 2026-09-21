import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEdit, applyCandidate, undoProject} from './domain.mjs';
const project=()=>({duration:12,activeRevisionId:'r1',revisions:[{id:'r1',url:'/source',label:'Original'}]});
test('reject stale revision before processing',()=>assert.throws(()=>validateEdit(project(),{baseRevisionId:'old',operation:'mute',start:1,end:2}),/revision/i));
test('reject invalid and nonfinite range',()=>{for(const [start,end] of [[9,8],[-1,3],[0,13],[NaN,2]])assert.throws(()=>validateEdit(project(),{baseRevisionId:'r1',operation:'mute',start,end}),/range/i)});
test('object requires bounded normalized polygon with matching vertices',()=>{assert.throws(()=>validateEdit(project(),{baseRevisionId:'r1',operation:'object',start:1,end:3,scope:'range',masks:[{time:1,points:[[0,0],[1,0],[2,1]]}]}),/mask|polygon/i)});
test('valid audio edit carries interval unchanged',()=>assert.equal(validateEdit(project(),{baseRevisionId:'r1',operation:'gain',start:1,end:3,gainDb:-6}).gainDb,-6));
test('apply is immutable and rejects stale candidate; undo retains history',()=>{const p=project();const c={id:'c1',url:'/candidate',baseRevisionId:'r1',label:'Repair'};const next=applyCandidate(p,c);assert.equal(p.revisions.length,1);assert.equal(next.activeRevisionId,'c1');assert.throws(()=>applyCandidate(next,c),/revision/i);const old=undoProject(next);assert.equal(old.activeRevisionId,'r1');assert.equal(old.revisions.length,2)});

const triangle=[[0.1,0.1],[0.4,0.1],[0.4,0.4]];
const appearanceEdit=()=>({baseRevisionId:'r1',operation:'object',scope:'range',start:0,end:1,masks:[0,1,2,15,16,17].map(f=>({time:f/30,points:triangle})),visibleRanges:[{start:0,end:0.1},{start:0.5,end:0.6}]});
test('disjoint visible appearances permit untouched gaps',()=>assert.equal(validateEdit(project(),appearanceEdit()).visibleRanges.length,2));
test('visible ranges reject overlap and missing frame masks',()=>{const a=appearanceEdit();a.visibleRanges[1].start=1/30;assert.throws(()=>validateEdit(project(),a),/overlapping/);const b=appearanceEdit();b.masks.splice(1,1);assert.throws(()=>validateEdit(project(),b),/Each visible frame/);});

test('subframe selections cannot collapse into a zero-duration paid request',()=>assert.throws(()=>validateEdit(project(),{baseRevisionId:'r1',operation:'mute',start:.001,end:.002}),/frame/));

test('visibility endpoints are validated before paid generation',()=>{const a=appearanceEdit();a.visibleRanges[0]={start:.01,end:.09};assert.throws(()=>validateEdit(project(),a),/align/)});

test('SAM frame spans validate against the same snapped range used for rendering',()=>{const p={duration:151/30,activeRevisionId:'r'};const points=[[0,0],[1,0],[1,1]];const masks=Array.from({length:151},(_,i)=>({time:i/30,points}));const v=validateEdit(p,{baseRevisionId:'r',operation:'object',scope:'range',start:0,end:5.033,masks,visibleRanges:[{start:0,end:151/30}]});assert.equal(v.end,151/30);});
