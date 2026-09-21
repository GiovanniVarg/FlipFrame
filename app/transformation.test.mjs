import test from 'node:test';import assert from 'node:assert/strict';
import {validateTransformation,transformationSources} from './transformation.mjs';
const p={id:'p',activeRevisionId:'r',duration:1};
const polygon=[[.1,.1],[.2,.1],[.2,.2],[.1,.2]];
const input=()=>({baseRevisionId:'r',start:0,end:.1,masks:[0,1,2].map(f=>({time:f/30,points:polygon})),replacementMasks:[0,1,2].map(f=>({time:f/30,points:polygon.map(([x,y])=>[x+.2,y])})),envelope:[[0,0],[.6,0],[.6,.6],[0,.6]],cameraPolicy:'fixed',reviewed:true,candidateOffset:0});
test('transformation accepts independent displaced masks with explicit permission',()=>{const q=validateTransformation(p,input());assert.equal(q.replacementMasks[0].points[0][0],.3+.00000000000000004);assert.equal(q.cameraPolicy,'fixed');});
test('stale revisions, missing permission, invalid geometry and gaps fail closed',()=>{for(const change of [{baseRevisionId:'old'},{reviewed:false},{cameraPolicy:'scene'},{candidateOffset:-1},{replacementMasks:[]},{envelope:[[0,0],[2,0],[0,1]]},{masks:input().masks.filter(m=>m.time!==1/30)}])assert.throws(()=>validateTransformation(p,{...input(),...change}));});
test('source listing does not expose another project or revision',()=>{assert.deepEqual(transformationSources({jobs:{a:{projectId:'other',generation:{baseRevisionId:'r',paths:{raw:import.meta.filename},providerState:{status:'completed'}}}},assets:{}},p),[]);});

test('scene replacement requires its own explicit consent and needs no object masks',()=>{
 const scene={baseRevisionId:'r',start:0,end:.5,candidateOffset:0,mode:'scene',reviewed:true,sceneApproved:true,cameraPolicy:'fixed'};
 assert.equal(validateTransformation(p,scene).mode,'scene');
 assert.throws(()=>validateTransformation(p,{...scene,sceneApproved:false}));
 assert.throws(()=>validateTransformation(p,{...scene,baseRevisionId:'stale'}));
});
