import {LOCAL_TOOLS} from './local-tools.mjs';
// Auto-preview is intentionally narrower than the editor's available actions.
export function canAutoPreview(plan,{revisionId,hasCandidate=false,hasMask=false,hasReference=false}={}){
 if(!plan||plan.status!=='ready'||plan.baseRevisionId!==revisionId||hasCandidate||hasMask||hasReference)return false;
 if(plan.route?.kind!=='local'||plan.route.estimatedUsd!==0||plan.requiresMask||plan.requiresReference||plan.referenceImage||plan.selectedObjectName||plan.uiAction||plan.jobId||plan.candidateId||plan.targetCandidateId)return false;
 if(!Number.isFinite(plan.start)||!Number.isFinite(plan.end)||plan.start<0||plan.end<=plan.start)return false;
 if(plan.action==='mute'||plan.action==='gain')return plan.route.id==='local-editor'&&!plan.tool;
 const tool=Object.hasOwn(LOCAL_TOOLS,plan.action)?LOCAL_TOOLS[plan.action]:null;
 return Boolean(tool&&!tool.mask&&!tool.reference&&plan.action!=='split'&&plan.tool===plan.action&&plan.route.id==='deterministic');
}
