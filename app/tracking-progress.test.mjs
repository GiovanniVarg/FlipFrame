import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {trackingProgress,collectWorker,cancellableLocal} from './tracking-progress.mjs';
import {publicJob} from './jobs.mjs';
const fake=()=>Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter()});
test('only valid structured tracking counts are exposed',()=>{
 assert.deepEqual(trackingProgress('FLIPFRAME_PROGRESS {"stage":"tracking","completed":12,"total":20}'),{stage:'tracking',completed:12,total:20});
 for(const line of ['noise','FLIPFRAME_PROGRESS broken','FLIPFRAME_PROGRESS {"stage":"tracking","completed":21,"total":20}','FLIPFRAME_PROGRESS {"stage":"tracking","completed":-1,"total":20}'])assert.equal(trackingProgress(line),null);
 const progress={stage:'preparing',completed:0,total:20};assert.deepEqual(publicJob({progress}).progress,progress);
});
test('cancel stops once, ignores late output, and retains slot until child close',async()=>{
 const child=fake(),controller=new AbortController();let kills=0,settled=false,updates=0;
 const done=collectWorker(child,{signal:controller.signal,killTree:()=>kills++,onStderr:()=>updates++});
 const rejected=assert.rejects(done,{name:'AbortError'});done.then(()=>settled=true,()=>settled=true);
 controller.abort();controller.abort();child.stdout.emit('data','{"ok":true}');child.stderr.emit('data','late progress');
 await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.equal(kills,1);assert.equal(updates,0);
 child.emit('close',0);await rejected;
});
test('successful worker completes normally and removes abort handler',async()=>{
 const child=fake(),controller=new AbortController();let kills=0;
 const done=collectWorker(child,{signal:controller.signal,killTree:()=>kills++});child.stdout.emit('data','{"ok":true}');child.emit('close',0);
 assert.deepEqual(await done,{stdout:'{"ok":true}',code:0});controller.abort();assert.equal(kills,0);
});
test('timeout also waits for close before releasing worker',async()=>{
 const child=fake();let kills=0,settled=false;const done=collectWorker(child,{timeoutMs:5,killTree:()=>kills++});const rejected=assert.rejects(done,/exceeded/);done.catch(()=>settled=true);
 await new Promise(r=>setTimeout(r,20));assert.equal(kills,1);assert.equal(settled,false);child.emit('close',1);await rejected;
});
test('cancellation rejects running renders and all provider jobs',()=>{
 assert.equal(cancellableLocal({status:'running',workRequest:{kind:'segment'}}),true);
 assert.equal(cancellableLocal({status:'running',workRequest:{kind:'track'}}),true);
 assert.equal(cancellableLocal({status:'queued',workRequest:{kind:'render'}}),true);
 assert.equal(cancellableLocal({status:'running',workRequest:{kind:'render'}}),false);
 assert.equal(cancellableLocal({status:'queued',provider:'higgsfield'}),false);
 assert.equal(cancellableLocal({status:'completed',workRequest:{kind:'segment'}}),false);
});
