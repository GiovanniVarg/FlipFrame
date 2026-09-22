import test from 'node:test';import assert from 'node:assert/strict';
import {publicJob,publicJobSummary} from './jobs.mjs';
test('compact selection list omits heavy geometry without mutating stored or detailed results',()=>{
 const masks=Array.from({length:183},(_,frame)=>({time:frame/30,points:Array.from({length:256},(_,i)=>[i/256,.5]),holes:[[[.1,.1],[.2,.1],[.2,.2]]]}));
 const job={id:'selection',status:'completed',workRequest:{kind:'segment',baseRevisionId:'rev'},result:{masks,points:masks[0].points,holes:masks[0].holes,visibleRanges:[{start:0,end:6.1}],requiresReview:true,device:'cuda',baseRevisionId:'rev'}};
 const original=JSON.stringify(job),full=publicJob(job),summary=publicJobSummary(job);
 assert.ok(JSON.stringify(summary).length<JSON.stringify(full).length/100);
 assert.equal(summary.result.masks,undefined);assert.equal(summary.result.points,undefined);assert.equal(summary.result.holes,undefined);assert.equal(summary.result.maskCount,183);assert.equal(summary.result.geometryOmitted,true);assert.equal(summary.result.requiresReview,true);
 assert.equal(full.result.masks,masks);assert.equal(JSON.stringify(job),original);
});
test('compact render and generation jobs retain all candidate review fields',()=>{
 for(const job of [{workRequest:{kind:'render'}},{generation:{kind:'video'}}]){
  Object.assign(job,{id:'render',status:'completed',result:{id:'candidate',url:'/media/candidate.mkv',maskReviewUrl:'/media/review.webm',baseRevisionId:'rev',repairVerification:{verifiedFrames:183},start:0,end:6.1}});
  assert.deepEqual(publicJobSummary(job),publicJob(job));
 }
});
test('compact running tracking jobs retain progress and revision context',()=>{
 const job={id:'tracking',status:'running',progress:{stage:'tracking',completed:2,total:183},workRequest:{kind:'track',baseRevisionId:'rev'}};
 assert.deepEqual(publicJobSummary(job),publicJob(job));
});
