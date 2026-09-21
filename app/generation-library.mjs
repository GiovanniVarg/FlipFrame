import fs from 'node:fs';
function records(db,owner){
 const project=id=>db.projects?.[id]?.ownerId===owner?db.projects[id]:null;
 return [
 ...Object.values(db.jobs||{}).filter(j=>j.generation&&project(j.projectId)).map(j=>({id:'job:'+j.id,kind:'Generated edit',projectId:j.projectId,projectName:project(j.projectId).name,prompt:j.generation.prompt||'',status:j.status,error:j.error,billing:j.billing,createdAt:j.createdAt,path:j.generation.paths?.raw,baseRevisionId:j.generation.baseRevisionId})),
 ...Object.values(db.originals||{}).filter(d=>d.ownerId===owner).map(d=>({id:'original:'+d.id,kind:'Original generation',projectId:d.projectId,projectName:project(d.projectId)?.name,prompt:d.input?.prompt||'',status:d.status,error:d.error,billing:d.billing,createdAt:d.createdAt,path:d.rawPath&&fs.existsSync(d.rawPath)?d.rawPath:project(d.projectId)?.sourcePath})),
 ...Object.values(db.candidates||{}).filter(c=>project(c.projectId)).map(c=>({id:'candidate:'+c.id,kind:'Finished candidate',projectId:c.projectId,projectName:project(c.projectId).name,prompt:c.name||c.label||'',status:'completed',createdAt:c.createdAt,path:c.path,baseRevisionId:c.baseRevisionId}))];
}
export function generationEntries(db,owner){return records(db,owner).map(({path,...r})=>({...r,available:!!path&&fs.existsSync(path),url:path&&fs.existsSync(path)?'/api/generation-library/media/'+encodeURIComponent(r.id):undefined})).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));}
export function registerGenerationLibrary(app,{db,asyncRoute}){
 app.get('/api/generation-library',(req,res)=>res.json(generationEntries(db,req.user.id)));
 app.get('/api/generation-library/media/:key',asyncRoute(async(req,res)=>{const r=records(db,req.user.id).find(r=>r.id===req.params.key);if(!r?.path||!fs.existsSync(r.path))return res.status(404).json({error:'Saved generation media is unavailable.'});res.setHeader('Cache-Control','private, no-store');res.sendFile(r.path);}));
}
