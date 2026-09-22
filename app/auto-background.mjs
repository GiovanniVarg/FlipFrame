import fs from 'node:fs';
import path from 'node:path';
export function autoBackgroundReady(root){return fs.existsSync(path.join(root,'.segmentation','background-ready.json'))&&fs.existsSync(path.join(root,'.segmentation','background-models','birefnet-general-lite.onnx'));}
export function registerAutoBackground(app,{getProject,ready,enqueue,asyncRoute}){
 app.post('/api/projects/:id/auto-background',asyncRoute(async(req,res)=>{
  const p=getProject(req.params.id,req.user.id);
  if(req.body.baseRevisionId!==p.activeRevisionId)throw new Error('Project revision changed. Select the current video again.');
  if(!Number.isFinite(req.body.time)||req.body.time<0||req.body.time>=p.duration)throw new Error('Choose a frame inside the video.');
  if(!ready())return res.status(503).json({error:'Auto background is not installed. Run setup_auto_background.py with the object-selection Python runtime.'});
  const source=p.revisions.find(r=>r.id===p.activeRevisionId)?.path;
  if(!source)throw new Error('Current video is unavailable.');
  enqueue(p,{kind:'segment',baseRevisionId:p.activeRevisionId,request:{action:'auto_background',source,time:Math.floor(req.body.time*30+1e-6)/30}},res);
 }));
}
