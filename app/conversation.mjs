import {LOCAL_TOOLS,directLocalTool,localParameters} from './local-tools.mjs';
import {precisionRecolor} from './precision-recolor.mjs';
import {EDITOR_WORKFLOWS} from './editor-workflows.mjs';
import {ownedReference} from './reference-images.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {validateEdit} from './domain.mjs';
const stamp=()=>new Date().toISOString();
const labels={...Object.fromEntries(Object.entries(LOCAL_TOOLS).map(([id,t])=>[id,t.title])),...Object.fromEntries(Object.entries(EDITOR_WORKFLOWS).map(([key,w])=>[key,w.title])),mute:'Mute the selected sound',gain:'Adjust the selected volume',replace_audio:'Use your replacement audio',replace_picture:'Use your replacement video',picture:'Create a picture edit',object:'Change a selected object',generate_audio:'Create a new soundtrack',apply:'Apply the reviewed candidate',undo:'Restore the previous revision',export:'Download the current revision',play:'Play your video',pause:'Pause playback',seek:'Go to a moment',select_range:'Select an edit range',open_editor:'Open precise editing controls',open_media:'Open your media',open_history:'Open revision history',open_activity:'Open project activity',open_markers:'Open saved moments',add_marker:'Save a moment',import:'Import another video',clarify:'Let’s make the edit precise',unsupported:'This edit needs another workflow'};
const uiActions={...Object.fromEntries(Object.entries(EDITOR_WORKFLOWS).map(([key,w])=>[key,w.uiAction])),export:'export',play:'play',pause:'pause',seek:'seek',select_range:'select_range',open_editor:'editor',open_media:'media',open_history:'history',open_activity:'activity',open_markers:'markers',add_marker:'add_marker',import:'import'};
const manualIntents=new Set([...Object.keys(LOCAL_TOOLS),...Object.keys(EDITOR_WORKFLOWS),'mute','gain','replace_audio','replace_picture','picture','object','generate_audio']);
function seconds(raw){if(raw.includes(':')){const [m,s]=raw.split(':').map(Number);if(s>=60)throw new Error('Invalid timestamp');return m*60+s;}return Number(raw);}
export function computeGenerationWindow(p,start,end,resolution='720p'){
 if(!['480p','720p'].includes(resolution))throw new Error('Unsupported resolution');
 const short=Number.parseInt(resolution);
 if(p.duration<4)throw new Error('Seedance editing needs at least 4 seconds of source footage. Import a longer clip.');
 let processStart=Math.max(0,start-1),processEnd=Math.min(p.duration,end+1);
 if(processEnd-processStart<4){processEnd=Math.min(p.duration,processStart+4);processStart=Math.max(0,processEnd-4);}
 if(processEnd-processStart>30)throw new Error('Select a shorter range: at most 30 seconds including context.');
 const width=Math.ceil(p.width*short/Math.min(p.width,p.height)/64)*64,height=Math.ceil(p.height*short/Math.min(p.width,p.height)/64)*64;
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Video dimensions are required');
 const tailPadding=Math.max(0,Math.ceil((.5-(processEnd-end))*30-1e-7)/30);
 const duration=processEnd-processStart+tailPadding;
 if(duration>30)throw new Error('Select a shorter range to leave half a second of end protection.');
 const estimatedUsd=Math.ceil((Math.ceil(2*duration*width*height*24/1024)*0.01284/1000)*100)/100;
 return {processStart,processEnd,tailPadding,resolution,pricingDimensions:{width,height,inputSeconds:duration,outputSeconds:duration},estimatedUsd};
}
export function buildEditPlan(p,input,decision){
 if(input.baseRevisionId!==p.activeRevisionId)throw new Error('Project revision changed. Send the edit again for the current revision.');
 if(!['standard','draft'].includes(input.quality??'standard'))throw new Error('Unsupported quality setting');
 const text=input.text.trim();let start=input.start??0,end=input.end??p.duration;
 // Unit-tagged gain values are never times, even during the preliminary clarify
 // plan. Keep the original instruction intact for gain extraction and review.
 const localId=Object.hasOwn(LOCAL_TOOLS,decision.action)?decision.action:(!input.intent||Object.hasOwn(LOCAL_TOOLS,input.intent))?directLocalTool(text):null;
 const temporalText=(localId==='title'?text.replace(/"[^"]*"/g,''):['crop','resize','speed','contrast','exposure'].includes(localId)?text.replace(/\b\d+:\d+\b|[+-]?\d+(?:\.\d+)?\s*(?:x|stops?)\b/gi,''):text).replace(/\b(?:this|these|those|(?:the\s+)?selected|(?:the\s+)?current)\s+(?:frames?|time\s+range)\b/gi,' ').replace(/[-+−]?\d+(?:\.\d+)?\s*dB\b/gi,' ');
 let action=localId||(Object.hasOwn(labels,decision.action)?decision.action:'clarify');
 if(LOCAL_TOOLS[localId]?.whole){start=0;end=p.duration;}
 const time='(?:\\d{1,3}:\\d{2}(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
 if(/\b(?:minutes?|mins?|hours?|hrs?)\b/i.test(temporalText)||/(?:from|between|to|through|until|at)\s*[-−]\s*\d|[-−]\d+(?:\.\d+)?\s*(?:seconds?|secs?)\b/i.test(temporalText))throw new Error('Use nonnegative times in seconds or MM:SS.');
 const pattern=new RegExp('(?:from\\s+|between\\s+)?('+time+')\\s*(?:s(?:ec(?:ond)?s?)?)?\\s*(?:to|through|until|and|[-–—])\\s*('+time+')\\s*(?:seconds?|secs?|s)?','ig');
 const ranges=[...temporalText.matchAll(pattern)];let explicit=false,timingPhrase='';
 if(ranges.length>1)throw new Error('Choose one time range per edit.');
 if(ranges.length){start=seconds(ranges[0][1]);end=seconds(ranges[0][2]);explicit=true;timingPhrase=ranges[0][0];}
 else if(/\b(?:entire|whole|full)\s+(?:video|clip|soundtrack)\b/i.test(temporalText)){start=0;end=p.duration;explicit=true;}
 else {const edge=temporalText.match(/\b(first|last)\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);if(edge){const length=Number(edge[2]);start=edge[1].toLowerCase()==='first'?0:p.duration-length;end=edge[1].toLowerCase()==='first'?length:p.duration;explicit=true;timingPhrase=edge[0];}
  else {const frame=temporalText.match(new RegExp('\\b(?:at|to)\\s+('+time+')\\s*(?:seconds?|secs?|s)?\\b','i'));if(frame){start=seconds(frame[1]);end=Math.min(p.duration,start+1/30);explicit=true;timingPhrase=frame[0];}}
 }
 if(!explicit&&(/\b(?:between|seconds?|secs?|minutes?|frames?)\b/i.test(temporalText)||/\d+:\d+|\b(?:from|at|to)\s+[-−]?\d|\b(?:first|last)\s+[-−]?\d+(?:\.\d+)?\s*[.!?]?$/i.test(temporalText)))throw new Error('I could not read that time range. Use “from 1 to 3 seconds” or “at 3 seconds”.');
 if(LOCAL_TOOLS[localId]?.whole&&(start!==0||end!==p.duration))throw new Error('Crop and resize apply to the whole video. Remove the time range to continue.');
 if(action==='seek'&&!explicit)action='clarify';
 let validated;if(start===p.duration&&action==='seek')start=Math.max(0,p.duration-1/30);
 try{validated=validateEdit(p,{baseRevisionId:p.activeRevisionId,start,end,operation:'mute'});}catch{throw new Error('Invalid time range. Use a start before the end inside this video.');}
 ({start,end}=validated);
 const plan={id:randomUUID(),createdAt:stamp(),status:'ready',action,title:labels[action],explanation:'',start,end,baseRevisionId:p.activeRevisionId,route:{id:'local-editor',label:'Local editor',kind:'local',estimatedUsd:0,costLabel:'No generation charge'},warnings:[],suggestions:(decision.suggestions||[]).filter(a=>manualIntents.has(a)),decision:{source:decision.source,confidence:decision.confidence,model:decision.model,usage:decision.usage},instruction:text,editInstruction:timingPhrase?text.replace(timingPhrase,'within the selected interval'):text};
 if(localId){
  const tool=LOCAL_TOOLS[localId];plan.tool=localId;plan.requiresMask=!!tool.mask;plan.requiresReference=!!tool.reference;plan.changesTimeline=!!tool.timeline;plan.route.id='deterministic';plan.route.label='Deterministic editor';plan.explanation=tool.criterion+' Keeps: '+tool.preserves;
  try{plan.parameters=localParameters(localId,text);}catch(error){plan.action='clarify';plan.status='needs_input';plan.explanation=error.message;return plan;}
  if(tool.mask){plan.status='needs_input';plan.uiAction='select_object';plan.warnings.push(tool.corners?'Select four corners clockwise from top-left, track the plane, and review every frame. Freeform SAM masks cannot define a screen plane.':'Track and review the selected object for every visible frame. Unreviewed gaps stay unchanged.');}
  if(tool.reference&&!input.referenceImageId){plan.action='clarify';plan.status='needs_input';plan.explanation='Attach the exact image to place, then send this request again. No replacement will be invented.';}
  if(localId==='title')plan.warnings.push('Text appears centered near the bottom during the selected range. This renders your supplied text; it does not transcribe speech.');
  if(localId==='logo')plan.warnings.push('The attached image appears at the top right, scaled to fit one quarter of the frame.');
  if(tool.whole)plan.warnings.push('This affects the whole video. Crop is centered; resize preserves aspect ratio with black letterboxing.');
  if(tool.timeline)plan.warnings.push('This changes the time mapping. Review the new duration and audio before applying.');
  return plan;
 }
 const recolor=precisionRecolor(text);
 if(!recolor&&/\b(recolor|repaint)\b/i.test(text)&&['object','picture','clarify'].includes(action)){plan.action='clarify';plan.status='needs_input';plan.title='Choose the paint colors';plan.explanation='For a precision hue edit, name the original and target colors, for example: Recolor yellow paint to blue. Submit geometry or material changes separately. No generation was submitted.';return plan;}
 if(recolor&&!input.referenceImageId&&['object','picture','clarify'].includes(action)){
  plan.action='object';plan.operation='recolor';plan.title=`Recolor ${recolor.sourceName} paint to ${recolor.targetName}`;plan.recolor=recolor;plan.status='needs_input';plan.uiAction='select_object';plan.route={id:'precision-recolor',label:'Precision color edit · original frames',kind:'local',estimatedUsd:0,costLabel:'No generation charge'};
  plan.explanation='Change only matching colored pixels inside your reviewed selection. Original frame positions, motion and HSV brightness/detail are retained; no replacement video is generated.';
  plan.warnings=['Review the tracked surface mask. Matching colors anywhere inside that mask can change; neutral pixels and pixels outside it stay original. This changes hue, not material or geometry.'];return plan;
 }
 if(uiActions[action]){plan.route.kind='ui';plan.uiAction=uiActions[action];plan.explanation=EDITOR_WORKFLOWS[action]?.description||'Use this action to move around your project. Your footage is unchanged.';return plan;}
 if(['clarify','unsupported'].includes(action)){plan.status='needs_input';plan.explanation=action==='unsupported'?'I cannot perform that operation yet. I can edit picture, sound or a reviewed object region, and help you compare, apply, undo and export.':'Choose the kind of change: picture, object, or sound. I’ll use your instruction to prepare a plan for review.';if(decision.reason)plan.warnings.push(decision.reason==='router_authentication_failed'?'The language router could not authenticate. The workspace operator needs to check its TypeSafe credential. Built-in commands remain available.':decision.reason==='router_not_configured'?'The language router is not configured. Try a built-in command such as “mute from 1 to 3 seconds”.':'I could not confidently map this request to one available action. No video generation was submitted.');return plan;}
 if(action==='mute'){plan.explanation='Mute only this interval. Keep the picture and the rest of the soundtrack.';plan.operation='mute';}
 if(action==='gain'){const m=text.match(/([+-]?\d+(?:\.\d+)?)\s*dB\b/i);if(!m){plan.status='needs_input';plan.explanation='Specify the volume change in dB, such as “Lower the volume by 6 dB.”';return plan;}let gain=Number(m[1]);if(/\b(?:lower|reduce|decrease|quieter|down)\b/i.test(text))gain=-Math.abs(gain);if(gain< -60||gain>12)throw new Error('Gain must be between -60 and 12 dB');plan.gainDb=gain;plan.operation='gain';plan.explanation=`Change volume by ${gain>0?'+':''}${gain} dB in this interval. Keep the picture.`;}
 if(action==='replace_audio'){plan.operation='replace_audio';plan.status='needs_input';plan.uiAction='upload_audio';plan.explanation='Choose a replacement audio file in the editor, then run this plan. Only the selected soundtrack interval changes.';}
 if(action==='replace_picture'){plan.operation='picture';plan.status='needs_input';plan.uiAction='upload_video';plan.explanation='Choose your replacement video in the editor, then run this plan. Keep the source soundtrack and all picture outside the interval.';}
 if(action==='apply'){plan.explanation='Make the selected reviewed candidate the current revision. You can undo this.';}
 if(action==='undo'){plan.explanation='Return to the parent revision. Saved candidates and revision history stay available.';}
 if(['picture','object','generate_audio'].includes(action)){
  const resolution=input.quality==='draft'?'480p':'720p';const window=computeGenerationWindow(p,start,end,resolution);
  plan.processStart=window.processStart;plan.processEnd=window.processEnd;plan.inputDuration=window.pricingDimensions.inputSeconds;
  if(window.tailPadding>0)plan.warnings.push(`Includes ${window.tailPadding.toFixed(2)}s of repeated-frame input tail protection, priced into this estimate and excluded from your edit.`);
  plan.route={id:'seedance-2.5-video-edit',label:`Seedance 2.5 · ${resolution}`,kind:'higgsfield',resolution,estimatedUsd:window.estimatedUsd,costLabel:`Estimated $${window.estimatedUsd.toFixed(2)} · hold $${(window.estimatedUsd*2).toFixed(2)}`};
  plan.operation=action==='generate_audio'?'replace_audio':action;plan.generationKind=action==='generate_audio'?'audio':'video';
  plan.explanation=action==='generate_audio'?'Generate a soundtrack through Higgsfield, then apply only its audio to this interval. Keep your picture.':action==='object'?'Generate replacement footage through Higgsfield and compose only your reviewed object region.':'Generate replacement footage through Higgsfield. Change only the selected picture interval and keep the soundtrack.';
  plan.warnings.push('Pricing preview uses the last verified token rate and conservative dimensions. A fresh estimate is checked before submission. Estimates are not guaranteed billing caps.');
  if(resolution==='480p')plan.warnings.push('Draft uses 480p generation and is scaled to your project. Fine detail may be softer; this is not a final-quality guarantee.');
  if(action==='object'){plan.status='needs_input';plan.uiAction='select_object';plan.warnings.push('Draw or track the object and review its boundary before running this plan. Jev cannot see or identify the object.');}
  if(window.estimatedUsd>5){plan.status='needs_input';plan.warnings.push('This exceeds the $5 per-request estimate limit. Select a shorter interval or explicitly choose Draft.');}
 }
 return plan;
}
function safePlan(plan){const {instruction,editInstruction,executionResult,...safe}=plan;return safe;}
export function createConversationService({db,save,getProject,classify,execute,configured=()=>false}){
 db.conversations??={};const planning=new Map(),executing=new Map();
 const get=(projectId,owner)=>{getProject(projectId,owner);return db.conversations[projectId]??={messages:[],plans:[],requests:{}};};
 function snapshot(projectId,owner){const c=get(projectId,owner);let changed=false;for(const [requestId,request] of Object.entries(c.requests)){if(request.status==='processing'&&!planning.has(projectId+':'+requestId)){request.status='interrupted';c.messages.push({id:randomUUID(),role:'assistant',text:'That reply was interrupted before a plan was saved. No video generation was submitted. Send the instruction again to make a new plan.',createdAt:stamp()});changed=true;}}for(const plan of c.plans){if(plan.jobId&&db.jobs[plan.jobId]){const job=db.jobs[plan.jobId];const status=job.status==='completed'?'completed':['failed','unknown','canceled'].includes(job.status)?'failed':'executing';if(plan.status!==status){plan.status=status;changed=true;}if(job.result?.id)plan.candidateId=job.result.id;plan.jobPhase=job.phase;plan.error=job.error;}}if(changed)save();return {messages:c.messages,plans:c.plans.map(safePlan),router:{configured:configured()}};}
 async function message(projectId,owner,input){
  const p=getProject(projectId,owner),c=get(projectId,owner);if(typeof input.text!=='string'||!input.text.trim()||input.text.length>3000)throw new Error('Send a message of 1–3000 characters.');
  const referenceImage=ownedReference(db,projectId,input.referenceImageId);
  if(input.intent!==undefined&&!manualIntents.has(input.intent))throw new Error('Choose a supported edit intent.');
  if(typeof input.idempotencyKey!=='string'||!/^[\w-]{8,128}$/.test(input.idempotencyKey))throw new Error('A valid message idempotency key is required.');
  const fingerprint=createHash('sha256').update(JSON.stringify([input.text,input.baseRevisionId,input.start,input.end,input.quality,input.referenceImageId??'',input.reviewCandidateId??'',input.selectionContext??null,...(input.intent===undefined?[]:[input.intent])])).digest('hex');const existing=c.requests[input.idempotencyKey];
  const key=projectId+':'+input.idempotencyKey;if(existing){if(existing.fingerprint!==fingerprint)throw new Error('This message key was already used for different inputs.');if(planning.has(key))await planning.get(key);else if(existing.status==='processing'){existing.status='interrupted';c.messages.push({id:randomUUID(),role:'assistant',text:'That reply was interrupted before a plan was saved. No video generation was submitted. Send the instruction again to make a new plan.',createdAt:stamp()});save();}return {...snapshot(projectId,owner),requestedPlanId:existing.planId??null};}
  if(c.messages.length>=400)throw new Error('Conversation limit reached. Start a new project to continue.');
  if([...planning.keys()].some(k=>k.startsWith(projectId+':')))throw new Error('Wait for the current reply before sending another message.');
  if(c.messages.filter(m=>m.role==='user'&&Date.now()-Date.parse(m.createdAt)<60000).length>=12)throw new Error('Please wait a moment before sending more messages.');
  // Validate scope before spending even a routing call.
  buildEditPlan(p,input,{action:'clarify',source:'rules'});
  c.requests[input.idempotencyKey]={fingerprint,status:'processing'};c.messages.push({id:randomUUID(),role:'user',text:input.text.trim(),...(referenceImage?{referenceImage}:{}),quality:input.quality??'standard',...(input.intent===undefined?{}:{intent:input.intent}),createdAt:stamp()});save();
  const task=(async()=>{let plan;try{const previous=c.plans.at(-1);const decision=directLocalTool(input.text)&&!input.intent?{action:directLocalTool(input.text),source:'rules'}:precisionRecolor(input.text)&&!input.referenceImageId&&(!input.intent||['object','picture'].includes(input.intent))?{action:'object',source:'rules'}:input.intent!==undefined?{action:input.intent,source:'manual'}:await classify({text:input.text,context:{selectedRange:{start:input.start??0,end:input.end??p.duration},hasCandidate:Object.values(db.candidates||{}).some(a=>a.projectId===projectId&&a.baseRevisionId===p.activeRevisionId),hasMask:input.selectionContext?.hasMask===true&&Number.isInteger(input.selectionContext?.maskCount)&&input.selectionContext.maskCount>0&&input.selectionContext.maskCount<=1800,selectionReviewed:input.selectionContext?.reviewed===true,selectedObjectName:typeof input.selectionContext?.objectName==='string'?input.selectionContext.objectName.slice(0,80):undefined,previousAction:previous?.action,previousInstruction:previous?.instruction,availableCapabilities:Object.keys(labels)}});plan=buildEditPlan(p,input,decision);if(input.selectionContext?.hasMask===true&&typeof input.selectionContext?.objectName==='string')plan.selectedObjectName=input.selectionContext.objectName.slice(0,80);if(EDITOR_WORKFLOWS[plan.action]?.candidate){const candidate=db.candidates?.[input.reviewCandidateId];if(!candidate||candidate.projectId!==p.id||candidate.baseRevisionId!==p.activeRevisionId){plan.status='needs_input';plan.explanation='Open the candidate you want to work on, then send this request again. No candidate has been chosen for this action.';}else{plan.targetCandidateId=candidate.id;plan.targetCandidateLabel=candidate.label||'Selected candidate';}}}catch{plan=buildEditPlan(p,input,{action:'clarify',source:'clarify',reason:'I could not finish routing this request. No video generation was submitted. Choose the kind of change to prepare a plan.'});}
   if(referenceImage){plan.referenceImage=referenceImage;plan.warnings.push(plan.route.kind==='higgsfield'&&['picture','object'].includes(plan.action)?'The attached reference will be sent to Higgsfield when you create this preview. Reference matching is not guaranteed.':'Reference attached; this action does not send it to a generation model.');}
   c.plans.push(plan);c.messages.push({id:randomUUID(),role:'assistant',text:plan.explanation,createdAt:stamp(),planId:plan.id});c.requests[input.idempotencyKey].status='completed';c.requests[input.idempotencyKey].planId=plan.id;save();return {...snapshot(projectId,owner),requestedPlanId:plan.id};})();planning.set(key,task);try{return await task;}finally{planning.delete(key);}
 }
 async function run(projectId,owner,planId,input){const c=get(projectId,owner),plan=c.plans.find(p=>p.id===planId);if(!plan)throw new Error('Plan not found');
  const key=projectId+':'+plan.id;if(executing.has(key))return executing.get(key);if(plan.executionResult)return {...plan.executionResult,plan:safePlan(plan)};
  const p=getProject(projectId,owner);if(input.baseRevisionId!==p.activeRevisionId||plan.baseRevisionId!==p.activeRevisionId)throw new Error('Project revision changed. Request a new plan before executing.');
  if(EDITOR_WORKFLOWS[plan.action]?.candidate){const candidate=db.candidates?.[plan.targetCandidateId];if(!candidate||candidate.projectId!==p.id||candidate.baseRevisionId!==p.activeRevisionId)throw new Error('Open a current candidate and request this action again.');}
  if(['clarify','unsupported'].includes(plan.action))throw new Error('Clarify the requested edit first.');
  const task=(async()=>{const result=await execute(p,plan,input);plan.executionResult=result;plan.status=result.job?'executing':'completed';plan.jobId=result.job?.id;save();return {...result,plan:safePlan(plan)};})();executing.set(key,task);try{return await task;}finally{executing.delete(key);}
 }
 return {snapshot,message,execute:run};
}
