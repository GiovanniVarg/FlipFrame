import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
// Derived viewing copies are separate from immutable candidates and exports.
export function createPlaybackPreviewService({db,save,getProject,runMedia,mediaPath,mediaUrl,storageAvailable=()=>{}}){
 db.playbackPreviews??={};const active=new Map();let tail=Promise.resolve();
 const owned=(projectId,owner,candidateId)=>{getProject(projectId,owner);const c=db.candidates[candidateId];if(!c||c.projectId!==projectId)throw Object.assign(Error('Candidate not found'),{status:404});return c;};
 const signature=c=>{try{const s=fs.statSync(c.path);return JSON.stringify([c.path,s.size,s.mtimeMs]);}catch{throw Object.assign(Error('The original candidate is unavailable.'),{status:404});}};
 const publicState=record=>record?.status==='ready'?{status:'ready',url:record.url}:record?.status==='error'?{status:'error',error:'The viewing copy could not be prepared. Try again; your original is unchanged.'}:{status:record?.status==='preparing'?'preparing':'not_started'};
 function status(projectId,owner,candidateId){const c=owned(projectId,owner,candidateId),record=db.playbackPreviews[candidateId];if(!record||record.signature!==signature(c))return {status:'not_started'};if(record.status==='ready'&&!fs.existsSync(record.path))return {status:'not_started'};if(record.status==='preparing'&&!active.has(candidateId))return {status:'error',error:'Preparation was interrupted. Try again.'};return publicState(record);}
 function prepare(projectId,owner,candidateId){
  const c=owned(projectId,owner,candidateId),current=status(projectId,owner,candidateId);
  if(current.status==='ready'||active.has(candidateId))return current.status==='ready'?current:{status:'preparing'};
  if(active.size>=10)throw Object.assign(Error('Viewing copies are busy. Try again shortly.'),{status:429});
  storageAvailable();const record={projectId,candidateId,signature:signature(c),status:'preparing',path:mediaPath(randomUUID(),'mp4')};db.playbackPreviews[candidateId]=record;save();
  const task=tail.then(async()=>{
   try{storageAvailable();const result=await runMedia({action:'playback_preview',source:c.path,output:record.path});if(!result?.ok||!fs.existsSync(record.path))throw Error('No viewing copy');
    if(signature(c)!==record.signature)throw Error('Candidate changed');record.status='ready';record.url=mediaUrl(record.path);save();
   }catch{record.status='error';delete record.url;fs.rmSync(record.path,{force:true});save();}
  }).finally(()=>active.delete(candidateId));
  active.set(candidateId,task);tail=task.catch(()=>{});return {status:'preparing'};
 }
 return {status,prepare,settled:()=>tail};
}
export function registerPlaybackPreview(app,deps){const service=createPlaybackPreviewService(deps);const route='/api/projects/:id/candidates/:candidateId/playback-preview';
 for(const method of ['get','post'])app[method](route,(req,res,next)=>{try{res.setHeader('Cache-Control','no-store');const result=service[method==='post'?'prepare':'status'](req.params.id,req.user.id,req.params.candidateId);res.status(result.status==='preparing'?202:200).json(result);}catch(error){if([404,429].includes(error.status))return res.status(error.status).json({error:error.message});res.status(500).json({error:'Could not prepare the viewing copy. Your original is unchanged.'});}});
 return service;
}
