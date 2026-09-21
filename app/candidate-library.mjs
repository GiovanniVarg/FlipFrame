export function createCandidateLibrary({db,save,getProject}){
 function list(projectId,owner){
  const p=getProject(projectId,owner);
  return Object.values(db.candidates).filter(c=>c.projectId===p.id).map(c=>{
   const job=Object.values(db.jobs).find(j=>j.projectId===p.id&&j.result?.id===c.id),context=job?.generation||job?.workRequest?.request;
   return {id:c.id,projectId:c.projectId,baseRevisionId:c.baseRevisionId,url:c.url,label:c.label,name:c.name||'',favorite:c.favorite===true,createdAt:c.createdAt,dismissedAt:c.dismissedAt,maskReviewUrl:c.maskReviewUrl,note:c.note,mediaMetadata:c.mediaMetadata,sourceFrames:c.sourceFrames,localVerification:c.localVerification,transformationVerification:c.transformationVerification,repairVerification:c.repairVerification,precisionVerification:c.precisionVerification,referenceImage:c.referenceImage,start:c.start??context?.start,end:c.end??context?.end,canCompare:c.baseRevisionId===p.activeRevisionId,canApply:c.baseRevisionId===p.activeRevisionId&&!p.revisions.some(r=>r.id===c.id)};
  }).sort((a,b)=>Number(b.favorite)-Number(a.favorite)||String(b.createdAt||'').localeCompare(String(a.createdAt||''))||a.id.localeCompare(b.id));
 }
 function update(projectId,owner,candidateId,input){
  getProject(projectId,owner);const old=db.candidates[candidateId];
  if(!old||old.projectId!==projectId)throw Object.assign(Error('Candidate not found'),{status:404});
  if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['name','favorite'].includes(k)))throw Error('Choose a name or favorite setting.');
  if(input.name!==undefined&&(typeof input.name!=='string'||input.name.trim().length>80||/[\x00-\x1f]/.test(input.name)))throw Error('Use a name up to 80 characters.');
  if(input.favorite!==undefined&&typeof input.favorite!=='boolean')throw Error('Favorite must be true or false.');
  const changes={...(input.name!==undefined?{name:input.name.trim()}:{}),...(input.favorite!==undefined?{favorite:input.favorite}:{})};
  const jobs=Object.values(db.jobs).filter(j=>j.projectId===projectId&&j.result?.id===candidateId),previous=jobs.map(j=>j.result);
  db.candidates[candidateId]={...old,...changes};jobs.forEach(j=>j.result={...j.result,...changes});
  try{save();}catch(error){db.candidates[candidateId]=old;jobs.forEach((j,i)=>j.result=previous[i]);throw error;}
  return list(projectId,owner).find(c=>c.id===candidateId);
 }
 return {list,update};
}
export function registerCandidateLibraryRoutes(app,deps){
 const library=createCandidateLibrary(deps);
 app.get('/api/projects/:id/candidates',(req,res,next)=>{try{res.json(library.list(req.params.id,req.user.id));}catch(e){next(e);}});
 app.post('/api/projects/:id/candidates/:candidateId/details',(req,res,next)=>{try{res.json(library.update(req.params.id,req.user.id,req.params.candidateId,req.body));}catch(e){next(e);}});
}
