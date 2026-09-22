import {createHash} from 'node:crypto';
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>k!=='idempotencyKey').map(k=>[k,canonical(value[k])]));return value;}
export const requestFingerprint=input=>createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
export function findDuplicate(db,projectId,input){const key=input.idempotencyKey;if(key===undefined)return undefined;if(typeof key!=='string'||! /^[a-zA-Z0-9_-]{8,128}$/.test(key))throw new Error('Invalid idempotency key');const job=Object.values(db.jobs).find(j=>j.projectId===projectId&&j.idempotencyKey===key);if(job&&job.inputFingerprint!==requestFingerprint(input))throw new Error('This request key was already used for different inputs.');return job;}
export function recoverable(job){if(job.failureCode==='OUTPUT_TOO_SHORT')return false;if(!['failed','unknown'].includes(job.status)||!job.generation)return false;const p=job.providerState||job.generation.providerState;if(p?.requestId&&(['queued','in_progress','running','completed'].includes(p.status)||p.status==='unknown'&&!!p.statusUrl))return true;return Boolean(job.retryable&&!p&&job.generation.submission!=='attempting');}
function confirmedCharge(job){const r=job.reconciliation;if(!r||!Number.isFinite(r.actualUsd)||r.actualUsd<0||!['completed','failed','nsfw','canceled','not-submitted'].includes(r.outcome))return undefined;return {actualUsd:r.actualUsd,outcome:r.outcome,confirmedAt:r.at};}
export function publicJob(job){const context=job.generation||job.workRequest?.request;const result=job.result?{...job.result,...(job.result.id&&context?{start:context.start,end:context.end,operation:context.operation}:{}),path:undefined}:undefined;return {id:job.id,projectId:job.projectId,status:job.status,phase:job.phase,progress:job.progress,error:job.error,createdAt:job.createdAt,provider:job.provider,kind:job.generation?.kind,type:job.workRequest?.kind||'generation',baseRevisionId:job.workRequest?.baseRevisionId||job.generation?.baseRevisionId,result,quote:job.quote,confirmedCharge:confirmedCharge(job),billing:job.billing,recoverable:recoverable(job),recoveryMode:recoverable(job)?((job.providerState||job.generation?.providerState)?.requestId?'check':'prepare'):undefined};}

// Polling lists need job state, not megabytes of per-frame selection geometry.
// Single-job reads retain the complete immutable result for selection watchers.
export function publicJobSummary(job){
 const value=publicJob(job);
 if(!['segment','track'].includes(job.workRequest?.kind)||!value.result)return value;
 const {masks,points,holes,...result}=value.result;
 return {...value,result:{...result,geometryOmitted:true,...(Array.isArray(masks)?{maskCount:masks.length}:{})}};
}
