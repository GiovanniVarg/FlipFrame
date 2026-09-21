export function jobGuidance(job={}) {
 const local=['render','track','segment'].includes(job.type);
 const mode=job.recoveryMode;
 const cost=local?'This step runs locally; it does not submit a paid generation.':mode==='check'?'An existing provider request may already be billable. Recovery checks that request without submitting it again.':mode==='prepare'?'No generation was accepted. Retrying preparation may submit the reviewed paid generation within your budget.':'Provider billing is not confirmed here. Check Activity before starting another generation.';
 if(['failed','unknown'].includes(job.status)) return {title:job.status==='unknown'?'Checking the outcome is needed':'This edit needs attention',detail:cost,action:mode==='check'?'Check existing request':mode==='prepare'?'Retry preparation':'View activity'};
 if(job.status==='queued')return {title:'Waiting to start',detail:local?cost:'Your request is queued. No reliable finish time is available yet.',action:'View activity'};
 if(job.status==='completed')return {title:'Ready to review',detail:'Watch the candidate before applying it. Your current revision has not been changed by this job.',action:'Review candidate'};
 return {title:local?'Processing on this computer':'Preparing or processing your edit',detail:local?cost:'Preparation, generation and download can take time. You can check Activity; starting again may create another paid request.',action:'View activity'};
}
