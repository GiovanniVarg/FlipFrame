import fs from 'node:fs';
export function ownedReference(db,projectId,id){
 if(id===undefined||id==='')return undefined;
 if(typeof id!=='string')throw new Error('Invalid reference image');
 const asset=db.assets?.[id];if(!asset||asset.projectId!==projectId||asset.kind!=='reference-image')throw new Error('Choose a reference image from this project.');
 return {id:asset.id,url:asset.url,name:asset.name};
}
export function registerReferenceImages(app,{upload,db,save,projectById,storageAvailable,id,mediaPath,mediaUrl,runMedia,asyncRoute}){
 app.post('/api/projects/:id/reference-image',upload.single('file'),asyncRoute(async(req,res)=>{
  let output,key;
  try{
   projectById(req.params.id,req.user.id);
   if(!req.file||req.file.size>10*1024*1024)throw new Error('Choose an image up to 10 MB.');
   storageAvailable(req.file.size);
   if(Object.values(db.assets).filter(a=>a.projectId===req.params.id).length>=20)throw new Error('Project asset limit reached.');
   key=id();output=mediaPath(key,'png');const info=await runMedia({action:'prepare_reference',source:req.file.path,output});
   storageAvailable(fs.statSync(output).size);
   const asset={id:key,projectId:req.params.id,path:output,url:mediaUrl(output),name:req.file.originalname.slice(0,200),kind:'reference-image',mimeType:'image/png',...info};
   db.assets[key]=asset;save();res.json(ownedReference(db,req.params.id,key));
  }catch(e){if(key)delete db.assets[key];if(output)fs.rmSync(output,{force:true});throw e;}finally{if(req.file)fs.rmSync(req.file.path,{force:true});}
 }));
}
