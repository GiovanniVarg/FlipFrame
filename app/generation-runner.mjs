import {releaseProviderFailure} from './provider-refunds.mjs';
import {ownedReference} from './reference-images.mjs';
import {OBJECT_REPAIR_PHASE,verifiedObjectRepair} from './object-repair-contract.mjs';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {reserve} from './budget.mjs';

const rejectedStatuses=new Set(['failed','nsfw','canceled']);
const acceptedStatuses=new Set(['queued','in_progress','running']);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const GENERATION_QUOTE_LIFETIME_MS=5*60*1000;

/** Durable provider lifecycle. Callers must persist job.generation before scheduling run(). */
export function createGenerationRunner({db,save,adapter,runMedia,mediaPath,mediaUrl,download,budgetLimit,pollDelay=5000,pollAttempts=180,now=Date.now}){
 const active=new Map();
 const persist=async()=>{await save();};
 async function execute(job){
  const g=job.generation;
  if(g&&g.kind!=='audio'&&g.masks?.length)g.operation='object';
  if(!g)throw new Error('Persisted generation context is required');
  if(job.status==='canceled'||job.status==='completed'&&job.result)return job;
  try{
   if(!['video','audio'].includes(g.kind)||typeof g.prompt!=='string'||!g.prompt.trim()||typeof g.source!=='string')throw new Error('Invalid persisted generation inputs');
   if(![g.processStart,g.processEnd,g.start,g.end].every(Number.isFinite)||g.processStart<0||g.start<g.processStart||g.end<=g.start||g.processEnd<g.end||g.processEnd<=g.processStart)throw new Error('Invalid persisted generation interval');
   if(g.operation==='object'&&g.end-g.start>10)throw new Error('Automatic object repair supports up to 10 seconds. Shorten the selection before generating.');
   // Stable identities and complete inputs are saved before any external operation.
   g.paths??={clip:mediaPath(randomUUID()),raw:mediaPath(randomUUID()),trimmed:mediaPath(randomUUID()),output:mediaPath(randomUUID(),'webm')};
   g.candidateId??=randomUUID();
   job.status='running';job.retryable=false;delete job.error;
   await persist();
   let provider=g.providerState||job.providerState;
   if(provider){g.providerState=provider;job.providerState=provider;}
   if(!provider&&g.submission==='attempting'){
    job.status='unknown';job.phase='Acceptance requires reconciliation';job.error='The submission response was not durably recorded. Do not resubmit; reconcile provider request history.';
    await persist();return job;
   }
   if(!provider){
    if(g.processEnd-g.processStart<4-1e-6||g.processEnd-g.processStart>30+1e-6)throw new Error('This old plan has incompatible source duration. Create a new generation plan to prepare 4–30 seconds of context.');
    if(g.preparationVersion!==3){g.extracted=false;delete g.videoUrl;}
    if(!g.videoUrl){
     if(!g.extracted||!fs.existsSync(g.paths.clip)){
      job.phase='Preparing source';await persist();
      await runMedia({action:'extract',source:g.source,output:g.paths.clip,start:g.processStart,end:g.processEnd,providerResolution:g.resolution||'720p',tailPadding:g.tailPadding||0});
      g.extracted=true;g.preparationVersion=3;await persist();
     }
     job.phase='Uploading selected clip';await persist();
     g.videoUrl=await adapter.uploadAsset(fs.readFileSync(g.paths.clip),'video/mp4');await persist();
    }
    if(g.operation==='object'&&!g.objectReferenceUrl){
     const mask=g.masks?.find(m=>m.time>=g.start&&m.time<g.end);
     if(!mask)throw new Error('Reviewed object masks are required to prepare visual guidance.');
     g.paths.reference??=mediaPath(randomUUID())+'.png';
     job.phase='Preparing object reference';await persist();
     await runMedia({action:'object_reference',source:g.source,output:g.paths.reference,time:mask.time,points:mask.points});
     g.objectReferenceUrl=await adapter.uploadAsset(fs.readFileSync(g.paths.reference),'image/png');await persist();
    }
    if(g.referenceImagePath&&!g.userReferenceUrl){
     g.paths.userReference??=mediaPath(randomUUID())+'.png';
     job.phase='Preparing attached reference';await persist();
     await runMedia({action:'prepare_reference',source:g.referenceImagePath,guide:g.operation==='object'?g.paths.reference:undefined,output:g.paths.userReference});
     g.userReferenceUrl=await adapter.uploadAsset(fs.readFileSync(g.paths.userReference),'image/png');await persist();
    }
    const objectGuidance=g.referenceImagePath?(g.operation==='object'?' The reference is a labeled two-panel guide: LEFT shows the source selection with darkened surroundings; RIGHT shows the desired appearance supplied by the user. Use the right panel to guide the selected replacement only. Do not reproduce labels, the panel layout or darkening. Preserve unrelated objects and camera timing.':' Use the supplied reference image as the desired visual guidance for this edit. Preserve unrelated content and timing.'):g.operation==='object'?' The reference image identifies the selected object: its surroundings are darkened only as a selection guide. Edit that object consistently wherever it is visible. Do not reproduce the darkening. Preserve camera motion, timing, and unrelated objects.':'';
    const prompt=`Edit the supplied extracted clip. Input clip time 0 equals project time ${g.processStart.toFixed(6)} seconds. The selected interval on THIS CLIP is ${(g.start-g.processStart).toFixed(6)} to ${(g.end-g.processStart).toFixed(6)} seconds. Preserve timing and duration. Any original project timestamps in the edit request refer to the original project, not this cropped clip; the clip-relative interval above is authoritative. Apply the requested change within that interval. Keep surrounding context consistent.\nEdit request: ${g.prompt}${objectGuidance}`;
    const input={kind:g.kind,prompt,videoUrl:g.videoUrl,...((g.userReferenceUrl||g.objectReferenceUrl)?{imageUrls:[g.userReferenceUrl||g.objectReferenceUrl]}:{}),generateAudio:g.kind==='audio',pricingDimensions:g.pricingDimensions,resolution:g.resolution};
    // Refresh on every unsent attempt, including recovery. Persisted quotes are
    // evidence, not permission to submit later at an old price. Accepted and
    // ambiguous requests never enter this branch.
    job.phase='Estimating cost';await persist();
    const quoteRequestedAt=now();
    g.quote=await adapter.estimateGeneration(input);g.quoteRequestedAt=quoteRequestedAt;await persist();
    if(g.approvedEstimateUsd!==undefined&&(!Number.isFinite(g.approvedEstimateUsd)||g.approvedEstimateUsd<=0||g.quote.estimatedUsd>g.approvedEstimateUsd+1e-8))throw new Error('The fresh provider estimate exceeds the approved plan. Request and review a new plan before generation.');
    const quoteIsFresh=()=>{const current=now();return Number.isFinite(current)&&current>=quoteRequestedAt&&current-quoteRequestedAt<GENERATION_QUOTE_LIFETIME_MS;};
    if(!quoteIsFresh())throw new Error('Provider estimate expired before submission. Resume preparation to check a fresh estimate.');
    const limit=typeof budgetLimit==='function'?budgetLimit():budgetLimit;
    // Replace a previous unsent hold atomically; never double-reserve or keep
    // an undersized hold after a recovered request receives a changed price.
    const priorHold=g.reserved&&!g.reservationReleased?g.reservedUsd:0;
    if(!Number.isFinite(priorHold)||priorHold<0||priorHold>db.spend.reserved+1e-8)throw new Error('Invalid unsent generation reservation');
    const ledgerWithoutHold={...db.spend,reserved:Math.max(0,db.spend.reserved-priorHold)};
    db.spend=reserve(ledgerWithoutHold,Number(limit),g.quote.estimatedUsd);
    g.reserved=true;g.reservationReleased=false;g.reservedUsd=Math.ceil(g.quote.estimatedUsd*2*1e6)/1e6;
    job.quote={estimatedUsd:g.quote.estimatedUsd,reservedUsd:g.reservedUsd};await persist();
    if(!quoteIsFresh())throw new Error('Provider estimate expired before submission. Resume preparation to check a fresh estimate.');
    // This durable marker deliberately favors no double charge over automatic progress.
    g.submission='attempting';g.submissionInput=input;job.phase='Submitting once';await persist();
    try{provider=await adapter.submitGeneration(input);}catch(error){provider={status:'unknown',error:'Submission response lost: '+error.message};}
    g.providerState=provider;job.providerState=provider;g.submission='responded';await persist();
   }
   if(provider.status==='unknown'&&provider.requestId&&provider.statusUrl){
    job.phase='Recovering known provider request';await persist();
    provider=await adapter.pollGeneration(provider);
    g.providerState=provider;job.providerState=provider;await persist();
   }
   if(provider.status==='unknown'){
    job.status='unknown';job.phase='Acceptance requires reconciliation';job.error=provider.error||'Provider acceptance is unknown. No automatic resubmission.';
    await persist();return job;
   }
   if(!rejectedStatuses.has(provider.status)&&provider.status!=='completed'){
    if(!acceptedStatuses.has(provider.status))throw new Error('Unrecognized persisted provider status');
    for(let attempt=0;attempt<pollAttempts&&acceptedStatuses.has(provider.status);attempt++){
     job.phase='Higgsfield '+provider.status;await persist();
     if(pollDelay>0)await delay(pollDelay);
     provider=await adapter.pollGeneration(provider);
     g.providerState=provider;job.providerState=provider;await persist();
    }
   }
   if(rejectedStatuses.has(provider.status)){
    releaseProviderFailure(db,job,provider,g);
    job.status='failed';job.retryable=false;job.phase='Provider rejected generation';job.error=provider.error||'Provider generation '+provider.status;
    await persist();return job;
   }
   if(provider.status!=='completed')throw new Error('Accepted generation is still pending. Resume status polling; do not submit again.');
   if(!provider.outputUrl)throw new Error('Completed provider request has no output URL');
   if(!g.downloaded||!fs.existsSync(g.paths.raw)){
    job.phase='Downloading candidate';await persist();
    try{fs.rmSync(g.paths.raw,{force:true});await download(provider.outputUrl,g.paths.raw);}catch(error){fs.rmSync(g.paths.raw,{force:true});throw error;}
    g.downloaded=true;await persist();
   }
   if(!g.probed){
    job.phase='Validating candidate';await persist();
    const info=await runMedia({action:'probe',source:g.paths.raw});
    if(g.kind==='audio'&&!info.hasAudio)throw new Error('Higgsfield returned no audio stream. Original unchanged.');
    const selectedEndOffset=g.end-g.processStart;
    if(!Number.isFinite(info.duration)||info.duration<selectedEndOffset-1e-6){
     g.generatedDuration=Number.isFinite(info.duration)?info.duration:null;
     job.failureCode='OUTPUT_TOO_SHORT';
     throw new Error(Number.isFinite(info.duration)?`Higgsfield returned ${info.duration.toFixed(2)}s; this selection needs ${selectedEndOffset.toFixed(2)}s of footage. The final ${(selectedEndOffset-info.duration).toFixed(2)}s is missing. Checking this completed request again cannot add frames. Your original and selection are unchanged. A new generation requires a new cost review.`:'Higgsfield returned an unreadable duration. Your original and selection are unchanged.');
    }
    g.generatedDuration=info.duration;
    if(Math.abs(info.duration-(g.processEnd-g.processStart))>1/30+.001){
     g.timingNote='Generated context duration differs from the source context. The output covers the selected interval and is trimmed at the original offsets without retiming or looping. Review visual alignment and timing.';
    }
    else delete g.timingNote;
    g.probed=true;await persist();
   }
   if(!g.trimmed||!fs.existsSync(g.paths.trimmed)){
    job.phase='Trimming processing context';await persist();
    await runMedia({action:'extract',source:g.paths.raw,output:g.paths.trimmed,start:g.start-g.processStart,end:g.end-g.processStart});
    g.trimmed=true;await persist();
   }
   if(!g.composed||!fs.existsSync(g.paths.output)||(g.operation==='object'&&!g.repairVerification)){
    if(!g.paths.output.endsWith('.webm'))g.paths.output=mediaPath(randomUUID(),'webm');
    job.phase=g.operation==='object'?OBJECT_REPAIR_PHASE:'Composing reviewed selection';await persist();
    const result=await runMedia({action:g.operation==='object'?'object_repair':'render',source:g.source,output:g.paths.output,reviewOutput:g.operation==='object'?(g.paths.coverage??=mediaPath(randomUUID(),'webm')):undefined,start:g.start,end:g.end,
     operation:g.kind==='audio'?'replace_audio':g.operation==='object'||g.masks?.length?'object':'picture',
     audio:g.paths.trimmed,candidate:g.paths.trimmed,masks:g.masks,scope:g.scope,visibleRanges:g.visibleRanges});
    if(g.operation==='object')g.repairVerification=verifiedObjectRepair(result);
    g.composed=true;g.note=[result.note,g.timingNote].filter(Boolean).join(' ');await persist();
   }
   const candidate={id:g.candidateId,projectId:job.projectId,baseRevisionId:g.baseRevisionId,url:mediaUrl(g.paths.output),path:g.paths.output,
    label:g.kind==='audio'?'Higgsfield soundtrack':g.operation==='object'?'Automatic object repair':'Higgsfield picture edit',...(g.paths.coverage?{maskReviewUrl:mediaUrl(g.paths.coverage)}:{}),createdAt:g.completedAt??new Date().toISOString(),note:g.note,...(g.referenceImageId?{referenceImage:ownedReference(db,job.projectId,g.referenceImageId)}:{}),...(g.repairVerification?{repairVerification:g.repairVerification}:{})};
   g.completedAt=candidate.createdAt;db.candidates[candidate.id]=candidate;
   const {path:ignored,...safe}=candidate;job.result=safe;job.status='completed';job.phase='Ready to review';job.retryable=false;
   job.billing='Estimate reserved; actual charge not yet reconciled';delete job.error;await persist();
   // Only discard intermediates once the durable candidate record references the finished export.
   // A cleanup failure must never turn successful, paid work into a failed generation.
   for(const intermediate of [g.paths.clip,...(g.operation==='object'?[]:[g.paths.trimmed]),g.paths.reference,g.paths.userReference].filter(Boolean)){
    if(intermediate!==g.paths.output){try{fs.rmSync(intermediate,{force:true});}catch{}}
   }
   return job;
  }catch(error){
   const provider=g.providerState||job.providerState;
   const ambiguous=!provider&&g.submission==='attempting'||provider?.status==='unknown';
   job.status=ambiguous?'unknown':'failed';job.retryable=job.failureCode!=='OUTPUT_TOO_SHORT'&&!ambiguous&&!rejectedStatuses.has(provider?.status);
   job.phase=job.failureCode==='OUTPUT_TOO_SHORT'?'Generated footage is too short':ambiguous?'Acceptance requires reconciliation':provider?.status==='completed'?'Local processing failed; safe to retry':'Generation interrupted; safe to resume';
   job.error=error instanceof Error?error.message:'Generation processing failed';await persist();return job;
  }
 }
 return {run(job){if(active.has(job.id))return active.get(job.id);const promise=execute(job).finally(()=>active.delete(job.id));active.set(job.id,promise);return promise;}};
}
