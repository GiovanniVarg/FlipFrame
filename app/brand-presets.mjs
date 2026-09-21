import {randomUUID} from 'node:crypto';
import {ownedReference} from './reference-images.mjs';
export function createBrandPresets({db,save,getProject,copyReference}){
 const list=(pid,owner)=>{const p=getProject(pid,owner);return Object.values(p.brandPresets||{}).map(x=>({...x,referenceImage:ownedReference(db,pid,x.referenceImageId)}));};
 const create=(pid,owner,input)=>{const p=getProject(pid,owner);if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>60||typeof input.instructions!=='string'||!input.instructions.trim()||input.instructions.trim().length>1500)throw Error('Use a name (1–60 characters) and style instructions (1–1500 characters).');
 if(Object.keys(p.brandPresets||{}).length>=30)throw Error('This project already has 30 presets.');
 const reference=ownedReference(db,pid,input.referenceImageId);const preset={id:randomUUID(),name:input.name.trim(),instructions:input.instructions.trim(),referenceImageId:reference?.id,createdAt:new Date().toISOString()};
 const before=p.brandPresets;p.brandPresets={...before,[preset.id]:preset};try{save()}catch(e){p.brandPresets=before;throw e}return {...preset,referenceImage:reference};};
 const update=(pid,owner,key,input)=>{const p=getProject(pid,owner),old=p.brandPresets?.[key];if(!old)throw Error('Preset not found');
 if(input.deleted!==undefined){if(typeof input.deleted!=='boolean')throw Error('Invalid deletion setting');const before=p.brandPresets;p.brandPresets={...before,[key]:{...old,deleted:input.deleted}};try{save()}catch(e){p.brandPresets=before;throw e}return list(pid,owner).find(x=>x.id===key)}
 if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>60||typeof input.instructions!=='string'||!input.instructions.trim()||input.instructions.trim().length>1500)throw Error('Enter a name and style instructions within the limits.');
 const ref=input.referenceImageId===undefined?old.referenceImageId:input.referenceImageId;ownedReference(db,pid,ref);const before=p.brandPresets;p.brandPresets={...before,[key]:{...old,name:input.name.trim(),instructions:input.instructions.trim(),referenceImageId:ref||undefined}};try{save()}catch(e){p.brandPresets=before;throw e}return list(pid,owner).find(x=>x.id===key);};
 const catalog=owner=>Object.values(db.projects).filter(p=>p.ownerId===owner&&!p.deletedAt).flatMap(p=>list(p.id,owner).filter(x=>!x.deleted).map(x=>({...x,projectId:p.id,projectName:p.name})));
 const copy=(pid,owner,sourceId,key)=>{getProject(pid,owner);const from=getProject(sourceId,owner),preset=from.brandPresets?.[key];if(!preset||preset.deleted)throw Error('Preset unavailable');let asset;try{if(preset.referenceImageId){ownedReference(db,sourceId,preset.referenceImageId);asset=copyReference(db.assets[preset.referenceImageId],pid);db.assets[asset.id]=asset;}return create(pid,owner,{...preset,referenceImageId:asset?.id})}catch(e){if(asset){delete db.assets[asset.id];asset.cleanup?.()}throw e}};
 return {list,create,update,catalog,copy};
}
export function registerBrandPresets(app,deps){const service=createBrandPresets(deps);
 app.get('/api/brand-presets',(req,res,next)=>{try{res.json(service.catalog(req.user.id))}catch(e){next(e)}});
 app.post('/api/projects/:id/brand-presets/copy',(req,res,next)=>{try{res.json(service.copy(req.params.id,req.user.id,req.body.projectId,req.body.presetId))}catch(e){next(e)}});
 app.post('/api/projects/:id/brand-presets/:presetId',(req,res,next)=>{try{res.json(service.update(req.params.id,req.user.id,req.params.presetId,req.body))}catch(e){next(e)}});
app.get('/api/projects/:id/brand-presets',(req,res,next)=>{try{res.json(service.list(req.params.id,req.user.id))}catch(e){next(e)}});app.post('/api/projects/:id/brand-presets',(req,res,next)=>{try{res.json(service.create(req.params.id,req.user.id,req.body))}catch(e){next(e)}});}
