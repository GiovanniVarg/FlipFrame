import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const MAX_SOURCE_BYTES=2*1024**3;
export const MAX_SOURCE_SECONDS=60*60;

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const SAMPLE_PROVENANCE=Object.freeze({kind:'synthetic-practice',version:1,label:'Coastal Drift · practice clip',description:'An original deterministic illustration with a moving balloon and quiet tone, created locally for practicing edits. Not a Higgsfield generation or evidence of model quality.'});

// Both uploaded and bundled sources pass exactly the same admission, probing,
// normalization, analysis, ownership and durable project creation path.
export function createProjectImporter({db,save,runMedia,mediaPath,mediaUrl,storageAvailable,acquireMedia,releaseMedia,id=randomUUID}){
 return async function importProject(file,ownerId,extra={}){
  if(!file)throw fail('Choose a video file.');let acquired=false,key,source,normalized,thumbnail,project;
  try{
   if(Object.values(db.projects).filter(p=>p.ownerId===ownerId).length>=20)throw fail('Workspace limit: 20 projects including trash. Ask the operator to archive unused projects.',429);
   if(!Number.isFinite(file.size)||file.size<=0||file.size>MAX_SOURCE_BYTES)throw fail('Choose a nonempty video up to 2 GiB.');
   acquireMedia();acquired=true;key=id();source=mediaPath(key+'-original',path.extname(file.originalname).toLowerCase()==='.mov'?'mov':'mp4');normalized=mediaPath(key);thumbnail=mediaPath(key+'-strip','jpg');
   storageAvailable(file.size);
   const info=await runMedia({action:'probe',source:file.path});
   if(!Number.isFinite(info.duration)||info.duration<=0||info.duration>MAX_SOURCE_SECONDS||info.width>1920||info.height>1920||info.width*info.height>1920*1080)throw fail('Choose a video up to 60 minutes long and 1080p.');
   fs.renameSync(file.path,source);
   const meta=await runMedia({action:'normalize',source,output:normalized,fps:30});
   let analysis={};try{const data=await runMedia({action:'analyze',source:normalized,output:thumbnail});analysis={thumbnailUrl:mediaUrl(thumbnail),waveform:data.peaks};}catch{fs.rmSync(thumbnail,{force:true});}
   const revision={id:id(),url:mediaUrl(normalized),path:normalized,label:'Original working master',createdAt:new Date().toISOString()};
   project={...extra,...analysis,ownerId,id:key,name:file.originalname.replace(/\.[^.]+$/,''),sourceUrl:mediaUrl(normalized),sourcePath:source,duration:meta.duration,width:meta.width,height:meta.height,fps:30,revisions:[revision],activeRevisionId:revision.id};
   db.projects[key]=project;save();return project;
  }catch(error){if(key&&db.projects[key]===project)delete db.projects[key];for(const target of [file.path,source,normalized,thumbnail])if(target)fs.rmSync(target,{force:true});throw error;}
  finally{if(acquired)releaseMedia();}
 };
}

export function createSampleProjectService({db,importProject,fixturePath,uploadDirectory}){
 const pending=new Map();
 return async function create(ownerId,input={}){
  if(!ownerId)throw fail('Sign in to create a sample project.',401);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='idempotencyKey'))throw fail('Only an optional idempotencyKey is accepted.');
  const requestKey=input.idempotencyKey??'default';
  if(requestKey!=='default'&&(typeof requestKey!=='string'||!/^[-\w]{8,128}$/.test(requestKey)))throw fail('A valid sample request key is required.');
  const existing=Object.values(db.projects).find(p=>p.ownerId===ownerId&&!p.deletedAt&&p.sample?.version===SAMPLE_PROVENANCE.version&&p.sampleRequestKey===requestKey);
  if(existing)return existing;
  const key=JSON.stringify([ownerId,requestKey]);if(pending.has(key))return pending.get(key);
  const task=(async()=>{
   const temp=path.join(uploadDirectory,randomUUID()+'.mp4');
   try{fs.copyFileSync(fixturePath,temp,fs.constants.COPYFILE_EXCL);return await importProject({path:temp,originalname:'Coastal Drift - practice clip.mp4',size:fs.statSync(temp).size},ownerId,{sample:{...SAMPLE_PROVENANCE},sampleRequestKey:requestKey});}
   catch(error){fs.rmSync(temp,{force:true});throw error;}
  })();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
 };
}
export function registerSampleProjectRoutes(app,{publicProject,...dependencies}){
 const create=createSampleProjectService(dependencies);
 app.post('/api/projects/example',(req,res,next)=>{create(req.user?.id,req.body??{}).then(project=>res.status(201).json(publicProject(project))).catch(next);});
 return create;
}
