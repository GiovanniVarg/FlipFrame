import {runtimeLayout} from './runtime-layout.mjs';
import {registerPlaybackPreview} from './playback-preview.mjs';
import {autoBackgroundReady,registerAutoBackground} from './auto-background.mjs';
import {registerAgentApi} from './agent-api.mjs';
import {loadRuntimeSettings,registerRuntimeSettings} from './runtime-settings.mjs';
import {reasoningConfigured,modelConnections} from './model-connections.mjs';
import {registerGenerationLibrary} from './generation-library.mjs';
import {registerTransformationRoutes} from './transformation.mjs';
import {LOCAL_TOOLS,localParameters} from './local-tools.mjs';
import {collectWorker,trackingProgress,cancellableLocal,canceledError,mediaWorkerTimeout,progressPhase} from './tracking-progress.mjs';
import {repairProgress} from './repair-progress.mjs';
import {registerBatches} from './batch-variations.mjs';
import {registerReviewNotes} from './review-notes.mjs';
import {registerCandidateComparison} from './candidate-comparison.mjs';
import {registerBrandPresets} from './brand-presets.mjs';
import {registerCandidateLibraryRoutes} from './candidate-library.mjs';
import {repairSource,validateProtectedAreas} from './local-candidate-repair.mjs';
import {createOriginalService,registerOriginalRoutes} from './original-generation.mjs';
import {OBJECT_REPAIR_PHASE,verifiedObjectRepair} from './object-repair-contract.mjs';
import {registerReferenceImages,ownedReference} from './reference-images.mjs';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createAuth} from './auth.mjs';
import {ownedProject,canReadMedia} from './access.mjs';
import {openState} from './state-store.mjs';
import {saveDownload} from './download.mjs';
import {createGenerationRunner} from './generation-runner.mjs';
import * as adapter from './providers.mjs';
import {publicJob,publicJobSummary,recoverable,findDuplicate,requestFingerprint} from './jobs.mjs';
import {validateEdit,applyCandidate,undoProject} from './domain.mjs';
import {createConversationService,computeGenerationWindow} from './conversation.mjs';
import {classifyEdit} from './decision-router.mjs';
import {registerProjectDraftRoutes} from './project-drafts.mjs';
import {createProjectImporter,registerSampleProjectRoutes,MAX_SOURCE_BYTES} from './sample-project.mjs';
import {registerMarkerRoutes} from './markers.mjs';
import {registerCandidateReviewRoutes} from './candidate-review.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const {userRoot:USER_ROOT}=runtimeLayout(ROOT);
try{process.loadEnvFile(path.join(USER_ROOT,'.env.local'));}catch{}
try{process.loadEnvFile(path.join(USER_ROOT,'.env'));}catch{}
if((process.env.LAB_MODE||'local')==='local')loadRuntimeSettings(USER_ROOT);
const DATA=runtimeLayout(ROOT).dataRoot;
const segmentationReady=()=>fs.existsSync(process.env.SAM2_CHECKPOINT||path.join(USER_ROOT,'.segmentation','sam2.1_hiera_tiny.pt'))&&fs.existsSync(process.env.SEGMENTATION_PYTHON||path.join(USER_ROOT,'.segmentation-env',process.platform==='win32'?'Scripts/python.exe':'bin/python')); 
fs.mkdirSync(path.join(DATA,'media'),{recursive:true});fs.mkdirSync(path.join(DATA,'uploads'),{recursive:true});
const MODE=process.env.LAB_MODE||'local';if(!['local','authenticated-local','saas'].includes(MODE))throw new Error('Unsupported LAB_MODE');const ORIGIN=process.env.APP_ORIGIN;const AUTH_REQUIRED=MODE!=='local';
if(MODE==='saas'&&!ORIGIN)throw new Error('APP_ORIGIN required');
const store=openState(DATA),db=store.state,save=store.save;
for(const p of Object.values(db.projects)){if(!p.ownerId)p.ownerId='local-owner';}
for(const job of Object.values(db.jobs)){if(['running','queued'].includes(job.status)){job.status=job.generation?(job.generation.submission==='attempting'&&!job.providerState?'unknown':'queued'):job.provider?'unknown':job.workRequest?'queued':'failed';job.error=job.status==='queued'?undefined:'Service restarted before completion. Original preserved.';}}save();
const id=()=>randomUUID();const mediaPath=(key,ext='mp4')=>path.join(DATA,'media',key+'.'+ext);
const mediaUrl=p=>'/media/'+path.basename(p);
const projectById=(key,owner)=>ownedProject(db,key,owner);
const publicProject=p=>({...p,revisions:p.revisions.map(({path,...r})=>r),sourcePath:undefined});
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
let mediaBusy=false,providerBusy=false;
export async function runMedia(request,onProgress,{signal}={}){
 if(signal?.aborted)throw canceledError();
 const file=path.join(DATA,'request-'+id()+'.json');
 const segment=['segment','segment_video'].includes(request.action);
 const tempDirectory=segment?fs.mkdtempSync(path.join(DATA,'sam-')):undefined;
 const workerRequest={...request,...(tempDirectory?{tempDirectory}:{})};
 fs.writeFileSync(file,JSON.stringify(workerRequest));
 const segPython=process.env.SEGMENTATION_PYTHON||path.join(USER_ROOT,'.segmentation-env',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 try{
 const child=spawn(segment||['auto_background','background_replace','object_repair','precision_recolor','deterministic','transformation','transformation_track'].includes(request.action)?segPython:process.env.PYTHON||'python',['transformation','transformation_track'].includes(request.action)?[path.join(ROOT,'transformation_engine.py'),file]:request.action==='deterministic'?[path.join(ROOT,'local_edit.py'),file]:request.action==='auto_background'?[path.join(ROOT,'auto_background.py'),file]:request.action==='background_replace'?[path.join(ROOT,'background_replace.py'),file]:request.action==='precision_recolor'?[path.join(ROOT,'precision_recolor.py'),file]:request.action==='object_repair'?[path.join(ROOT,'object_repair.py'),file]:segment?[path.join(ROOT,'segmentation.py')]:[path.join(ROOT,'media_engine.py'),file],{cwd:ROOT,windowsHide:true,detached:process.platform!=='win32'});if(segment){child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({...workerRequest,operation:request.action==='segment_video'?'video':'frame',polygon:request.points}));}

 let progressBuffer='';
 const {stdout,code}=await collectWorker(child,{signal,timeoutMs:mediaWorkerTimeout(request.action),onStderr(chunk){
  progressBuffer+=chunk;const lines=progressBuffer.split('\n');progressBuffer=lines.pop().slice(-8000);
  for(const line of lines){const progress=trackingProgress(line);const phase=progress||repairProgress(line);if(phase)onProgress?.(phase);}
 }});
 if(signal?.aborted)throw canceledError();
 let result;try{result=JSON.parse(stdout.trim());}catch{throw new Error('Media engine failed. Check Python dependencies.');}
 if(code||result.error||(!segment&&!result.ok))throw new Error(result.error||'Media processing failed');return result;
 }finally{fs.rmSync(file,{force:true});if(tempDirectory)fs.rmSync(tempDirectory,{recursive:true,force:true});}
}
async function withMediaTask(request,onProgress,options){while(mediaBusy)await new Promise(r=>setTimeout(r,100));mediaBusy=true;try{return await runMedia(request,onProgress,options);}finally{mediaBusy=false;scheduleQueue();}}
async function downloadProvider(url,target){const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||!['higgsfield.ai','higgsfield.app','higgsfield-cdn.com','cloudfront.net','amazonaws.com','storage.googleapis.com'].some(d=>parsed.hostname===d||parsed.hostname.endsWith('.'+d)))throw new Error('Unverified provider output host');const response=await fetch(parsed,{redirect:'error',signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('Candidate download failed');await saveDownload(response.body,target);}
const generationRunner=createGenerationRunner({db,save,adapter,runMedia:withMediaTask,mediaPath,mediaUrl,download:downloadProvider,budgetLimit:()=>Number(process.env.HIGGSFIELD_TEST_BUDGET_USD||0)});
const app=express();app.disable('x-powered-by');
if(process.env.LAB_TRUST_PROXY==='1')app.set('trust proxy',1);
const auth=createAuth({dataDir:DATA,origin:ORIGIN,mode:MODE==='authenticated-local'?'local':MODE,secureCookies:MODE==='saas'});
app.use((req,res,next)=>{
 const allowed=MODE==='local'||MODE==='authenticated-local'?['127.0.0.1','localhost']: [new URL(ORIGIN).hostname];
 let host;try{host=new URL('http://'+req.headers.host).hostname;}catch{return res.status(403).json({error:'Invalid host'});}
 if(!allowed.includes(host)&&!(req.path==='/api/health'&&['127.0.0.1','::1'].includes(req.socket.remoteAddress)))return res.status(403).json({error:'Unrecognized application host'});
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 if(MODE==='saas'){res.setHeader('Strict-Transport-Security','max-age=31536000');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");}
 next();
});
app.use(express.json({limit:'8mb'}));
app.get('/api/config',(req,res)=>res.json({mode:MODE,authRequired:AUTH_REQUIRED,inviteRequired:!!process.env.LAB_INVITE_CODE}));
app.use('/api/auth',auth.router);
app.get('/api/health',(req,res)=>res.json({ok:true,mode:MODE}));
const guard=AUTH_REQUIRED?auth.requireUser:(req,res,next)=>{req.user={id:'local-owner',email:null};next();};
app.use('/api',guard);app.use('/media',guard);
if(AUTH_REQUIRED)app.use('/api',auth.csrf);else app.use('/api',(req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&!['http://127.0.0.1:'+Number(process.env.PORT||8780),'http://localhost:'+Number(process.env.PORT||8780)].includes(req.headers.origin))return res.status(403).json({error:'Origin blocked'});next();});
app.use('/media',(req,res,next)=>{let name;try{name=decodeURIComponent(req.path.slice(1));}catch{return res.status(404).end();}if(!canReadMedia(db,name,req.user.id))return res.status(404).json({error:'Media not found'});next();},express.static(path.join(DATA,'media'),{dotfiles:'deny',setHeaders:res=>res.setHeader('Cache-Control','private, no-store')}));
registerAgentApi(app,{dataDir:DATA,mode:MODE});
registerRuntimeSettings(app,{ROOT:USER_ROOT,MODE,asyncRoute,probeHardware:async()=>{
 const python=process.env.SEGMENTATION_PYTHON||path.join(USER_ROOT,'.segmentation-env',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const child=spawn(python,[path.join(ROOT,'hardware_probe.py')],{cwd:ROOT,windowsHide:true});
 const {stdout,code}=await collectWorker(child,{timeoutMs:30000});
 if(code)throw Error('Could not check this computer. Check the object-selection runtime.');
 return JSON.parse(stdout);
}});
app.get('/api/models',(req,res)=>res.json(modelConnections(process.env)));
app.get('/agent-api.md',(req,res)=>res.type('text/plain').sendFile(path.join(ROOT,'AGENT_API.md')));
const maxStorage=Number(process.env.LAB_MAX_STORAGE_BYTES||10*1024**3);
if(!Number.isFinite(maxStorage)||maxStorage<200*1024**2)throw new Error('LAB_MAX_STORAGE_BYTES must be at least 200 MiB');
function storageAvailable(extra=0){const used=fs.readdirSync(path.join(DATA,'media')).reduce((sum,name)=>{const entry=fs.statSync(path.join(DATA,'media',name));return sum+(entry.isFile()?entry.size:0);},0);if(used+extra>maxStorage)throw new Error('Workspace storage limit reached. Ask the operator to archive unused media.');}
function candidateCapacity(projectId){if(Object.values(db.candidates).filter(c=>c.projectId===projectId).length+Object.values(db.jobs).filter(j=>j.projectId===projectId&&['queued','running'].includes(j.status)).length>=100)throw new Error('Project limit: 100 candidates. Start a new project or archive this one.');storageAvailable();}
const sourceUpload=multer({dest:path.join(DATA,'uploads'),limits:{fileSize:MAX_SOURCE_BYTES,files:1}});
const upload=multer({dest:path.join(DATA,'uploads'),limits:{fileSize:200*1024*1024,files:1}});

app.get('/api/capabilities',asyncRoute(async(req,res)=>{
 let capabilities={higgsfieldVideo:false,higgsfieldAudio:false,tracking:false,reasons:{video:'Provider adapter initializing.',audio:'Higgsfield audio contract is being verified.',tracking:'Automatic object tracking is not installed. Draw reviewed mask keyframes.'}};
 try{capabilities={...capabilities,...(await import('./providers.mjs')).capabilities()};}catch{}
 const segmentation=segmentationReady();
 res.json({...capabilities,autoBackground:autoBackgroundReady(USER_ROOT),segmentation,tracking:true,motionTracking:true,automaticReidentification:true,appearanceMatching:true,budget:{limit:Number(process.env.HIGGSFIELD_TEST_BUDGET_USD||0),perRequestEstimateLimit:5,...db.spend},mode:MODE});
}));
registerProjectDraftRoutes(app,{db,save,getProject:projectById});
registerGenerationLibrary(app,{db,asyncRoute});
app.get('/api/projects',(req,res)=>res.json(Object.values(db.projects).filter(p=>p.ownerId===req.user.id&&!p.deletedAt).map(publicProject)));
app.get('/api/projects/:id',asyncRoute(async(req,res)=>res.json(publicProject(projectById(req.params.id,req.user.id)))));
registerMarkerRoutes(app,{db,save,getProject:projectById,id});
registerCandidateLibraryRoutes(app,{db,save,getProject:projectById});
registerCandidateComparison(app,{db,getProject:projectById});
registerReviewNotes(app,{db,save,getProject:projectById});
registerBatches(app,{db,save,getProject:projectById,queue:queueGeneration,schedule:scheduleQueue,budgetLimit:()=>Number(process.env.HIGGSFIELD_TEST_BUDGET_USD||0)});
registerBrandPresets(app,{db,save,getProject:projectById,copyReference:(source,projectId)=>{if(Object.values(db.assets).filter(a=>a.projectId===projectId).length>=20)throw Error('Project asset limit reached.');storageAvailable(fs.statSync(source.path).size);const key=id(),target=mediaPath(key,'png');fs.copyFileSync(source.path,target);return {...source,id:key,projectId,path:target,url:mediaUrl(target),cleanup:()=>fs.rmSync(target,{force:true})};}});
registerCandidateReviewRoutes(app,{db,save,getProject:projectById});
registerPlaybackPreview(app,{db,save,getProject:projectById,runMedia:withMediaTask,mediaPath,mediaUrl,storageAvailable});
const importProject=createProjectImporter({db,save,runMedia,mediaPath,mediaUrl,storageAvailable,id,
 acquireMedia(){if(mediaBusy)throw Object.assign(new Error('Another media task is running. Try again shortly.'),{status:409});mediaBusy=true;},
 releaseMedia(){mediaBusy=false;scheduleQueue();}});
const originals=createOriginalService({db,save,adapter,storageAvailable,mediaPath,mediaUrl,runMedia:withMediaTask,download:downloadProvider,importProject,budgetLimit:()=>Number(process.env.HIGGSFIELD_TEST_BUDGET_USD||0),schedule:scheduleQueue});
registerOriginalRoutes(app,{service:originals,upload:multer({dest:path.join(DATA,'uploads'),limits:{fileSize:10*1024*1024,files:1}}),asyncRoute});
registerSampleProjectRoutes(app,{db,importProject,fixturePath:path.join(ROOT,'sample-source.mp4'),uploadDirectory:path.join(DATA,'uploads'),publicProject});
registerReferenceImages(app,{upload:multer({dest:path.join(DATA,'uploads'),limits:{fileSize:10*1024*1024,files:1}}),db,save,projectById,storageAvailable,id,mediaPath,mediaUrl,runMedia:withMediaTask,asyncRoute});
app.post('/api/projects',sourceUpload.single('file'),asyncRoute(async(req,res)=>{
 const project=await importProject(req.file,req.user.id);res.status(201).json(publicProject(project));
}));
app.post('/api/projects/:id/assets',upload.single('file'),asyncRoute(async(req,res)=>{
 if(!db.projects[req.params.id]||db.projects[req.params.id].ownerId!==req.user.id){if(req.file)fs.rmSync(req.file.path,{force:true});throw new Error('Project not found');}if(!req.file)throw new Error('Choose replacement audio or video.');
 try{storageAvailable(req.file.size);if(Object.values(db.assets).filter(a=>a.projectId===req.params.id).length>=20)throw new Error('Project limit: 20 replacement assets.');}catch(e){fs.rmSync(req.file.path,{force:true});throw e;}
 const ext=path.extname(req.file.originalname).toLowerCase();if(!['.mp4','.mov','.wav','.mp3','.m4a','.aac','.ogg','.webm'].includes(ext)){fs.rmSync(req.file.path,{force:true});throw new Error('Unsupported replacement format');}
 const key=id(),target=mediaPath(key,ext.slice(1));fs.renameSync(req.file.path,target);
 const asset={id:key,projectId:req.params.id,path:target,url:mediaUrl(target),name:req.file.originalname};db.assets[key]=asset;save();res.json({id:key,url:asset.url,name:asset.name});
}));
app.get('/api/jobs/:id',(req,res)=>{const job=db.jobs[req.params.id];if(!job||db.projects[job.projectId]?.ownerId!==req.user.id)return res.status(404).json({error:'Job not found'});res.json(publicJob(job));});
const localControllers=new Map();
let queueScheduled=false;
function scheduleQueue(){if(queueScheduled)return;queueScheduled=true;setTimeout(()=>{queueScheduled=false;void drainQueue();},100);}
async function drainQueue(){
 if(!providerBusy){const original=Object.values(db.originals||{}).find(d=>d.status==='queued');if(original){providerBusy=true;void originals.run(original).finally(()=>{providerBusy=false;scheduleQueue();});}}
 if(!providerBusy){const cloud=Object.values(db.jobs).find(j=>j.status==='queued'&&j.generation);if(cloud){providerBusy=true;cloud.status='running';save();void generationRunner.run(cloud).finally(()=>{providerBusy=false;scheduleQueue();});}}
 if(mediaBusy)return;const job=Object.values(db.jobs).find(j=>j.status==='queued'&&j.workRequest);if(!job)return;
 mediaBusy=true;job.status='running';delete job.progress;if(['segment','track'].includes(job.workRequest.kind))job.phase='Preparing video';if(job.workRequest.request.action==='object_repair')job.phase=OBJECT_REPAIR_PHASE;save();
 const controller=new AbortController();localControllers.set(job.id,controller);
 try{const result=await runMedia(job.workRequest.request,progress=>{if(controller.signal.aborted)return;if(typeof progress==='string')job.phase=progress;else {job.progress=progress;job.phase=progressPhase(progress.stage);}}, {signal:controller.signal});
  if(controller.signal.aborted)throw canceledError();
  if(['track','segment'].includes(job.workRequest.kind)){job.result={...result,baseRevisionId:job.workRequest.baseRevisionId};}
  else{const input=job.workRequest.request;const candidate={id:job.workRequest.candidateId,projectId:job.projectId,baseRevisionId:job.workRequest.baseRevisionId,url:mediaUrl(input.output),path:input.output,start:input.start,end:input.end,operation:input.operation,...(input.repairSourceCandidateId?{repairSourceCandidateId:input.repairSourceCandidateId,protectedAreas:input.protectedAreas,...(input.referenceImageId?{referenceImage:ownedReference(db,job.projectId,input.referenceImageId)}:{})}:{}),...(result.mediaMetadata?{mediaMetadata:result.mediaMetadata}:{}),...(result.sourceFrames?{sourceFrames:result.sourceFrames}:{}),...(result.localVerification?{localVerification:result.localVerification}:{}),...(result.transformationVerification?{transformationVerification:result.transformationVerification}:{}),...(result.backgroundVerification?{backgroundVerification:result.backgroundVerification}:{}),...(result.precisionVerification?{precisionVerification:result.precisionVerification}:{}),label:input.action==='background_replace'?'New background · original object kept':input.action==='transformation'?(input.mode==='scene'?'Scene replacement':input.mode==='foreground'?'Foreground transfer':'Object transformation'):input.action==='deterministic'?LOCAL_TOOLS[input.tool].title:input.action==='precision_recolor'?'Precision paint recolor':input.operation==='object'?'Object repair':input.operation==='picture'?'Picture repair':'Audio edit',createdAt:new Date().toISOString(),note:result.note,...(input.action==='object_repair'?{repairVerification:verifiedObjectRepair(result)}:{}),...(input.reviewOutput?{maskReviewUrl:mediaUrl(input.reviewOutput)}:{})};db.candidates[candidate.id]=candidate;const {path:_,...safe}=candidate;job.result=safe;}
  job.status='completed';job.phase='Ready to review';delete job.error;
 }catch(e){if(controller.signal.aborted||e.name==='AbortError'){job.status='canceled';job.phase='Canceled';delete job.error;delete job.result;}else{job.status='failed';job.error=e.message;}if(job.workRequest?.request?.output)fs.rmSync(job.workRequest.request.output,{force:true});}finally{localControllers.delete(job.id);mediaBusy=false;save();scheduleQueue();}
}
function queueLocal(p,workRequest,planId){
 if(workRequest.request?.action==='render'&&!workRequest.request.output.endsWith('.webm'))workRequest.request.output=mediaPath(id(),'webm');
 const duplicate=planId&&Object.values(db.jobs).find(j=>j.conversationPlanId===planId&&j.projectId===p.id);if(duplicate)return duplicate;
 const pending=Object.values(db.jobs).filter(j=>j.projectId===p.id&&['queued','running'].includes(j.status));if(pending.length>=3)throw Object.assign(new Error('Three edits are already pending for this project.'),{status:429});
 const job={id:id(),projectId:p.id,status:'queued',createdAt:new Date().toISOString(),workRequest,conversationPlanId:planId};db.jobs[job.id]=job;save();scheduleQueue();return job;
}
function enqueue(p,workRequest,res){res.status(202).json(publicJob(queueLocal(p,workRequest)));}
registerTransformationRoutes(app,{db,projectById,asyncRoute,enqueue,mediaPath,id,candidateCapacity});
app.get('/api/projects/:id/jobs',asyncRoute(async(req,res)=>{const p=projectById(req.params.id,req.user.id);res.json(Object.values(db.jobs).filter(j=>j.projectId===p.id).map(req.query.summary==='1'?publicJobSummary:publicJob).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));}));
app.get('/api/trash',(req,res)=>res.json(Object.values(db.projects).filter(p=>p.ownerId===req.user.id&&p.deletedAt).map(publicProject)));
app.post('/api/projects/:id/trash',asyncRoute(async(req,res)=>{const p=projectById(req.params.id,req.user.id);if(Object.values(db.jobs).some(j=>j.projectId===p.id&&['running','queued','unknown'].includes(j.status)))throw new Error('Finish or reconcile pending work before moving this project to trash.');p.deletedAt=new Date().toISOString();save();res.json({ok:true});}));
app.post('/api/projects/:id/restore',asyncRoute(async(req,res)=>{const p=projectById(req.params.id,req.user.id);delete p.deletedAt;save();res.json(publicProject(p));}));
app.post('/api/projects/:id/track',asyncRoute(async(req,res)=>{
 const p=projectById(req.params.id,req.user.id),range=validateEdit(p,{...req.body,operation:'mute'});
 const points=req.body.points;if(!Array.isArray(points)||points.length<3||points.length>64||points.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||n<0||n>1)))throw new Error('Draw a valid polygon first.');
 const source=p.revisions.find(r=>r.id===p.activeRevisionId).path;
 enqueue(p,{kind:'track',baseRevisionId:p.activeRevisionId,request:{action:req.body.appearances?'track_appearances':'track',source,start:range.start,end:range.end,referenceTime:req.body.appearances?req.body.time:undefined,points}},res);
}));
registerAutoBackground(app,{getProject:projectById,ready:()=>autoBackgroundReady(USER_ROOT),enqueue,asyncRoute});
app.post('/api/projects/:id/segment',asyncRoute(async(req,res)=>{
 const p=projectById(req.params.id,req.user.id);if(req.body.baseRevisionId!==p.activeRevisionId)throw new Error('Project revision changed');
 const points=req.body.points,clicks=req.body.clicks,holes=req.body.holes;
 if(holes!==undefined&&(!Array.isArray(holes)||holes.length>64||holes.some(h=>!Array.isArray(h)||h.length<3||h.length>500||h.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))))throw new Error('Invalid openings in object mask.');
 if(clicks!==undefined){if(!Array.isArray(clicks)||clicks.length<1||clicks.length>64||!clicks.some(c=>c?.label===1)||clicks.some(c=>!c||![0,1].includes(c.label)||!Array.isArray(c.point)||c.point.length!==2||c.point.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('Select an object with valid Include/Exclude points.');}
 else if(!Array.isArray(points)||points.length<3||points.length>256||points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('Click an object or draw its outline first.');
 if(!segmentationReady())return res.status(503).json({error:'SAM 2.1 model is not installed on this worker.'});
 const source=p.revisions.find(r=>r.id===p.activeRevisionId).path;const request={action:req.body.video?'segment_video':'segment',source,points,clicks,holes};
 if(req.body.video){const range=validateEdit(p,{...req.body,operation:'mute'});if(range.end-range.start>10)throw new Error('Boundary propagation currently supports a reviewed range up to 10 seconds.');request.start=range.start;request.end=range.end;if(!Number.isFinite(req.body.time)||req.body.time<range.start||req.body.time>=range.end)throw new Error('Choose a reference frame inside the range');request.time=req.body.time;}
 else{if(!Number.isFinite(req.body.time)||req.body.time<0||req.body.time>=p.duration)throw new Error('Select a frame inside the video');request.time=req.body.time;}
 enqueue(p,{kind:'segment',baseRevisionId:p.activeRevisionId,request},res);
}));
app.get('/api/projects/:id/candidates/:candidateId/repair',asyncRoute(async(req,res)=>{
 const p=projectById(req.params.id,req.user.id),g=repairSource(db,p,req.params.candidateId,fs.existsSync);
 res.json({start:g.start,end:g.end,scope:g.scope||'range',masks:g.masks||[],visibleRanges:g.visibleRanges||[],protectedAreas:db.candidates[req.params.candidateId].protectedAreas||[],baseRevisionId:p.activeRevisionId});
}));
app.post('/api/projects/:id/candidates/:candidateId/repair',asyncRoute(async(req,res)=>{
 const p=projectById(req.params.id,req.user.id);
 const g=repairSource(db,p,req.params.candidateId,fs.existsSync);
 const input=validateEdit(p,{...req.body,operation:'object',start:g.start,end:g.end});
 const protectedAreas=validateProtectedAreas(req.body.protectedAreas);
 if(!segmentationReady())throw new Error('Local SAM 2 is required to repair this candidate.');
 candidateCapacity(p.id);
 const request={action:'object_repair',operation:'object',start:input.start,end:input.end,scope:input.scope,masks:input.masks,visibleRanges:input.visibleRanges,protectedAreas,repairSourceCandidateId:g.candidateId,referenceImageId:g.referenceImageId,
 source:p.revisions.find(r=>r.id===p.activeRevisionId).path,candidate:g.paths.trimmed,output:mediaPath(id(),'webm'),reviewOutput:mediaPath(id(),'webm'),fps:30};
 enqueue(p,{kind:'render',baseRevisionId:p.activeRevisionId,candidateId:id(),request},res);
}));
app.post('/api/projects/:id/render',asyncRoute(async(req,res)=>{
 const p=projectById(req.params.id,req.user.id),input=validateEdit(p,req.body);if(input.operation==='background'&&req.body.reviewed!==true)throw new Error('Review the object and its openings before changing the background.');candidateCapacity(p.id);
 const asset=key=>{const a=db.assets[key]||db.candidates[key];if(!a||a.projectId!==p.id)throw new Error('Choose an asset from this project.');return a.path;};
 const source=p.revisions.find(r=>r.id===p.activeRevisionId).path;
 if(['object','background'].includes(input.operation)&&(!segmentationReady()||input.end-input.start>10))throw new Error('Automatic object repair requires local SAM 2 and a range up to 10 seconds.');
 const output=mediaPath(id(),input.operation==='background'?'mkv':'webm'),request={...input,action:input.operation==='background'?'background_replace':input.operation==='object'?'object_repair':'render',reviewOutput:input.operation==='object'?mediaPath(id(),'webm'):undefined,source,output,fps:30};
 if(input.operation==='replace_audio')request.audio=asset(input.audioId);
 if(['picture','object','background'].includes(input.operation))request.candidate=asset(input.candidateId);
 enqueue(p,{kind:'render',baseRevisionId:p.activeRevisionId,candidateId:id(),request},res);
}));
app.post('/api/jobs/:id/cancel',asyncRoute(async(req,res)=>{const job=db.jobs[req.params.id];if(!job||db.projects[job.projectId]?.ownerId!==req.user.id)return res.status(404).json({error:'Job not found'});if(job.status==='canceled'||job.phase==='Canceling')return res.json(publicJob(job));if(!cancellableLocal(job))return res.status(409).json({error:'Only queued local work or active object tracking can be canceled.'});if(job.status==='running'){const controller=localControllers.get(job.id);if(!controller)return res.status(409).json({error:'This worker cannot be canceled yet.'});job.phase='Canceling';controller.abort();}else {job.status='canceled';job.phase='Canceled';}save();res.json(publicJob(job));}));
app.post('/api/projects/:id/apply',asyncRoute(async(req,res)=>{
 const p=projectById(req.params.id,req.user.id),c=db.candidates[req.body.candidateId];if(!c||c.projectId!==p.id)throw new Error('Candidate not found');if(req.body.baseRevisionId!==p.activeRevisionId)throw new Error('Project revision changed');
 db.projects[p.id]=applyCandidate(p,c);save();res.json(publicProject(db.projects[p.id]));
}));
app.post('/api/projects/:id/undo',asyncRoute(async(req,res)=>{const p=projectById(req.params.id,req.user.id);db.projects[p.id]=undoProject(p);save();res.json(publicProject(db.projects[p.id]));}));
app.post('/api/jobs/:id/recover',asyncRoute(async(req,res)=>{
 const job=db.jobs[req.params.id];if(!job||db.projects[job.projectId]?.ownerId!==req.user.id)return res.status(404).json({error:'Job not found'});
 if(!recoverable(job))return res.status(409).json({error:'This job cannot be resumed safely. Reconcile any unknown acceptance first.'});
 job.status='queued';job.phase='Queued for safe recovery';save();scheduleQueue();res.status(202).json(publicJob(job));
}));
function queueGeneration(p,input,referenceImagePath,referenceImageId,{deferCommit=false}={}){
 if(['object','background'].includes(input.operation)&&(!segmentationReady()||input.end-input.start>10))throw new Error('Automatic object repair requires local SAM 2 and a range up to 10 seconds.');
 const duplicate=findDuplicate(db,p.id,input);if(duplicate)return duplicate;
 const operation=input.kind==='audio'?'replace_audio':['object','background'].includes(input.operation)?input.operation:'picture';
 const validated=validateEdit(p,{...input,operation:['object','background'].includes(operation)?operation:'mute'});
 if(!['video','audio'].includes(input.kind))throw new Error('Unsupported generation kind');
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>3000)throw new Error('Enter a prompt up to 3000 characters.');
 candidateCapacity(p.id);
 if(Object.values(db.jobs).some(j=>j.provider&&j.status==='unknown'&&!recoverable(j)))throw Object.assign(new Error('An earlier submission has unknown acceptance. Reconcile it before generating again.'),{status:409});
 if(Object.values(db.jobs).filter(j=>j.provider&&['queued','running'].includes(j.status)).length>=3)throw Object.assign(new Error('Three provider requests are pending. Wait for one to finish.'),{status:429});
 const window=computeGenerationWindow(p,validated.start,validated.end,input.resolution||'720p');
 const job={id:id(),projectId:p.id,status:'queued',provider:'higgsfield',createdAt:new Date().toISOString(),phase:'Queued',idempotencyKey:input.idempotencyKey,inputFingerprint:requestFingerprint(input),generation:{
  source:p.revisions.find(r=>r.id===p.activeRevisionId).path,baseRevisionId:p.activeRevisionId,start:validated.start,end:validated.end,...window,approvedEstimateUsd:input.approvedEstimateUsd,kind:input.kind,operation,prompt:input.prompt,referenceImagePath,referenceImageId,masks:['object','background'].includes(operation)?validated.masks:undefined,scope:['object','background'].includes(operation)?validated.scope:undefined,visibleRanges:['object','background'].includes(operation)?validated.visibleRanges:undefined
 }};db.jobs[job.id]=job;if(!deferCommit){save();scheduleQueue();}return job;
}
app.post('/api/projects/:id/generate',(req,res)=>{projectById(req.params.id,req.user.id);res.status(409).json({error:'Create and review a conversation plan before generation. Direct generation is disabled.'});});
const conversation=createConversationService({db,save,getProject:projectById,classify:classifyEdit,configured:()=>reasoningConfigured(process.env),execute:async(p,plan,input)=>{
 if(plan.route.id==='deterministic'){
  const tool=LOCAL_TOOLS[plan.tool];if(!tool)throw Error('Unsupported deterministic edit');
  const params=localParameters(plan.tool,plan.instruction);
  const edit=validateEdit(p,{baseRevisionId:plan.baseRevisionId,start:plan.start,end:plan.end,operation:tool.mask?'object':'mute',masks:input.masks,scope:input.scope,visibleRanges:input.visibleRanges});
  if(tool.mask&&!input.reviewed)throw Error('Review the tracked region first.');
  if(tool.corners&&input.masks.some(m=>m.points.length!==4))throw Error('Draw four ordered screen corners and track that polygon. SAM object outlines cannot define a screen plane.');
  let reference;if(tool.reference){if(!plan.referenceImage)throw Error('Attach the image to place.');ownedReference(db,p.id,plan.referenceImage.id);reference=db.assets[plan.referenceImage.id].path;}
  candidateCapacity(p.id);
  const active=p.revisions.find(r=>r.id===p.activeRevisionId);
  const request={...edit,action:'deterministic',tool:plan.tool,params,reference,splitTimes:active.mediaMetadata?.splitTimes||[],source:active.path,output:mediaPath(id(),'mkv')};
  return {job:publicJob(queueLocal(p,{kind:'render',baseRevisionId:p.activeRevisionId,candidateId:id(),request},plan.id))};
 }
 if(plan.operation==='recolor'&&plan.route.id==='precision-recolor'){
  if(!input.reviewed)throw Error('Review the tracked surface before recoloring.');
  const edit=validateEdit(p,{baseRevisionId:plan.baseRevisionId,start:plan.start,end:plan.end,operation:'object',masks:input.masks,scope:input.scope,visibleRanges:input.visibleRanges});candidateCapacity(p.id);
  const request={...edit,action:'precision_recolor',recolor:plan.recolor,source:p.revisions.find(r=>r.id===p.activeRevisionId).path,output:mediaPath(id(),'mkv')};
  return {job:publicJob(queueLocal(p,{kind:'render',baseRevisionId:p.activeRevisionId,candidateId:id(),request},plan.id))};
 }
 if(plan.route.kind==='higgsfield'){
  if(plan.route.estimatedUsd>5)throw new Error('Shorten the selected interval or request a new Draft plan.');
  if(!adapter.capabilities().higgsfieldVideo)throw new Error('Higgsfield credentials are not configured on the server.');
  if(['object','background'].includes(plan.action)&&!input.reviewed)throw new Error('Review the object boundary in the editor first.');
  const job=queueGeneration(p,{baseRevisionId:plan.baseRevisionId,start:plan.start,end:plan.end,kind:plan.generationKind,operation:plan.operation,prompt:plan.editInstruction??plan.instruction,resolution:plan.route.resolution,approvedEstimateUsd:plan.route.estimatedUsd,idempotencyKey:'conversation-'+plan.id,masks:input.masks,scope:input.scope,visibleRanges:input.visibleRanges},plan.referenceImage&&['picture','object'].includes(plan.operation)?(ownedReference(db,p.id,plan.referenceImage.id),db.assets[plan.referenceImage.id].path):undefined,plan.referenceImage&&['picture','object'].includes(plan.operation)?plan.referenceImage.id:undefined);return {job:publicJob(job)};
 }
 if(['mute','gain','replace_audio','replace_picture'].includes(plan.action)){
  if(!plan.operation)throw new Error('Specify the missing edit parameter in a new message.');
  const edit=validateEdit(p,{baseRevisionId:plan.baseRevisionId,start:plan.start,end:plan.end,operation:plan.operation,gainDb:plan.gainDb});candidateCapacity(p.id);
  const request={...edit,action:'render',source:p.revisions.find(r=>r.id===p.activeRevisionId).path,output:mediaPath(id()),fps:30};
  if(['replace_audio','replace_picture'].includes(plan.action)){const key=plan.action==='replace_audio'?input.audioId:input.candidateId;const asset=db.assets[key]||db.candidates[key];if(!asset||asset.projectId!==p.id)throw new Error('Choose a replacement from this project first.');request[plan.action==='replace_audio'?'audio':'candidate']=asset.path;}
  return {job:publicJob(queueLocal(p,{kind:'render',baseRevisionId:p.activeRevisionId,candidateId:id(),request},plan.id))};
 }
 if(plan.action==='apply'){
  const candidate=db.candidates[input.candidateId];if(!candidate||candidate.projectId!==p.id)throw new Error('Choose a candidate to review first.');db.projects[p.id]=applyCandidate(p,candidate);return {project:publicProject(db.projects[p.id])};
 }
 if(plan.action==='undo'){db.projects[p.id]=undoProject(p);return {project:publicProject(db.projects[p.id])};}
 if(plan.route.kind==='ui'){if(['fix_outline','protect_area'].includes(plan.uiAction))repairSource(db,p,plan.targetCandidateId,fs.existsSync);return {uiAction:plan.uiAction};}
 throw new Error('This plan needs more input before it can run.');
}});
app.get('/api/projects/:id/conversation',asyncRoute(async(req,res)=>res.json(conversation.snapshot(req.params.id,req.user.id))));
app.post('/api/projects/:id/conversation',asyncRoute(async(req,res)=>res.json(await conversation.message(req.params.id,req.user.id,req.body))));
app.post('/api/projects/:id/conversation/plans/:planId/execute',asyncRoute(async(req,res)=>{const result=await conversation.execute(req.params.id,req.user.id,req.params.planId,req.body);if(result.project)result.project=publicProject(projectById(req.params.id,req.user.id));res.json(result);}));
if(fs.existsSync(path.join(ROOT,'dist/index.html'))){app.use(express.static(path.join(ROOT,'dist')));app.get('/{*path}',(req,res)=>res.sendFile(path.join(ROOT,'dist/index.html')));}else{const {createServer}=await import('vite');const vite=await createServer({root:ROOT,server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
app.use((err,req,res,next)=>{res.status(err.status||400).json({error:err.message||'Request failed'});});
const port=Number(process.env.PORT||8780);const server=app.listen(port,process.env.HOST||(MODE==='saas'?'0.0.0.0':'127.0.0.1'),()=>console.log('Video Gen Lab: http://127.0.0.1:'+port));

scheduleQueue();

// Long source uploads may take more than Node's default five-minute window.
server.requestTimeout=2*60*60*1000;
