import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';

const prefix='/api/agent/v1';
const digest=value=>createHash('sha256').update(value).digest();
const loopback=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
// Reuse the editor's validated handlers; never expose settings, filesystem paths,
// arbitrary commands, account administration or provider credentials to agents.
export const agentRoutes=[
 ['GET','/capabilities'],['GET','/projects'],['POST','/projects'],
 ['GET','/projects/:id'],['GET','/projects/:id/jobs'],
 ['GET','/projects/:id/conversation'],['POST','/projects/:id/conversation'],
 ['POST','/projects/:id/conversation/plans/:planId/execute'],
 ['POST','/projects/:id/auto-background'],['POST','/projects/:id/segment'],['POST','/projects/:id/track'],
 ['POST','/projects/:id/assets'],['POST','/projects/:id/reference-image'],
 ['POST','/projects/:id/apply'],
 ['GET','/jobs/:id'],['POST','/jobs/:id/cancel'],
 ['GET','/originals'],['POST','/originals'],['GET','/originals/:id'],
 ['POST','/originals/:id/review'],['POST','/originals/:id/generate'],
];
const matches=(route,url)=>new RegExp('^'+route.replace(/:[A-Za-z]+/g,'[A-Za-z0-9_-]+')+'$').test(url);
export function registerAgentApi(app,{dataDir,mode}){
 const tokenFile=path.join(dataDir,'agent-access.json');
 let stored;try{stored=JSON.parse(fs.readFileSync(tokenFile,'utf8'));}catch{}
 const local=(req,res)=>{if(mode!=='local'||!loopback(req.socket.remoteAddress)){res.status(403).json({error:'Agent access is available only on this computer in local mode.'});return false;}return true;};
 app.get('/api/settings/agent',(req,res)=>{if(local(req,res))res.json({enabled:!!stored?.hash,baseUrl:prefix});});
 app.post('/api/settings/agent',(req,res,next)=>{
  if(!local(req,res))return;
  try{
   if(req.body?.enabled===false){fs.rmSync(tokenFile,{force:true});stored=undefined;return res.json({enabled:false});}
   if(req.body?.enabled!==true)return res.status(400).json({error:'Choose enable or disable.'});
   const token=randomBytes(32).toString('base64url'),nextStored={hash:digest(token).toString('hex')};
   fs.writeFileSync(tokenFile,JSON.stringify(nextStored),{mode:0o600});stored=nextStored;
   res.setHeader('Cache-Control','no-store');res.json({enabled:true,token,baseUrl:prefix});
  }catch(error){next(error);}
 });
 app.use((req,res,next)=>{
  if(!req.path.startsWith(prefix))return next();
  if(!local(req,res))return;
  res.setHeader('Cache-Control','no-store');
  const authorization=req.headers.authorization||'';
  if(!/^Bearer [A-Za-z0-9_-]+$/i.test(authorization))return res.status(401).json({error:'A valid FlipFrame agent bearer token is required.'});
  const token=authorization.slice(7);
  const hash=stored?.hash&&Buffer.from(stored.hash,'hex');
  if(!hash||hash.length!==32||!timingSafeEqual(digest(token),hash))return res.status(401).json({error:'A valid FlipFrame agent bearer token is required.'});
  const endpoint=req.path.slice(prefix.length);
  if(req.method==='GET'&&endpoint==='/discovery')return res.json({name:'FlipFrame',version:1,routes:agentRoutes.map(([method,path])=>({method,path:prefix+path})),workflow:['Read project and activeRevisionId','Send instruction with a unique idempotencyKey','Inspect requestedPlanId and its requirements','Execute the plan with the same baseRevisionId','Poll job; review result before applying'],limits:{sourceBytes:2147483648,sourceSeconds:3600,trackingSeconds:10},documentation:'/agent-api.md',credentials:'Provider keys are never returned. The agent token grants access to local projects and enabled generation.'});
  if(!agentRoutes.some(([method,route])=>method===req.method&&matches(route,endpoint)))return res.status(404).json({error:'Unsupported agent operation. Read /discovery.'});
  req.url='/api'+req.url.slice(prefix.length);
  next();
 });
}
