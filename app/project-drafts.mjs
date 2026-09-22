import {validateProtectedAreas} from './local-candidate-repair.mjs';
import {ownedReference} from './reference-images.mjs';
const MAX_BYTES=4*1024*1024;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
function record(value,fields,label){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw failure(`${label} must be an object.`);
 if(Object.keys(value).some(key=>!fields.includes(key)))throw failure(`${label} contains an unsupported field.`);
 return value;
}
function jsonSize(value){let encoded;try{encoded=JSON.stringify(value);}catch{throw failure('Draft must be serializable JSON.');}if(encoded===undefined||Buffer.byteLength(encoded,'utf8')>MAX_BYTES)throw failure('Draft exceeds the 4 MiB limit.',413);}
function finite(value,min,max,label){if(!Number.isFinite(value)||value<min||value>max)throw failure(`${label} must be finite and between ${min} and ${max}.`);return value;}
function text(value,max,label){if(typeof value!=='string'||value.length>max)throw failure(`${label} must be text of at most ${max} characters.`);return value;}
function choice(value,allowed,label){if(!allowed.includes(value))throw failure(`Unsupported ${label}.`);return value;}
function polygon(points,min,max,label){
 if(!Array.isArray(points)||points.length<min||points.length>max)throw failure(`${label} must contain ${min}–${max} points.`);
 return points.map(point=>{if(!Array.isArray(point)||point.length!==2)throw failure(`${label} points require two coordinates.`);return point.map(v=>finite(v,0,1,'Point coordinate'));});
}
function ranges(values,project,gaps=false){
 if(!Array.isArray(values)||values.length>1800)throw failure('Too many draft ranges.');let lastEnd=0;
 return values.map(value=>{
  record(value,gaps?['start','end','reason']:['start','end'],'Range');
  const start=finite(value.start,0,project.duration,'Range start'),end=finite(value.end,0,project.duration,'Range end');
  if(end<=start||start<lastEnd)throw failure('Ranges must be ordered, nonoverlapping, and nonempty.');lastEnd=end;
  return {start,end,...(own(value,'reason')?{reason:text(value.reason,3000,'Gap reason')}:{})};
 });
}
const editorFields=['objectName','objectSelections','start','end','time','mode','operation','gain','prompt','scope','masks','points','visibleRanges','gaps','audioId','visualId','candidateId','repairCandidateId','protectedAreas','assetName'];
function editorDraft(value,project,db){
 record(value,editorFields,'Editor draft');const result={};
 if(own(value,'objectName'))result.objectName=text(value.objectName,80,'Object name');
 if(own(value,'objectSelections')){if(!Array.isArray(value.objectSelections)||value.objectSelections.length>8)throw failure('Save up to eight object selections.');const names=new Set();result.objectSelections=value.objectSelections.map(item=>{record(item,['name','start','end','scope','masks','visibleRanges','gaps'],'Object selection');const name=text(item.name,80,'Object name');if(!name.trim()||names.has(name))throw failure('Object names must be nonempty and unique.');names.add(name);const {name:_,...fields}=item;return {name,...editorDraft(fields,project,db)};});}

 for(const key of ['start','end','time'])if(own(value,key))result[key]=finite(value[key],0,project.duration,key);
 if(own(result,'start')&&own(result,'end')&&result.end<=result.start)throw failure('Draft range must end after its start.');
 if(own(value,'mode'))result.mode=choice(value.mode,['picture','audio','object','background'],'editor mode');
 if(own(value,'operation'))result.operation=choice(value.operation,['mute','gain','replace_audio','background'],'audio operation');
 if(own(value,'scope'))result.scope=choice(value.scope,['frame','range'],'object scope');
 if(own(value,'gain'))result.gain=finite(value.gain,-60,12,'Gain');
 if(own(value,'prompt'))result.prompt=text(value.prompt,3000,'Prompt');
 if(own(value,'assetName'))result.assetName=text(value.assetName,3000,'Asset name');
 if(own(value,'points'))result.points=polygon(value.points,0,256,'Authored polygon');
 if(own(value,'masks')){
  if(!Array.isArray(value.masks)||value.masks.length>1800)throw failure('Draft accepts at most 1800 masks.');let prior=-1;
  result.masks=value.masks.map(mask=>{
   record(mask,['time','points','holes','confidence','visible','reviewRequired','method'],'Mask');const time=finite(mask.time,0,project.duration,'Mask time');
   if(time<=prior)throw failure('Mask times must be ordered and unique.');prior=time;
   const points=polygon(mask.points,3,500,'Mask polygon');
   let holes;if(own(mask,'holes')){if(!Array.isArray(mask.holes)||mask.holes.length>64)throw failure('Use up to 64 openings per mask.');holes=mask.holes.map(hole=>polygon(hole,3,500,'Mask opening'));}
   return {time,points,...(holes?{holes}:{}),...(own(mask,'confidence')&&mask.confidence!==null?{confidence:finite(mask.confidence,0,1,'Mask confidence')}:{})};
  });
 }
 for(const key of ['visibleRanges','gaps'])if(own(value,key))result[key]=ranges(value[key],project,key==='gaps');
 if(own(value,'protectedAreas'))result.protectedAreas=validateProtectedAreas(value.protectedAreas);
 for(const key of ['audioId','visualId','candidateId','repairCandidateId'])if(own(value,key)){
  const id=text(value[key],128,key);
  const asset=id?(['candidateId','repairCandidateId'].includes(key)?db.candidates?.[id]:db.assets?.[id]||db.candidates?.[id]):null;
  if(id&&(!asset||asset.projectId!==project.id))throw failure('Draft media reference must belong to this project.');
  result[key]=id;
 }
 return result;
}
function conversationDraft(value,project,db){record(value,['text','quality','referenceImageId'],'Conversation draft');if(value.referenceImageId)ownedReference(db,project.id,value.referenceImageId);return {...(own(value,'referenceImageId')?{referenceImageId:text(value.referenceImageId,128,'Reference image ID')} :{}),...(own(value,'text')?{text:text(value.text,3000,'Conversation text')}:{}),...(own(value,'quality')?{quality:choice(value.quality,['standard','draft'],'quality')}:{})};}

export function createProjectDraftService({db,save,getProject,now=()=>new Date().toISOString()}){
 function read(projectId,owner){
  const project=getProject(projectId,owner),draft=db.projectDrafts?.[projectId];
  return structuredClone(draft?{...draft,currentRevisionId:project.activeRevisionId,stale:draft.baseRevisionId!==project.activeRevisionId}:{baseRevisionId:project.activeRevisionId,currentRevisionId:project.activeRevisionId,version:0,editor:{},conversation:{},updatedAt:null,stale:false});
 }
 function write(projectId,owner,input){
  const project=getProject(projectId,owner);
  record(input,['baseRevisionId','expectedVersion','editor','conversation'],'Draft request');jsonSize(input);
  if(input.baseRevisionId!==project.activeRevisionId)throw failure('Project revision changed. Reload the draft before saving.',409);
  const previous=db.projectDrafts?.[projectId];
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw failure('A nonnegative expectedVersion is required.');
  if(input.expectedVersion!==(previous?.version??0))throw failure('Draft changed in another session. Reload before saving.',409);
  if(input.expectedVersion>=Number.MAX_SAFE_INTEGER)throw failure('Draft version limit reached.',409);
  if(!own(input,'editor')&&!own(input,'conversation'))throw failure('Provide an editor or conversation draft.');
  // New revision starts clean. The UI may explicitly copy stale text after
  // showing a warning; old geometry/approval never migrates implicitly.
  const base=previous?.baseRevisionId===project.activeRevisionId?previous:{editor:{},conversation:{}};
  if(own(input,'editor'))record(input.editor,editorFields,'Editor draft');
  if(own(input,'conversation'))record(input.conversation,['text','quality','referenceImageId'],'Conversation draft');
  const draft={baseRevisionId:project.activeRevisionId,version:input.expectedVersion+1,
   editor:editorDraft({...base.editor,...(input.editor??{})},project,db),
   conversation:conversationDraft({...base.conversation,...(input.conversation??{})},project,db),updatedAt:now()};
  jsonSize(draft);db.projectDrafts??={};db.projectDrafts[projectId]=draft;
  try{save();}catch(error){if(previous)db.projectDrafts[projectId]=previous;else delete db.projectDrafts[projectId];throw error;}
  return read(projectId,owner);
 }
 return {read,write};
}
export function registerProjectDraftRoutes(app,dependencies){
 const drafts=createProjectDraftService(dependencies);
 app.get('/api/projects/:id/draft',(req,res)=>res.json(drafts.read(req.params.id,req.user.id)));
 app.post('/api/projects/:id/draft',(req,res)=>res.json(drafts.write(req.params.id,req.user.id,req.body)));
 return drafts;
}
