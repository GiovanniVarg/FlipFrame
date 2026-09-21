export function createCandidateReviewService({db,save,getProject,now=()=>new Date().toISOString()}) {
 return function review(projectId,owner,candidateId,input) {
  getProject(projectId,owner);
  const candidate=db.candidates[candidateId];
  if(!candidate||candidate.projectId!==projectId)throw Object.assign(new Error('Candidate not found'),{status:404});
  if(!input||typeof input.dismissed!=='boolean')throw new Error('dismissed must be a boolean.');
  const dismissedAt=input.dismissed?(candidate.dismissedAt||now()):null;
  candidate.dismissedAt=dismissedAt;
  for(const job of Object.values(db.jobs)) {
   if(job.projectId===projectId&&job.result?.id===candidateId)job.result.dismissedAt=dismissedAt;
  }
  save();
  return {id:candidateId,projectId,dismissedAt};
 };
}

export function registerCandidateReviewRoutes(app,deps) {
 const review=createCandidateReviewService(deps);
 app.post('/api/projects/:id/candidates/:candidateId/review',(req,res,next)=>{
  try{res.json(review(req.params.id,req.user.id,req.params.candidateId,req.body));}catch(error){next(error);}
 });
}
