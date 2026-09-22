import test from 'node:test';
import assert from 'node:assert/strict';
import {canAutoPreview} from './auto-preview.mjs';
const context={revisionId:'r1'};
const base={id:'new',status:'ready',action:'mute',baseRevisionId:'r1',start:0,end:3,route:{id:'local-editor',kind:'local',estimatedUsd:0}};
test('only ready free local render plans auto-preview',()=>{
 assert.equal(canAutoPreview(base,context),true);
 for(const action of ['title','freeze','trim','cut','speed','crop','resize','fade_in','fade_out'])assert.equal(canAutoPreview({...base,action,tool:action,route:{...base.route,id:'deterministic'}},context),true);
 for(const patch of [{status:'needs_input'},{status:'completed'},{baseRevisionId:'old'},{requiresMask:true},{requiresReference:true},{referenceImage:{}},{selectedObjectName:'object'},{uiAction:'undo'},{jobId:'job'},{candidateId:'candidate'},{targetCandidateId:'c'},{end:0},{start:-1},{end:Infinity}])assert.equal(canAutoPreview({...base,...patch},context),false);
 for(const action of ['undo','apply','replace_audio','replace_picture','object','unknown','split','blur','pixelate','logo'])assert.equal(canAutoPreview({...base,action,tool:action,route:{...base.route,id:'deterministic'}},context),false);
 for(const route of [{...base.route,kind:'higgsfield'},{...base.route,kind:'ui'},{...base.route,estimatedUsd:1},{kind:'local',id:'local-editor'}])assert.equal(canAutoPreview({...base,route},context),false);
 for(const flag of ['hasCandidate','hasMask','hasReference'])assert.equal(canAutoPreview(base,{...context,[flag]:true}),false);
});
