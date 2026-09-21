import {randomUUID,createHash} from 'node:crypto';
import {reserve} from './budget.mjs';

const terminalFailure=new Set(['failed','nsfw','canceled']);
const pendingStatus=new Set(['queued','in_progress','running']);
const safeFailure=Symbol('safeSourceFailure');
const fail=(message,status=400)=>Object.assign(new Error(message),{status,[safeFailure]:true});
const stamp=()=>new Date().toISOString();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const QUOTE_LIFETIME_MS=5*60*1000;

export function sourceCreationEstimate({duration,resolution,aspectRatio}){
 const short=Number.parseInt(resolution,10),ratio=aspectRatio==='1:1'?1:16/9;
 const long=Math.ceil(short*ratio/64)*64,small=Math.ceil(short/64)*64;
 const width=aspectRatio==='9:16'?small:long,height=aspectRatio==='16:9'?small:long;
 const pricingDimensions={width,height,inputSeconds:0,outputSeconds:duration};
 const tokens=Math.ceil(duration*width*height*24/1024);
 return {estimatedUsd:Math.ceil(tokens*2140/1000000)/100,pricingDimensions};
}
function validatePlan(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['prompt','duration','resolution','aspectRatio','idempotencyKey'].includes(key)))throw fail('Provide only prompt, duration, resolution, aspectRatio and idempotencyKey.');
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>3000)throw fail('Enter a prompt of 1–3000 characters.');
 if(!Number.isInteger(input.duration)||input.duration<4||input.duration>10)throw fail('Choose a whole duration from 4 to 10 seconds.');
 if(!['480p','720p'].includes(input.resolution))throw fail('Choose 480p or 720p.');
 if(!['16:9','9:16','1:1'].includes(input.aspectRatio))throw fail('Choose 16:9, 9:16 or 1:1.');
 if(typeof input.idempotencyKey!=='string'||!/^[-\w]{8,128}$/.test(input.idempotencyKey))throw fail('A valid idempotency key is required.');
 return {prompt:input.prompt.trim(),duration:input.duration,resolution:input.resolution,aspectRatio:input.aspectRatio};
}
function recoveryAllowed(record){
 if(!['failed','unknown','queued','running'].includes(record.status))return false;
 const provider=record.providerState;
 if(terminalFailure.has(provider?.status))return false;
 if(provider?.status==='unknown')return !!(provider.requestId&&provider.statusUrl);
 if(!provider&&record.submission==='attempting')return false;
 return true;
}
export function publicSourceCreation(record){
 return {id:record.id,status:record.status,prompt:record.prompt,duration:record.duration,resolution:record.resolution,aspectRatio:record.aspectRatio,
  estimatedUsd:record.estimatedUsd,...(record.reservedUsd===undefined?{}:{reservedUsd:record.reservationReleased?0:record.reservedUsd}),
  ...(record.error?{error:record.error}:{}),phase:record.phase,...(record.projectId?{projectId:record.projectId}:{}),
  recoverable:['failed','unknown'].includes(record.status)&&recoveryAllowed(record),createdAt:record.createdAt};
}

export function createSourceCreationService({db,save,adapter,budgetLimit,importGenerated,pollAttempts=180,pollDelay=5000,now=Date.now}){
 if(!Number.isInteger(pollAttempts)||pollAttempts<0||pollAttempts>180||!Number.isFinite(pollDelay)||pollDelay<0||pollDelay>10000)throw new Error('Invalid bounded source polling configuration');
 const active=new Map();db.sourceCreations??={};
 // Startup never submits, polls, downloads, or imports. A human must recover
 // interrupted work, and an ambiguous POST without identity stays quarantined.
 let changed=false;
 for(const record of Object.values(db.sourceCreations))if(['queued','running'].includes(record.status)){
  record.status=!record.providerState&&record.submission==='attempting'||record.providerState?.status==='unknown'?'unknown':'failed';
  record.phase='Interrupted; review recovery';record.error=recoveryAllowed(record)?'Source creation was interrupted. Recover this request to continue safely.':'Provider acceptance needs operator reconciliation. No automatic resubmission.';changed=true;
 }
 if(changed)save();
 const get=(owner,id)=>{if(!owner)throw fail('Sign in to access source creation.',401);const record=db.sourceCreations[id];if(!record||record.ownerId!==owner)throw fail('Source creation not found.',404);return record;};
 const persist=async()=>{await save();};
 const budget=()=>Number(typeof budgetLimit==='function'?budgetLimit():budgetLimit);
 function unknownExposure(){return Object.values(db.sourceCreations).some(r=>r.status==='unknown'&&!recoveryAllowed(r))||Object.values(db.jobs||{}).some(j=>j.provider&&j.status==='unknown'&&!(j.providerState?.requestId&&j.providerState?.statusUrl));}
 function releaseUnsent(record){if(record.reserved&&!record.reservationReleased&&Number.isFinite(record.reservedUsd)&&record.reservedUsd>=0&&Number.isFinite(db.spend.reserved)&&record.reservedUsd<=db.spend.reserved+1e-8){db.spend.reserved=Math.max(0,db.spend.reserved-record.reservedUsd);record.reservationReleased=true;}}
 async function run(record){
  let phase='preparation';
  try{
   record.status='running';record.phase='Preparing source generation';delete record.error;await persist();
   let provider=record.providerState;
   if(!provider&&record.submission==='attempting'){record.status='unknown';record.phase='Acceptance requires reconciliation';record.error='Provider acceptance needs operator reconciliation. No automatic resubmission.';await persist();return;}
   if(!provider){
    if(unknownExposure())throw fail('Resolve the earlier unknown provider submission before creating another source.',409);
    const input={kind:'text-to-video',prompt:record.prompt,duration:record.duration,resolution:record.resolution,aspectRatio:record.aspectRatio,generateAudio:true,pricingDimensions:record.pricingDimensions};
    phase='estimate';record.phase='Checking fresh estimate';await persist();const requestedAt=now();
    const quote=await adapter.estimateGeneration(input);record.quoteRequestedAt=requestedAt;
    if(!Number.isFinite(quote?.estimatedUsd)||quote.estimatedUsd<=0)throw fail('Provider estimate is invalid. No generation was submitted.');
    record.quotedUsd=quote.estimatedUsd;await persist();
    if(quote.estimatedUsd>record.estimatedUsd+1e-8)throw fail('The fresh estimate exceeds the reviewed plan. Prepare and review a new plan. No generation was submitted.');
    const fresh=()=>{const current=now();return Number.isFinite(current)&&current>=requestedAt&&current-requestedAt<QUOTE_LIFETIME_MS;};
    if(!fresh())throw fail('The estimate expired before submission. Recover preparation to check a fresh estimate.');
    const oldHold=record.reserved&&!record.reservationReleased?record.reservedUsd:0;
    if(!Number.isFinite(oldHold)||oldHold<0||oldHold>db.spend.reserved+1e-8)throw fail('Invalid source creation reservation.');
    try{db.spend=reserve({...db.spend,reserved:Math.max(0,db.spend.reserved-oldHold)},budget(),quote.estimatedUsd);}catch{throw fail('The source estimate or billing hold exceeds the available workspace budget, or the ledger needs review. No generation was submitted.');}
    record.reserved=true;record.reservationReleased=false;record.reservedUsd=Math.ceil(quote.estimatedUsd*2*1e6)/1e6;await persist();
    if(!fresh())throw fail('The estimate expired before submission. Recover preparation to check a fresh estimate.');
    // Persist the point of ambiguity before the only potentially billed POST.
    phase='submission';record.submission='attempting';record.phase='Submitting once';await persist();
    try{provider=await adapter.submitGeneration(input);}catch{provider={status:'unknown'};}
    if(!provider||!['unknown','completed',...terminalFailure,...pendingStatus].includes(provider.status))provider={status:'unknown'};
    record.providerState=provider;if(provider.requestId)record.acceptedRequestId=provider.requestId;record.submission='responded';await persist();
   }
   if(provider.status==='unknown'&&!(provider.requestId&&provider.statusUrl)){
    record.status='unknown';record.phase='Acceptance requires reconciliation';record.error='Provider acceptance is unknown. An operator must reconcile this request; do not submit it again.';await persist();return;
   }
   phase='polling';
   for(let attempt=0;attempt<pollAttempts&&(pendingStatus.has(provider.status)||provider.status==='unknown');attempt++){
    record.phase='Higgsfield '+provider.status;await persist();if(pollDelay)await delay(pollDelay);
    const next=await adapter.pollGeneration(provider);
    if(provider.requestId&&next?.requestId!==provider.requestId)throw new Error('Provider identity changed');
    provider=next;record.providerState=provider;if(provider.requestId)record.acceptedRequestId=provider.requestId;await persist();
   }
   if(terminalFailure.has(provider.status)){
    // Only a definite rejection with no accepted request identity can free funds.
    if(!provider.requestId&&!record.acceptedRequestId)releaseUnsent(record);
    record.status='failed';record.phase='Provider generation failed';record.error=provider.requestId?'Higgsfield could not create this source. The accepted request retains its billing hold pending reconciliation.':'Higgsfield rejected source creation before acceptance. Its reservation was released.';await persist();return;
   }
   if(provider.status!=='completed')throw fail('The existing generation is still pending. Recover status polling; no new generation will be submitted.');
   if(typeof provider.outputUrl!=='string'||!provider.outputUrl)throw fail('The completed request has no usable output. Recover the existing request; do not submit again.');
   phase='import';record.phase='Importing generated source';await persist();
   const result=await importGenerated(record,provider.outputUrl);
   if(typeof result?.projectId!=='string'||!result.projectId)throw new Error('Missing imported project identity');
   record.projectId=result.projectId;record.status='completed';record.phase='Source ready to edit';record.completedAt=stamp();delete record.error;await persist();
  }catch(error){
   const provider=record.providerState,ambiguous=!provider&&record.submission==='attempting'||provider?.status==='unknown';
   record.status=ambiguous?'unknown':'failed';
   if(!provider&&record.submission!=='attempting')releaseUnsent(record);
   record.phase=ambiguous?'Acceptance requires reconciliation':phase==='import'?'Local import interrupted; safe to recover':'Source creation interrupted';
   // Never surface arbitrary adapter/importer exceptions, signed URLs or credentials.
   record.error=ambiguous?'Provider acceptance is uncertain. Reconcile the existing request before any new submission.':error?.[safeFailure]&&['preparation','estimate'].includes(phase)?error.message:phase==='import'?'The generated source could not be imported. Recover this existing result; no new generation will be submitted.':phase==='polling'?'Status checking was interrupted or the request is still pending. Recover this existing request; no new generation will be submitted.':'Source preparation failed. Recover preparation to check a fresh estimate and budget.';
   await persist();
  }
 }
 function launch(record){if(active.has(record.id))return;const task=Promise.resolve().then(()=>run(record)).finally(()=>active.delete(record.id));active.set(record.id,task);void task.catch(()=>{});}
 function plan(owner,input){
  if(!owner)throw fail('Sign in to create a source.',401);const fields=validatePlan(input),fingerprint=createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  const duplicate=Object.values(db.sourceCreations).find(r=>r.ownerId===owner&&r.idempotencyKey===input.idempotencyKey);
  if(duplicate){if(duplicate.fingerprint!==fingerprint)throw fail('This source request key was already used for different settings.',409);return publicSourceCreation(duplicate);}
  if(Object.values(db.sourceCreations).filter(r=>r.ownerId===owner).length>=100)throw fail('Source creation history limit reached.',429);
  const priced=sourceCreationEstimate(fields);if(priced.estimatedUsd>5)throw fail('Shorten the source duration or select 480p to stay below the $5 estimate limit.');
  const record={id:randomUUID(),ownerId:owner,...fields,...priced,idempotencyKey:input.idempotencyKey,fingerprint,status:'planned',phase:'Review source plan',createdAt:stamp()};
  db.sourceCreations[record.id]=record;try{save();}catch(error){delete db.sourceCreations[record.id];throw error;}return publicSourceCreation(record);
 }
 async function execute(owner,id){
  const record=get(owner,id);if(record.status!=='planned'){if(['queued','running','completed'].includes(record.status))return publicSourceCreation(record);throw fail('Use explicit recovery for an interrupted source creation.',409);}
  if(unknownExposure())throw fail('Resolve the earlier unknown provider submission before creating another source.',409);
  record.status='queued';record.phase='Queued for approved generation';await persist();launch(record);return publicSourceCreation(record);
 }
 async function recover(owner,id){
  const record=get(owner,id);if(active.has(id))return publicSourceCreation(record);
  if(!recoveryAllowed(record))throw fail('This creation cannot be resumed safely. Reconcile unknown acceptance or review a new plan.',409);
  record.status='queued';record.phase='Queued for explicit recovery';await persist();launch(record);return publicSourceCreation(record);
 }
 return {plan,execute,recover,get:(owner,id)=>publicSourceCreation(get(owner,id)),list(owner){if(!owner)throw fail('Sign in to access source creation.',401);return Object.values(db.sourceCreations).filter(r=>r.ownerId===owner).map(publicSourceCreation).reverse();},waitForIdle:id=>active.get(id)||Promise.resolve()};
}
export function registerSourceCreationRoutes(app,dependencies){
 const service=createSourceCreationService(dependencies);
 app.post('/api/creations/plans',(req,res,next)=>{try{res.status(201).json(service.plan(req.user?.id,req.body));}catch(e){next(e);}});
 app.get('/api/creations',(req,res,next)=>{try{res.json(service.list(req.user?.id));}catch(e){next(e);}});
 app.get('/api/creations/:id',(req,res,next)=>{try{res.json(service.get(req.user?.id,req.params.id));}catch(e){next(e);}});
 app.post('/api/creations/:id/execute',(req,res,next)=>{service.execute(req.user?.id,req.params.id).then(record=>res.status(202).json(record)).catch(next);});
 app.post('/api/creations/:id/recover',(req,res,next)=>{service.recover(req.user?.id,req.params.id).then(record=>res.status(202).json(record)).catch(next);});
 return service;
}
