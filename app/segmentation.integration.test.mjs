import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const base=process.env.LAB_TEST_URL;
const enabled=Boolean(base)&&process.env.SAM2_HTTP_SMOKE==='1';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('real CUDA SAM2 HTTP frame, native-frame propagation and masked composite', {skip:!enabled,timeout:600000},async()=>{
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Smoke is restricted to a local worker');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sam2-http-'));
 const python=process.env.SEGMENTATION_PYTHON||path.join(root,'.segmentation-env',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 let project;
 async function request(route,body){
  const response=await fetch(base+route,{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  const result=await response.json();assert.ok(response.ok,`${route}: ${JSON.stringify(result)}`);return result;
 }
 async function done(job){
  const deadline=Date.now()+240000;
  while(Date.now()<deadline){
   const response=await fetch(base+'/api/jobs/'+job.id,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);job=await response.json();
   if(job.status==='completed')return job.result;
   assert.ok(!['failed','unknown','canceled'].includes(job.status),job.error||job.status);await pause(500);
  }
  throw new Error('SAM2 worker job timed out');
 }
 function upload(filename){const form=new FormData();form.append('file',new Blob([fs.readFileSync(path.join(folder,filename))],{type:'video/mp4'}),filename);return form;}
 try{
  const generated=spawnSync(python,['-c',`import cv2,numpy as np,sys,pathlib
folder=pathlib.Path(sys.argv[1])
for name,replacement in [('source.mp4',False),('replacement.mp4',True)]:
 writer=cv2.VideoWriter(str(folder/name),cv2.VideoWriter_fourcc(*'mp4v'),30,(256,256))
 assert writer.isOpened()
 for i in range(30):
  frame=np.full((256,256,3),[90,65,35],np.uint8)
  if replacement: frame[:]=[30,40,220]
  else: cv2.ellipse(frame,(128+i//5,125),(36,85),0,0,360,(220,230,235),-1)
  writer.write(frame)
 writer.release()
`,folder],{windowsHide:true,encoding:'utf8',timeout:30000});
  assert.equal(generated.status,0,generated.stderr||generated.error?.message);
  project=await request('/api/projects',upload('source.mp4'));
  const route='/api/projects/'+project.id;
  const input={baseRevisionId:project.activeRevisionId,points:[[.30,.10],[.70,.10],[.70,.90],[.30,.90]]};
  const frame=await done(await request(route+'/segment',{...input,time:0}));
  assert.equal(frame.genuineSegmentation,true);assert.match(frame.device,/^cuda/);assert.equal(frame.method,'sam2.1-hiera-tiny');
  assert.ok(frame.confidence>.5);assert.ok(frame.maskAreaPixels>1000&&frame.maskAreaPixels<25000);assert.ok(frame.points.length>=3&&frame.points.length<=64);
  const video=await done(await request(route+'/segment',{...input,video:true,start:0,end:.1}));
  assert.equal(video.genuineSegmentation,true);assert.match(video.device,/^cuda/);assert.equal(video.method,'sam2.1-video-tiny');
  assert.equal(video.frameCount,3);assert.equal(video.masks.length,3);assert.equal(video.sparseSamples,false);assert.equal(video.status,'complete');assert.deepEqual(video.gaps,[]);
  assert.equal(video.requiresReview,true);assert.equal(video.identityAcrossCuts,false);
  assert.deepEqual(video.masks.map(mask=>mask.time),[0,1/30,2/30]);
  for(const mask of video.masks){assert.equal(mask.points.length,64);assert.ok(mask.points.every(point=>point.length===2&&point.every(v=>Number.isFinite(v)&&v>=0&&v<=1)));}
  const replacement=await request(route+'/assets',upload('replacement.mp4'));
  const candidate=await done(await request(route+'/render',{baseRevisionId:project.activeRevisionId,operation:'object',scope:'range',start:0,end:.1,masks:video.masks,visibleRanges:video.visibleRanges,candidateId:replacement.id}));
  const media=await fetch(base+candidate.url);assert.equal(media.status,200);fs.writeFileSync(path.join(folder,'composite.mp4'),Buffer.from(await media.arrayBuffer()));
  const verified=spawnSync(python,['-c',`import cv2,sys,pathlib
folder=pathlib.Path(sys.argv[1]); cap=cv2.VideoCapture(str(folder/'composite.mp4')); frames=[]
while True:
 ok,frame=cap.read()
 if not ok: break
 frames.append(frame)
cap.release()
assert len(frames)==30,len(frames)
assert int(frames[0][125,128,2])>180,frames[0][125,128]
assert int(frames[0][10,10,2])<80,frames[0][10,10]
assert int(frames[5][125,128,0])>180,frames[5][125,128]
`,folder],{windowsHide:true,encoding:'utf8',timeout:30000});
  assert.equal(verified.status,0,verified.stderr||verified.error?.message);
  console.log(JSON.stringify({sam2HttpSmoke:'passed',device:video.device,nativeFrames:video.frameCount,verticesPerFrame:64,compositeFrames:30,projectId:project.id}));
 }finally{
  if(project)await request('/api/projects/'+project.id+'/trash',{});
  fs.rmSync(folder,{recursive:true,force:true});
 }
});
