import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.env.LAB_TEST_URL;
const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();assert.ok(r.ok,JSON.stringify(j));return j;};
async function done(job){for(let n=0;n<120;n++){const r=await fetch(base+'/api/jobs/'+job.id);job=await r.json();if(job.status==='completed')return job.result;if(['failed','unknown'].includes(job.status))throw new Error(job.error);await new Promise(r=>setTimeout(r,250));}throw new Error('Job timed out');}
test('real import, mute candidate, immutable apply, undo and downloadable MP4',{skip:!base},async()=>{
 const form=new FormData();form.append('file',new Blob([fs.readFileSync(new URL('./test-source.mp4',import.meta.url))],{type:'video/mp4'}),'Integration source.mp4');
 const imported=await fetch(base+'/api/projects',{method:'POST',body:form});assert.equal(imported.status,201);const p=await imported.json();assert.ok(p.duration>=5.9);assert.equal(p.revisions.length,1);
 const job=await post('/api/projects/'+p.id+'/render',{operation:'mute',start:1,end:3,baseRevisionId:p.activeRevisionId});
 const candidate=await done(job);assert.ok(candidate.url.endsWith('.mp4'));
 const applied=await post('/api/projects/'+p.id+'/apply',{candidateId:candidate.id,baseRevisionId:p.activeRevisionId});assert.equal(applied.revisions.length,2);
 const stale=await fetch(base+'/api/projects/'+p.id+'/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:candidate.id,baseRevisionId:p.activeRevisionId})});assert.equal(stale.status,400);
 const undo=await post('/api/projects/'+p.id+'/undo',{});assert.equal(undo.activeRevisionId,p.activeRevisionId);assert.equal(undo.revisions.length,2);
 const media=await fetch(base+candidate.url,{headers:{Range:'bytes=0-31'}});assert.equal(media.status,206);assert.match(media.headers.get('content-type'),/video/);
 console.log('QA_PROJECT_ID='+p.id);
});
