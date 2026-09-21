import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGenerationRunner,GENERATION_QUOTE_LIFETIME_MS} from './generation-runner.mjs';

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'generation-runner-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const job={id:'job',projectId:'p',status:'queued',generation:{source:path.join(dir,'source.mp4'),processStart:0,processEnd:4,start:1,end:3,kind:'video',prompt:'Change sky',baseRevisionId:'r'}};
 const db={jobs:{job},candidates:{},projects:{p:{activeRevisionId:'r',revisions:[{id:'r'}]}},spend:{spent:0,reserved:0}};
 const calls={upload:0,estimate:0,submit:0,poll:0,download:0,render:0,extract:0};
 let persisted,failRender=false,failPoll=false;
 const adapter={
  async uploadAsset(){calls.upload++;return 'https://storage.googleapis.com/source.mp4';},
  async estimateGeneration(){calls.estimate++;return {estimatedUsd:.2};},
  async submitGeneration(){calls.submit++;assert.equal(persisted.jobs.job.generation.submission,'attempting');assert.equal(persisted.spend.reserved,.4);return {requestId:'accepted-once',status:'queued',statusUrl:'https://api.higgsfield.ai/status/accepted-once'};},
  async pollGeneration(previous){calls.poll++;if(failPoll)throw new Error('Temporary poll failure');return {...previous,status:'completed',outputUrl:'https://storage.googleapis.com/result.mp4'};}
 };
 const dependencies={db,save(){persisted=structuredClone(db);},adapter,budgetLimit:2,pollDelay:0,pollAttempts:2,
  mediaPath:id=>path.join(dir,id+'.mp4'),mediaUrl:file=>'/media/'+path.basename(file),
  async download(url,file){calls.download++;fs.writeFileSync(file,'downloaded');},
  async runMedia(request){
   if(request.action==='probe')return {duration:4,hasAudio:true};
   if(request.action==='render'){calls.render++;if(failRender)throw new Error('Local encoder interrupted');}
   if(request.action==='extract')calls.extract++;
   fs.writeFileSync(request.output,'media');return {note:'actual pixels composed',...(request.action==='object_repair'?{ok:true,verifiedFrames:120,framesRepaired:60}:{})};
  }
 };
 return {db,job,calls,adapter,dependencies,runner:()=>createGenerationRunner(dependencies),get persisted(){return persisted;},set failRender(value){failRender=value;},set failPoll(value){failPoll=value;}};
}

test('accepted request resumes after restart without another submission or reservation',async t=>{
 const f=fixture(t);f.failPoll=true;
 await f.runner().run(f.job);
 assert.equal(f.job.status,'failed');assert.equal(f.job.retryable,true);assert.equal(f.calls.submit,1);
 const resumed=structuredClone(f.persisted);f.dependencies.db=resumed;f.dependencies.save=()=>{};f.failPoll=false;
 await createGenerationRunner(f.dependencies).run(resumed.jobs.job);
 assert.equal(resumed.jobs.job.status,'completed');assert.equal(f.calls.submit,1);assert.equal(f.calls.upload,1);assert.equal(f.calls.estimate,1);
 assert.equal(resumed.spend.reserved,.4);assert.equal(Object.keys(resumed.candidates).length,1);
 assert.equal(resumed.projects.p.activeRevisionId,'r');assert.equal(resumed.projects.p.revisions.length,1);
});

test('composition failure resumes local phases with no new generation or spend',async t=>{
 const f=fixture(t);f.failRender=true;await f.runner().run(f.job);
 assert.equal(f.job.status,'failed');assert.equal(f.job.providerState.status,'completed');assert.equal(f.job.retryable,true);
 const stableId=f.job.generation.candidateId;f.failRender=false;
 await f.runner().run(f.job);
 assert.equal(f.job.status,'completed');assert.equal(f.job.result.id,stableId);
 assert.equal(f.calls.submit,1);assert.equal(f.calls.poll,1);assert.equal(f.calls.download,1);assert.equal(f.calls.render,2);assert.equal(f.db.spend.reserved,.4);
 await f.runner().run(f.job);assert.equal(f.calls.render,2);
});

test('lost submission response remains unknown and is never replayed',async t=>{
 const f=fixture(t);f.adapter.submitGeneration=async()=>{f.calls.submit++;throw new Error('Connection reset after POST');};
 await f.runner().run(f.job);assert.equal(f.job.status,'unknown');assert.equal(f.job.retryable,false);
 await f.runner().run(f.job);assert.equal(f.calls.submit,1);assert.equal(f.db.spend.reserved,.4);assert.equal(f.calls.poll,0);
});

test('crash between durable submit marker and response requires reconciliation',async t=>{
 const f=fixture(t);f.job.generation.submission='attempting';f.job.generation.reserved=true;f.db.spend.reserved=.4;
 await f.runner().run(f.job);assert.equal(f.job.status,'unknown');assert.equal(f.calls.submit,0);assert.equal(f.calls.upload,0);assert.equal(f.db.spend.reserved,.4);
});

test('definitively rejected submission releases hold once without retry',async t=>{
 const f=fixture(t);f.adapter.submitGeneration=async()=>{f.calls.submit++;return {status:'failed',error:'HTTP 422 rejected'};};
 await f.runner().run(f.job);assert.equal(f.job.status,'failed');assert.equal(f.job.retryable,false);assert.equal(f.db.spend.reserved,0);
 await f.runner().run(f.job);assert.equal(f.calls.submit,1);assert.equal(f.db.spend.reserved,0);
});

test('accepted provider failure releases billing reservation',async t=>{
 const f=fixture(t);f.adapter.pollGeneration=async previous=>({...previous,status:'failed',error:'Provider failed after acceptance'});
 await f.runner().run(f.job);assert.equal(f.job.status,'failed');assert.equal(f.job.retryable,false);assert.equal(f.db.spend.reserved,0);
});

test('simultaneous invocations share one submission and stable candidate',async t=>{
 const f=fixture(t);const runner=f.runner();await Promise.all([runner.run(f.job),runner.run(f.job)]);
 assert.equal(f.calls.submit,1);assert.equal(Object.keys(f.db.candidates).length,1);
});


test('canceled and zero-duration requests do not reach the provider',async t=>{
 const f=fixture(t);f.job.status='canceled';await f.runner().run(f.job);assert.equal(f.job.status,'canceled');assert.equal(f.calls.upload,0);
 f.job.status='queued';f.job.generation.end=f.job.generation.start;await f.runner().run(f.job);
 assert.equal(f.job.status,'failed');assert.equal(f.calls.upload,0);assert.equal(f.calls.submit,0);assert.equal(f.db.spend.reserved,0);
});


test('completed job removes intermediates after durable candidate save',async t=>{
 const f=fixture(t);let candidateWasDurable=false;const originalSave=f.dependencies.save;
 f.dependencies.save=()=>{originalSave();if(f.job.status==='completed'){candidateWasDurable=!!f.db.candidates[f.job.generation.candidateId];assert.ok(fs.existsSync(f.job.generation.paths.raw));}};
 await f.runner().run(f.job);assert.equal(f.job.status,'completed');assert.equal(candidateWasDurable,true);
 assert.ok(fs.existsSync(f.job.generation.paths.raw));
 for(const name of ['clip','trimmed'])assert.equal(fs.existsSync(f.job.generation.paths[name]),false);
 assert.equal(fs.existsSync(f.job.generation.paths.output),true);
});

test('incomplete download file is replaced safely on recovery',async t=>{
 const f=fixture(t);f.job.generation.paths={clip:path.join(path.dirname(f.job.generation.source),'clip.mp4'),raw:path.join(path.dirname(f.job.generation.source),'raw.mp4'),trimmed:path.join(path.dirname(f.job.generation.source),'trimmed.mp4'),output:path.join(path.dirname(f.job.generation.source),'out.mp4')};
 fs.writeFileSync(f.job.generation.paths.raw,'truncated prior download');
 f.job.providerState={requestId:'already-paid',status:'completed',outputUrl:'https://storage.googleapis.com/result.mp4'};
 f.dependencies.download=async(url,file)=>{f.calls.download++;fs.writeFileSync(file,'complete',{flag:'wx'});};
 await f.runner().run(f.job);assert.equal(f.job.status,'completed');assert.equal(f.calls.download,1);assert.equal(f.calls.submit,0);
});

test('pre-submit upload failure can retry and passes pricing dimensions to quote',async t=>{
 const f=fixture(t);let shouldFail=true;f.job.generation.pricingDimensions={duration:4,resolution:'720p'};
 const original=f.adapter.uploadAsset;f.adapter.uploadAsset=async(...args)=>{if(shouldFail)throw new Error('Upload unavailable');return original(...args);};
 f.adapter.estimateGeneration=async input=>{assert.deepEqual(input.pricingDimensions,{duration:4,resolution:'720p'});return {estimatedUsd:.2};};
 await f.runner().run(f.job);assert.equal(f.job.status,'failed');assert.equal(f.job.retryable,true);assert.equal(f.calls.submit,0);
 assert.ok(fs.existsSync(f.job.generation.paths.clip));shouldFail=false;
 await f.runner().run(f.job);assert.equal(f.job.status,'completed');assert.equal(f.calls.submit,1);
});


test('unknown status with accepted request identity recovers via GET without new charge',async t=>{
 const f=fixture(t);f.job.status='unknown';f.job.providerState={status:'unknown',requestId:'known-request',statusUrl:'https://api.higgsfield.ai/status/known-request'};
 f.job.generation.reserved=true;f.job.generation.reservedUsd=.400001;f.db.spend.reserved=.400001;
 await f.runner().run(f.job);assert.equal(f.job.status,'completed');assert.equal(f.calls.poll,1);assert.equal(f.calls.submit,0);assert.equal(f.calls.estimate,0);assert.equal(f.db.spend.reserved,.400001);
});

test('resolution and rounded reservation are preserved exactly',async t=>{
 const f=fixture(t);f.job.generation.resolution='720p';
 f.adapter.estimateGeneration=async input=>{assert.equal(input.resolution,'720p');return {estimatedUsd:.2000001};};
 f.adapter.submitGeneration=async input=>{assert.equal(input.resolution,'720p');return {status:'unknown',error:'Uncertain accepted request'};};
 await f.runner().run(f.job);assert.equal(f.job.generation.reservedUsd,.400001);assert.equal(f.db.spend.reserved,.400001);assert.equal(f.job.quote.reservedUsd,.400001);
});


test('shorter unselected context tail is accepted without retiming selected interval',async t=>{
 const f=fixture(t);f.job.generation.processEnd=5;f.job.generation.start=1;f.job.generation.end=4;
 const original=f.dependencies.runMedia;const requests=[];
 f.dependencies.runMedia=async request=>{requests.push(request);if(request.action==='probe')return {duration:113/24,hasAudio:true};return original(request);};
 await f.runner().run(f.job);assert.equal(f.job.status,'completed');assert.equal(f.job.generation.generatedDuration,113/24);
 assert.match(f.job.result.note,/duration differs/);assert.match(f.job.result.note,/without retiming or looping/);
 const trim=requests.find(request=>request.action==='extract'&&request.source===f.job.generation.paths.raw);
 assert.equal(trim.start,1);assert.equal(trim.end,4);
 const render=requests.find(request=>request.action==='render');assert.equal(render.start,1);assert.equal(render.end,4);assert.equal(render.source,f.job.generation.source);
});

test('output ending inside selected interval fails closed before composition',async t=>{
 const f=fixture(t);f.job.generation.processEnd=5;f.job.generation.start=1;f.job.generation.end=4;
 const original=f.dependencies.runMedia;
 f.dependencies.runMedia=async request=>request.action==='probe'?{duration:3.99,hasAudio:true}:original(request);
 await f.runner().run(f.job);assert.equal(f.job.status,'failed');assert.match(f.job.error,/Checking this completed request again cannot add frames/);assert.equal(f.job.retryable,false);assert.equal(f.job.failureCode,'OUTPUT_TOO_SHORT');assert.equal(f.calls.render,0);assert.equal(Object.keys(f.db.candidates).length,0);assert.equal(f.db.projects.p.activeRevisionId,'r');
});

test('fresh quote above approved plan never reserves or submits',async t=>{const f=fixture(t);f.job.generation.approvedEstimateUsd=.1;await f.runner().run(f.job);assert.equal(f.job.status,'failed');assert.match(f.job.error,/approved plan/);assert.equal(f.calls.submit,0);assert.equal(f.db.spend.reserved,0)});

test('provider receives the cropped-clip timeline and explicit selected offsets',async t=>{
 const f=fixture(t);Object.assign(f.job.generation,{processStart:2,processEnd:6,start:3,end:5,prompt:'Change the socks within the selected interval'});
 const original=f.adapter.submitGeneration;f.adapter.submitGeneration=async input=>{assert.match(input.prompt,/1\.000000 to 3\.000000 seconds/);assert.match(input.prompt,/clip time 0 equals project time 2\.000000/);assert.match(input.prompt,/Change the socks/);return original(input)};
 await f.runner().run(f.job);assert.equal(f.job.status,'completed');assert.equal(f.calls.submit,1);
});


test('unsent recovery refreshes a persisted quote and blocks a price above approval',async t=>{
 const f=fixture(t);f.job.generation.approvedEstimateUsd=.25;f.dependencies.budgetLimit=.1;
 await f.runner().run(f.job);assert.equal(f.calls.estimate,1);assert.equal(f.calls.submit,0);
 f.dependencies.budgetLimit=2;f.adapter.estimateGeneration=async()=>{f.calls.estimate++;return {estimatedUsd:.3};};
 await f.runner().run(f.job);
 assert.equal(f.calls.estimate,2);assert.equal(f.calls.submit,0);assert.equal(f.db.spend.reserved,0);
 assert.match(f.job.error,/approved plan/);
});

test('unsent recovery replaces its old hold and revalidates the workspace budget',async t=>{
 const f=fixture(t);Object.assign(f.job.generation,{quote:{estimatedUsd:.1},reserved:true,reservedUsd:.2,approvedEstimateUsd:.25});
 f.db.spend.reserved=.3;f.dependencies.budgetLimit=.4;
 await f.runner().run(f.job);assert.equal(f.calls.estimate,1);assert.equal(f.calls.submit,0);
 assert.ok(Math.abs(f.db.spend.reserved-.3)<1e-8);assert.match(f.job.error,/budget/);
 f.dependencies.budgetLimit=2;
 f.adapter.submitGeneration=async()=>{f.calls.submit++;assert.ok(Math.abs(f.persisted.spend.reserved-.5)<1e-8);return {status:'unknown'};};
 await f.runner().run(f.job);assert.equal(f.calls.estimate,2);assert.equal(f.calls.submit,1);
 assert.equal(f.job.generation.reservedUsd,.4);assert.ok(Math.abs(f.db.spend.reserved-.5)<1e-8);
 await f.runner().run(f.job);assert.equal(f.calls.estimate,2);assert.equal(f.calls.submit,1);
});

test('an estimate exceeding its lifetime cannot reserve or submit and recovery obtains a new quote',async t=>{
 const f=fixture(t);let time=1000;f.dependencies.now=()=>time;
 f.adapter.estimateGeneration=async()=>{f.calls.estimate++;time+=GENERATION_QUOTE_LIFETIME_MS;return {estimatedUsd:.2};};
 await f.runner().run(f.job);assert.equal(f.calls.submit,0);assert.equal(f.db.spend.reserved,0);assert.match(f.job.error,/expired/);
 f.adapter.estimateGeneration=async()=>{f.calls.estimate++;return {estimatedUsd:.2};};
 await f.runner().run(f.job);assert.equal(f.calls.estimate,2);assert.equal(f.calls.submit,1);assert.equal(f.job.status,'completed');
});

test('quote expiry after persisting a hold remains unsent and recovery replaces that hold',async t=>{
 const f=fixture(t);let time=1000,expire=true;f.dependencies.now=()=>time;
 const save=f.dependencies.save;f.dependencies.save=()=>{save();if(expire&&f.job.generation.reserved){time+=GENERATION_QUOTE_LIFETIME_MS;expire=false;}};
 await f.runner().run(f.job);assert.equal(f.calls.submit,0);assert.equal(f.job.generation.submission,undefined);assert.equal(f.db.spend.reserved,.4);
 await f.runner().run(f.job);assert.equal(f.calls.estimate,2);assert.equal(f.calls.submit,1);assert.equal(f.db.spend.reserved,.4);
});

test('legacy short source cannot be uploaded or submitted again',async t=>{const f=fixture(t);f.job.generation.processEnd=3;await f.runner().run(f.job);assert.equal(f.job.status,'failed');assert.match(f.job.error,/old plan/);assert.equal(f.calls.upload,0);assert.equal(f.calls.submit,0);});

test('object generation sends reference guidance and retains reviewed masks for composition',async t=>{
 const f=fixture(t);const points=[[0,0],[1,0],[1,1]];
 Object.assign(f.job.generation,{operation:'object',scope:'range',masks:[{time:1,points},{time:2,points}],visibleRanges:[{start:1,end:2}]});
 const original=f.dependencies.runMedia;const media=[];f.dependencies.runMedia=async r=>{media.push(r);return original(r)};
 const estimate=f.adapter.estimateGeneration;f.adapter.estimateGeneration=async input=>{assert.equal(input.imageUrls.length,1);assert.match(input.prompt,/selection guide/);return estimate(input)};
 await f.runner().run(f.job);assert.equal(f.job.status,'completed');assert.equal(f.calls.upload,2);
 assert.equal(media.filter(r=>r.action==='object_reference').length,1);
 const render=media.find(r=>r.action==='object_repair');assert.ok(render.reviewOutput);assert.ok(fs.existsSync(f.job.generation.paths.raw));assert.ok(fs.existsSync(f.job.generation.paths.trimmed));assert.ok(f.job.result.maskReviewUrl);assert.deepEqual(render.masks,f.job.generation.masks);assert.deepEqual(render.visibleRanges,f.job.generation.visibleRanges);assert.equal(render.operation,'object');
});

test('automatic edge repair retries accepted output without another paid request',async t=>{
 const f=fixture(t);const points=[[.2,.2],[.6,.2],[.6,.8],[.2,.8]];
 Object.assign(f.job.generation,{operation:'object',scope:'range',masks:[{time:1,points},{time:2,points}]});
 const original=f.dependencies.runMedia;let fail=true;
 f.dependencies.runMedia=async request=>{if(request.action==='object_repair'&&fail)throw new Error('Uncertain silhouette');return original(request);};
 await f.runner().run(f.job);assert.equal(f.job.status,'failed');assert.equal(f.calls.submit,1);
 const reserved=f.db.spend.reserved;fail=false;await f.runner().run(f.job);
 assert.equal(f.job.status,'completed');assert.equal(f.calls.submit,1);assert.equal(f.db.spend.reserved,reserved);
 assert.ok(fs.existsSync(f.job.generation.paths.raw));assert.ok(f.job.result.maskReviewUrl);
});
test('unsupported automatic object duration fails before uploading or billing',async t=>{
 const f=fixture(t);Object.assign(f.job.generation,{operation:'object',processEnd:12,start:0,end:12});await f.runner().run(f.job);
 assert.equal(f.job.status,'failed');assert.equal(f.calls.submit,0);assert.equal(f.calls.upload,0);assert.equal(f.db.spend.reserved,0);
});

test('object reference combines desired appearance with selection into one provider image',async t=>{
 const f=fixture(t);f.job.generation.operation='object';f.job.generation.referenceImagePath='owned-reference.png';f.job.generation.masks=[{time:1,points:[[.2,.2],[.6,.2],[.6,.8]]}];let preparation,submitted;
 const run=f.dependencies.runMedia;f.dependencies.runMedia=async q=>{if(q.action==='prepare_reference')preparation=q;return run(q)};
 const submit=f.adapter.submitGeneration;f.adapter.submitGeneration=async q=>{submitted=q;return submit(q)};
 await f.runner().run(f.job);assert.equal(f.job.status,'completed');assert.equal(preparation.source,'owned-reference.png');assert.ok(preparation.guide);assert.equal(submitted.imageUrls.length,1);assert.match(submitted.prompt,/RIGHT/);
});

test('legacy mask-based jobs use verified automatic repair and persist proof',async t=>{
 const f=fixture(t);f.job.generation.masks=[{time:1,points:[[.2,.2],[.6,.2],[.6,.8]]}];
 await f.runner().run(f.job);assert.equal(f.job.status,'completed');assert.equal(f.job.generation.operation,'object');assert.equal(f.job.result.repairVerification.verifiedFrames,120);assert.equal(f.job.result.repairVerification.requiresVisualReview,true);
});
test('missing preservation proof blocks object publication and resumes without another generation',async t=>{
 const f=fixture(t);f.job.generation.masks=[{time:1,points:[[.2,.2],[.6,.2],[.6,.8]]}];const original=f.dependencies.runMedia;
 f.dependencies.runMedia=async q=>{const result=await original(q);if(q.action==='object_repair')delete result.verifiedFrames;return result};
 await f.runner().run(f.job);assert.equal(f.job.status,'failed');assert.equal(Object.keys(f.db.candidates).length,0);assert.equal(f.calls.submit,1);
 f.dependencies.runMedia=original;await f.runner().run(f.job);assert.equal(f.job.status,'completed');assert.equal(f.calls.submit,1);
});

test('candidate retains the validated user reference for later comparison',async t=>{
 const f=fixture(t);f.db.assets={ref:{id:'ref',projectId:'p',kind:'reference-image',url:'/media/ref.png',name:'Desired mug'}};
 f.job.generation.referenceImageId='ref';
 await f.runner().run(f.job);
 assert.equal(f.job.status,'completed');assert.deepEqual(f.job.result.referenceImage,{id:'ref',url:'/media/ref.png',name:'Desired mug'});
 assert.equal(f.job.result.referenceImage.path,undefined);
});
