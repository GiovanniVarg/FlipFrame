export function validateProtectedAreas(areas=[]){
 if(!Array.isArray(areas)||areas.length>20||areas.some(p=>!Array.isArray(p)||p.length<3||p.length>64||p.some(v=>!Array.isArray(v)||v.length!==2||v.some(n=>!Number.isFinite(n)||n<0||n>1))))throw new Error('Keep-unchanged areas must be up to 20 polygons inside the video.');
 for(const polygon of areas){const twiceArea=polygon.reduce((sum,p,i)=>{const next=polygon[(i+1)%polygon.length];return sum+p[0]*next[1]-next[0]*p[1];},0);if(Math.abs(twiceArea)<.00002)throw new Error('Draw a keep-unchanged area with a visible interior, not a line.');}
 return areas;
}
export function repairSource(db,project,candidateId,exists){
 const candidate=db.candidates[candidateId];
 if(!candidate||candidate.projectId!==project.id||candidate.baseRevisionId!==project.activeRevisionId)throw new Error('Choose an object candidate from the current project revision.');
 const original=candidate.repairSourceCandidateId||candidate.id;
 const g=Object.values(db.jobs).find(j=>j.projectId===project.id&&j.status==='completed'&&j.generation?.candidateId===original)?.generation;
 if(!g||g.operation!=='object'||g.baseRevisionId!==project.activeRevisionId)throw new Error('This candidate has no reusable object generation.');
 if(!g.paths?.trimmed||!exists(g.paths.trimmed))throw new Error('The retained generation is unavailable. No new generation was submitted.');
 return g;
}
