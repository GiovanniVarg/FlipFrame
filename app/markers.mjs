import {randomUUID} from 'node:crypto';

const keyPattern=/^[\w-]{8,128}$/;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);

function text(value,name,max,required=false){
 if(typeof value!=='string')throw new Error(`${name} must be text.`);
 const normalized=value.trim();
 if(required&&!normalized)throw new Error(`${name} is required.`);
 if(normalized.length>max)throw new Error(`${name} must be ${max} characters or fewer.`);
 return normalized;
}

function normalizedTiming(project,input){
 const fps=Number(project.fps),duration=Number(project.duration);
 if(!Number.isFinite(fps)||fps<=0||!Number.isFinite(duration)||duration<=0)throw new Error('Project time base is invalid.');
 if(!Number.isFinite(input.start)||!Number.isFinite(input.end)||input.start<0||input.end<0||input.start>duration||input.end>duration)throw new Error('Marker times must be finite and inside the video.');
 if(input.end<input.start)throw new Error('Marker range must end at or after its start.');
 const requestedRange=input.end>input.start;
 const snap=value=>Math.min(duration,Math.max(0,Math.round(value*fps)/fps));
 // A point identifies a source frame, never the end-exclusive media boundary.
 // A range may end at the exact duration, including a partial final frame.
 const lastFrame=Math.max(0,Math.ceil(duration*fps-1e-7)-1);
 const start=requestedRange?snap(input.start):Math.min(lastFrame,Math.round(input.start*fps))/fps;
 const end=requestedRange?(input.end===duration?duration:snap(input.end)):start;
 if(requestedRange&&end<=start)throw new Error('Marker range must remain at least one frame after snapping.');
 return {start,end};
}

export function createMarkerService({db,save,getProject,id=()=>randomUUID(),now=()=>new Date().toISOString()}){
 function records(projectId){return db.markers?.[projectId]??[];}
 function list(projectId,owner){getProject(projectId,owner);return records(projectId).map(marker=>({...marker}));}
 function create(projectId,owner,input){
  const project=getProject(projectId,owner);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Marker details are required.');
  const label=text(input.label,'Label',80,true),note=text(input.note??'','Note',1000);
  if(input.baseRevisionId!==project.activeRevisionId)throw new Error('Project revision changed. Save the marker against the current revision.');
  if(typeof input.idempotencyKey!=='string'||!keyPattern.test(input.idempotencyKey))throw new Error('A valid marker idempotency key is required.');
  const {start,end}=normalizedTiming(project,input);
  const fingerprint=JSON.stringify([input.label,input.note??'',input.start,input.end,input.baseRevisionId]);
  const previous=db.markerRequests?.[projectId]?.[input.idempotencyKey];
  if(previous){
   if(previous.fingerprint!==fingerprint)throw new Error('This marker key was already used for different inputs.');
   const marker=records(projectId).find(item=>item.id===previous.markerId);
   if(!marker)throw new Error('The saved marker for this request is unavailable.');
   return {...marker};
  }
  if(records(projectId).length>=200)throw new Error('Project limit: 200 saved markers including archived markers.');
  const marker={id:id(),label,note,start,end,baseRevisionId:input.baseRevisionId,createdAt:now(),archived:false};
  db.markers??={};db.markerRequests??={};db.markers[projectId]??=[];db.markerRequests[projectId]??={};
  db.markers[projectId].push(marker);db.markerRequests[projectId][input.idempotencyKey]={fingerprint,markerId:marker.id};save();
  return {...marker};
 }
 function update(projectId,owner,markerId,input){
  getProject(projectId,owner);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Marker update is required.');
  const keys=Object.keys(input);if(!keys.length)throw new Error('Update at least one marker field.');
  if(keys.some(key=>!['label','note','archived'].includes(key)))throw new Error('Update only label, note, or archived.');
  const changes={};
  if(own(input,'label'))changes.label=text(input.label,'Label',80,true);
  if(own(input,'note'))changes.note=text(input.note,'Note',1000);
  if(own(input,'archived')){if(typeof input.archived!=='boolean')throw new Error('Archived must be true or false.');changes.archived=input.archived;}
  const marker=records(projectId).find(item=>item.id===markerId);if(!marker)throw Object.assign(new Error('Marker not found'),{status:404});
  Object.assign(marker,changes);save();return {...marker};
 }
 return {list,create,update};
}

export function registerMarkerRoutes(app,dependencies){
 const markers=createMarkerService(dependencies);
 app.get('/api/projects/:id/markers',(req,res)=>res.json(markers.list(req.params.id,req.user.id)));
 app.post('/api/projects/:id/markers',(req,res)=>res.status(201).json(markers.create(req.params.id,req.user.id,req.body)));
 app.post('/api/projects/:id/markers/:markerId/update',(req,res)=>res.json(markers.update(req.params.id,req.user.id,req.params.markerId,req.body)));
 return markers;
}
