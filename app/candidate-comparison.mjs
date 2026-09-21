export function candidateComparison(db,getProject,projectId,owner,candidateId){
 const project=getProject(projectId,owner),candidate=db.candidates[candidateId];
 if(!candidate||candidate.projectId!==project.id)throw Object.assign(Error('Candidate not found'),{status:404});
 const base=project.revisions.find(r=>r.id===candidate.baseRevisionId);
 if(!base?.url||!candidate.url)throw Error('The original revision for this comparison is unavailable.');
 return {projectName:project.name,candidateName:candidate.name||candidate.label||'Candidate',originalUrl:base.url,candidateUrl:candidate.url,baseRevisionId:base.id,duration:candidate.mediaMetadata?.duration||base.mediaMetadata?.duration||project.duration,mediaMetadata:candidate.mediaMetadata,sourceFrames:candidate.sourceFrames,localVerification:candidate.localVerification,transformationVerification:candidate.transformationVerification,precisionVerification:candidate.precisionVerification,referenceImage:candidate.referenceImage,repairVerification:candidate.repairVerification,note:candidate.note};
}
export function registerCandidateComparison(app,{db,getProject}){app.get('/api/projects/:id/candidates/:candidateId/comparison',(req,res,next)=>{try{res.json(candidateComparison(db,getProject,req.params.id,req.user.id,req.params.candidateId))}catch(e){next(e)}});}
