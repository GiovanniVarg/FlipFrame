import fs from 'node:fs';
import {compatibleMasks} from './mask-corrections.mjs';
import {validateProtectedAreas} from './local-candidate-repair.mjs';
import {validateEdit} from './domain.mjs';

export function transformationSources(db,p){
 const sources=[];
 for(const j of Object.values(db.jobs||{})){
  const g=j.generation;
  if(j.projectId===p.id&&g?.baseRevisionId===p.activeRevisionId&&(g.providerState||j.providerState)?.status==='completed'&&g.paths?.raw&&fs.existsSync(g.paths.raw))
   sources.push({id:'job:'+j.id,label:'Generated footage · '+(j.createdAt||'').slice(0,16),path:g.paths.raw,origin:g.processStart});
 }
 for(const a of Object.values(db.assets||{}))if(a.projectId===p.id&&fs.existsSync(a.path)&&/\.(mp4|mov|webm|mkv)$/i.test(a.path))sources.push({id:'asset:'+a.id,label:a.name||'Imported replacement',path:a.path,origin:0});
 return sources;
}
export function validateTransformation(p,input){
 if(input.reviewed!==true)throw new Error('Review the replacement tracking and repair area first.');
 const mode=input.mode||'aligned';
 if(!['aligned','foreground','scene'].includes(mode))throw new Error('Choose a supported transformation mode.');
 if(mode==='scene'){
  if(input.sceneApproved!==true)throw new Error('Explicitly approve changes to the whole scene, including camera and background.');
  const range=validateEdit(p,{...input,operation:'picture'});
  if(range.end-range.start>10||!Number.isFinite(input.candidateOffset)||input.candidateOffset<0)throw new Error('Choose an available replacement offset and range up to ten seconds.');
  return {mode,start:range.start,end:range.end,candidateOffset:input.candidateOffset,cameraPolicy:'fixed',reviewed:true,sceneApproved:true};
 }
 const placement=input.placement||{scale:1,x:0,y:0};
 if(mode==='foreground'&&(!Number.isFinite(placement.scale)||placement.scale<.25||placement.scale>3||!Number.isFinite(placement.x)||Math.abs(placement.x)>1||!Number.isFinite(placement.y)||Math.abs(placement.y)>1))throw new Error('Choose a valid foreground scale and position.');

 if(!['fixed','align'].includes(input.cameraPolicy))throw new Error('Choose keep camera or align camera.');
 for(const masks of [input.masks,input.replacementMasks]){if(!Array.isArray(masks)||!masks.length||masks.length>300||masks.some(m=>!Array.isArray(m.points)||m.points.length<3||m.points.length>500||m.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1))))throw new Error('Invalid transformation mask track.');}
 input={...input,masks:compatibleMasks(input.masks),replacementMasks:compatibleMasks(input.replacementMasks)};
 const old=validateEdit(p,{...input,operation:'object',scope:'range',visibleRanges:undefined});
 const replacement=validateEdit(p,{...input,operation:'object',scope:'range',visibleRanges:undefined,masks:input.replacementMasks});
 if(old.end-old.start>10)throw new Error('Transformation preview supports up to ten seconds.');
 for(const track of [old.masks,replacement.masks])for(let f=Math.round(old.start*30);f<Math.round(old.end*30);f++)if(!track.some(m=>Math.abs(m.time-f/30)<1e-5))throw new Error('Both tracks need a reviewed border for every selected frame. Shorten the range or correct missing borders.');
 const poly=input.envelope;
 if(!Array.isArray(poly)||poly.length<3||poly.length>256||poly.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('Draw the permitted repair area.');
 if(!Number.isFinite(input.candidateOffset)||input.candidateOffset<0)throw new Error('Invalid replacement time offset.');
 return {mode,placement:{scale:placement.scale,x:placement.x,y:placement.y},start:old.start,end:old.end,masks:old.masks,replacementMasks:replacement.masks,envelope:poly,protectedAreas:validateProtectedAreas(input.protectedAreas),cameraPolicy:input.cameraPolicy,candidateOffset:input.candidateOffset,reviewed:true};
}
export function registerTransformationRoutes(app,{db,projectById,asyncRoute,enqueue,mediaPath,id,candidateCapacity}){
 const source=(p,key)=>{const s=transformationSources(db,p).find(s=>s.id===key);if(!s)throw new Error('Replacement footage is unavailable for this project revision.');return s;};
 app.get('/api/projects/:id/transformation/sources',asyncRoute(async(req,res)=>{const p=projectById(req.params.id,req.user.id);res.json(transformationSources(db,p).map(({path,...s})=>({...s,url:`/api/projects/${p.id}/transformation/media?source=${encodeURIComponent(s.id)}`})));}));
 app.get('/api/projects/:id/transformation/media',asyncRoute(async(req,res)=>{const p=projectById(req.params.id,req.user.id),s=source(p,req.query.source);res.setHeader('Cache-Control','private, no-store');res.sendFile(s.path);}));
 app.post('/api/projects/:id/transformation/track',asyncRoute(async(req,res)=>{
  const p=projectById(req.params.id,req.user.id),input=req.body,s=source(p,input.sourceId);
  const range=validateEdit(p,{...input,operation:'mute'});
  if(range.end-range.start>10||!Number.isFinite(input.candidateOffset)||input.candidateOffset<0||!Number.isFinite(input.time)||input.time<range.start||input.time>=range.end)throw new Error('Choose a reference frame inside a range up to ten seconds.');
  if(!Array.isArray(input.points)||input.points.length<3||input.points.length>256||input.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('Outline the replacement first.');
  enqueue(p,{kind:'segment',baseRevisionId:p.activeRevisionId,request:{action:'transformation_track',source:s.path,start:range.start,end:range.end,candidateOffset:input.candidateOffset,time:input.time,points:input.points}},res);
 }));
 app.post('/api/projects/:id/transformation/render',asyncRoute(async(req,res)=>{
  const p=projectById(req.params.id,req.user.id),s=source(p,req.body.sourceId),input=validateTransformation(p,req.body);
  candidateCapacity(p.id);
  const request={...input,action:'transformation',operation:'object',source:p.revisions.find(r=>r.id===p.activeRevisionId).path,candidate:s.path,output:mediaPath(id(),'webm'),reviewOutput:mediaPath(id(),'webm')};
  enqueue(p,{kind:'render',baseRevisionId:p.activeRevisionId,candidateId:id(),request},res);
 }));
}
