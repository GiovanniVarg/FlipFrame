import {releaseProviderFailure} from './provider-refunds.mjs';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {reserve} from './budget.mjs';
export function validateOriginal(input){
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>3000)throw new Error('Describe your video in 1–3000 characters.');
 if(![5,10].includes(input.duration))throw new Error('Choose 5 or 10 seconds.');
 if(!['16:9','9:16','1:1'].includes(input.aspectRatio))throw new Error('Choose a supported frame shape.');
 return {prompt:input.prompt.trim(),duration:input.duration,aspectRatio:input.aspectRatio,resolution:'720p',generateAudio:true};
}
export function createOriginalService({db,save,adapter,mediaPath,mediaUrl,runMedia,download,importProject,budgetLimit,schedule,storageAvailable=()=>{},pause=()=>new Promise(r=>setTimeout(r,3000))}){
 db.originals??={};const locks=new Map();
 for(const d of Object.values(db.originals))if(d.status==='running'){d.status=d.submitting&&!d.provider?'unknown':'queued';}save();
 const own=(id,owner)=>{const d=db.originals[id];if(!d||d.ownerId!==owner)throw Object.assign(new Error('Video request not found'),{status:404});return d;};
 const safe=d=>({id:d.id,input:d.input,status:d.status,phase:d.phase,error:d.error,estimate:d.quote?.estimatedUsd,hold:d.hold,projectId:d.projectId,references:d.references.map(r=>({id:r.id,name:r.name,url:mediaUrl(r.path)})),createdAt:d.createdAt,canResume:d.status==='failed'&&!!d.provider?.requestId&&!['failed','nsfw','canceled'].includes(d.provider.status)});
 async function exclusive(id,fn){if(locks.has(id))return locks.get(id);const task=fn();locks.set(id,task);try{return await task}finally{locks.delete(id)}}
 const request=d=>({...d.input,kind:d.references.length?'reference-to-video':'text-to-video',...(d.references.length?{imageUrls:d.references.map(r=>r.providerUrl)}:{}),pricingDimensions:{width:d.input.aspectRatio==='1:1'?720:d.input.aspectRatio==='9:16'?720:1280,height:d.input.aspectRatio==='16:9'?720:d.input.aspectRatio==='1:1'?720:1280,inputSeconds:0,outputSeconds:d.input.duration}});
 async function quote(d){for(const r of d.references)if(!r.providerUrl){r.providerUrl=await adapter.uploadAsset(fs.readFileSync(r.path),'image/png');save();}return adapter.estimateGeneration(request(d));}
 return {safe,own,list:owner=>Object.values(db.originals).filter(d=>d.ownerId===owner).map(safe).reverse(),
 create(owner,input){if(Object.values(db.projects).filter(p=>p.ownerId===owner).length>=20)throw new Error('Project limit reached. Archive unused projects before generating.');if(Object.values(db.originals).filter(d=>d.ownerId===owner).length>=100)throw new Error('Video request limit reached.');const d={id:randomUUID(),ownerId:owner,input:validateOriginal(input),references:[],status:'draft',createdAt:new Date().toISOString()};db.originals[d.id]=d;save();return safe(d)},
 async attach(id,owner,file){const d=own(id,owner);return exclusive(id,async()=>{if(d.status!=='draft'||d.references.length>=4)throw new Error('Attach up to four images before reviewing cost.');storageAvailable(file.size||0);const key=randomUUID(),output=mediaPath(key,'png');try{await runMedia({action:'prepare_reference',source:file.path,output});storageAvailable();d.references.push({id:key,name:file.originalname.slice(0,200),path:output});save();return safe(d)}catch(e){fs.rmSync(output,{force:true});throw e}})},
 async review(id,owner){const d=own(id,owner);return exclusive(id,async()=>{if(!['draft','review'].includes(d.status))throw new Error('This request has already started.');d.quote=await quote(d);reserve(db.spend,budgetLimit(),d.quote.estimatedUsd);d.status='review';save();return safe(d)})},
 async generate(id,owner){const d=own(id,owner);return exclusive(id,async()=>{if(['queued','running','completed'].includes(d.status))return safe(d);if(d.status!=='review')throw new Error('Review the cost first.');if(Object.values(db.originals).some(x=>x.status==='unknown')||Object.values(db.jobs||{}).some(x=>x.status==='unknown'))throw new Error('Reconcile the earlier uncertain provider request before starting another.');const fresh=await quote(d);if(fresh.estimatedUsd>d.quote.estimatedUsd){d.quote=fresh;save();throw new Error('The estimate increased. Review the new amount before generating.');}db.spend=reserve(db.spend,budgetLimit(),fresh.estimatedUsd);d.hold=Math.ceil(fresh.estimatedUsd*2*1e6)/1e6;d.quote=fresh;d.status='queued';save();schedule();return safe(d)})},
 resume(id,owner){const d=own(id,owner);if(!safe(d).canResume)throw new Error('This request cannot be safely resumed.');d.status='queued';delete d.error;save();schedule();return safe(d)},
 async run(d){return exclusive(d.id,async()=>{try{
 d.status='running';d.phase='Generating your original video';save();
 if(!d.provider){if(!d.submitting&&Date.now()-Date.parse(d.quote?.quotedAt||'')>300000){db.spend.reserved=Math.max(0,db.spend.reserved-d.hold);d.hold=0;d.status='review';d.error='The cost review expired while queued. Review the amount and generate again; no request was submitted.';save();return safe(d);}if(d.submitting){d.status='unknown';throw new Error('Provider acceptance is uncertain. Check its request history; do not generate again.');}d.submitting=true;save();d.provider=await adapter.submitGeneration(request(d));save();}
 if(d.provider.status==='failed'&&!d.provider.requestId){db.spend.reserved=Math.max(0,db.spend.reserved-d.hold);d.hold=0;save();}
 for(let i=0;['queued','in_progress','running'].includes(d.provider.status)&&i<300;i++){await pause();d.provider=await adapter.pollGeneration(d.provider);save();}
 releaseProviderFailure(db,d,d.provider);
 if(d.provider.status!=='completed'){if(d.provider.status==='unknown')d.status='unknown';throw new Error(d.provider.error||'Generation has not completed. Resume the existing request; do not submit again.');}
 d.phase='Preparing your editable timeline';save();
 let p=Object.values(db.projects).find(p=>p.originalGenerationId===d.id);
 if(!p){const target=d.rawPath||mediaPath(d.id+'-download');if(!d.rawDownloaded||!fs.existsSync(target)){storageAvailable();await download(d.provider.outputUrl,target);d.rawPath=target;d.rawDownloaded=true;save();}const imported=mediaPath(d.id+'-import');storageAvailable(fs.statSync(target).size);fs.copyFileSync(target,imported);p=await importProject({path:imported,originalname:'Generated video.mp4',size:fs.statSync(imported).size},d.ownerId,{originalGenerationId:d.id,originalPrompt:d.input.prompt});}
 d.projectId=p.id;d.status='completed';d.phase='Your video is ready to edit';delete d.error;save();
 }catch(e){if(d.status!=='unknown')d.status='failed';d.error=e.message;save();}return safe(d)})}
 };
}
export function registerOriginalRoutes(app,{service,upload,asyncRoute}){
 app.get('/api/originals',(req,res)=>res.json(service.list(req.user.id)));
 app.post('/api/originals',asyncRoute(async(req,res)=>res.status(201).json(service.create(req.user.id,req.body))));
 app.get('/api/originals/:id',(req,res,next)=>{try{res.json(service.safe(service.own(req.params.id,req.user.id)))}catch(e){next(e)}});
 app.post('/api/originals/:id/references',upload.single('file'),asyncRoute(async(req,res)=>{try{if(!req.file)throw new Error('Choose a reference image.');res.json(await service.attach(req.params.id,req.user.id,req.file));}finally{if(req.file)fs.rmSync(req.file.path,{force:true})}}));
 for(const action of ['review','generate','resume'])app.post('/api/originals/:id/'+action,asyncRoute(async(req,res)=>res.json(await service[action](req.params.id,req.user.id))));
}
