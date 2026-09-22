import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const secrets=['LLM_API_KEY','TYPESAFE_API_KEY','HF_CREDENTIALS'];
const choices={SAM2_DEVICE:['auto','cpu','cuda'],REASONING_PROVIDER:['jev','openai-compatible','anthropic','gemini'],VIDEO_PROVIDER:['higgsfield']};
const defaults={HIGGSFIELD_TEST_BUDGET_USD:'0',SAM2_DEVICE:'auto',REASONING_PROVIDER:'jev',VIDEO_PROVIDER:'higgsfield',LLM_BASE_URL:'',LLM_MODEL:''};
const fields=[...Object.keys(defaults),...secrets];
const invalid=message=>Object.assign(new Error(message),{status:400});
function usable(value){
 if(typeof value!=='string')return false;
 const text=value.trim();
 if(!text||/[\s<>]/.test(text))return false;
 return !/^(?:your[-_ ]?(?:api[-_]?)?(?:key|secret|token|model)(?:[-_](?:id|secret|here))?|(?:api[-_])?key[-_]?(?:id|secret)|replace[-_]?me|change[-_]?me|placeholder|example|example[-_](?:key|secret|token)|sk[-_]your[-_](?:api[-_])?key|paste[-_].*|todo)$/i.test(text);
}
function keyPair(value){if(typeof value!=='string')return false;const parts=value.trim().split(':');return parts.length===2&&parts.every(usable);}
export function settingsReadiness(env={}){
 const provider=env.REASONING_PROVIDER||'jev';
 let assistant=false;
 if(provider==='jev')assistant=usable(env.TYPESAFE_API_KEY);
 else if(['openai-compatible','anthropic','gemini'].includes(provider)){
  assistant=usable(env.LLM_API_KEY)&&usable(env.LLM_MODEL);
  if(provider==='openai-compatible'){
   try{assistant=assistant&&usable(env.LLM_BASE_URL)&&Boolean(validateSettings({LLM_BASE_URL:env.LLM_BASE_URL}).LLM_BASE_URL);}catch{assistant=false;}
  }
 }
 const video=env.HF_CREDENTIALS?.trim()?keyPair(env.HF_CREDENTIALS):usable(env.HIGGSFIELD_API_KEY)&&usable(env.HIGGSFIELD_API_SECRET);
 return {assistant,video};
}
export function publicSettings(env=process.env){const values={...defaults};for(const key of Object.keys(defaults)){try{Object.assign(values,validateSettings({[key]:env[key]||defaults[key]}));}catch{}}const readiness=settingsReadiness(env);return {values,configured:{LLM_API_KEY:usable(env.LLM_API_KEY),TYPESAFE_API_KEY:usable(env.TYPESAFE_API_KEY),HF_CREDENTIALS:readiness.video},choices,readiness};}
export function validateSettings(input,{credentials=true}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw invalid('Settings must be an object.');
 const patch={};
 for(const [key,raw] of Object.entries(input)){
  if(!fields.includes(key))throw invalid('Unknown setting.');
  if(typeof raw!=='string'||raw.length>4096||/[\r\n\0]/.test(raw))throw invalid('Settings must be single-line text.');
  const value=raw.trim();if(secrets.includes(key)&&!value)continue;
  if(credentials&&key==='HF_CREDENTIALS'&&!keyPair(value))throw invalid('Enter your Higgsfield key ID and secret separated by a colon.');
  if(credentials&&secrets.includes(key)&&key!=='HF_CREDENTIALS'&&!usable(value))throw invalid('Enter your own API key, not an example value.');
  if(choices[key]&&!choices[key].includes(value))throw invalid('Unsupported setting choice.');
  if(key==='LLM_BASE_URL'&&value){let url;try{url=new URL(value);}catch{throw invalid('Enter a valid model server URL.');}
   if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.search||url.hash)throw invalid('Use HTTPS, or HTTP on localhost, without credentials or query parameters.');}
  if(key==='HIGGSFIELD_TEST_BUDGET_USD'&&(!/^\d+(?:\.\d{1,2})?$/.test(value)||!Number.isFinite(Number(value))))throw invalid('Enter a nonnegative USD budget.');
  patch[key]=value;
 }return patch;
}
function directory(ROOT){const dir=path.join(ROOT,'.local-settings');fs.mkdirSync(dir,{recursive:true,mode:0o700});const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Invalid settings directory');return dir;}
// Runtime-only loader. Values never leave the server; original .env files remain untouched.
export function loadRuntimeSettings(ROOT,env=process.env){
 const dir=path.join(ROOT,'.local-settings');if(!fs.existsSync(dir))return;
 if(fs.lstatSync(dir).isSymbolicLink())throw new Error('Invalid settings directory');
 const patch={};for(const key of fields){const file=path.join(dir,key);if(!fs.existsSync(file))continue;const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw new Error('Invalid saved setting');patch[key]=fs.readFileSync(file,'utf8');}
 Object.assign(env,validateSettings(patch,{credentials:false}));
}
export function createSettingsStore({ROOT,env=process.env}){return {snapshot:()=>publicSettings(env),save(input){
 const patch=validateSettings(input);if(!Object.keys(patch).length)return publicSettings(env);
 const dir=directory(ROOT);
 // Each submitted field is atomically replaced. No existing credential file is opened.
 for(const [key,value] of Object.entries(patch)){
  const temporary=path.join(dir,`.${key}.${randomUUID()}.tmp`);const target=path.join(dir,key);
  try{fs.writeFileSync(temporary,value,{mode:0o600,flag:'wx'});fs.renameSync(temporary,target);env[key]=value;}
  catch{try{fs.rmSync(temporary,{force:true});}catch{}throw new Error('Could not save local settings.');}
 }return publicSettings(env);
}};}
export function registerRuntimeSettings(app,{ROOT,MODE,asyncRoute,env=process.env,probeHardware}){
 const store=createSettingsStore({ROOT,env});
 const local=(req,res,next)=>{res.setHeader('Cache-Control','no-store');if(MODE!=='local'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return res.status(403).json({error:'Connection settings are available only in local mode.'});next();};
 app.get('/api/settings',local,(req,res)=>res.json(store.snapshot()));
 app.post('/api/settings',local,asyncRoute(async(req,res)=>{
  if(!req.is('application/json'))return res.status(415).json({error:'Send settings as JSON.'});
  if(req.headers.origin&&req.headers.origin!==`${req.protocol}://${req.headers.host}`)return res.status(403).json({error:'Origin blocked'});
  try{res.json(store.save(req.body));}catch(error){res.status(error.status||500).json({error:error.status===400?error.message:'Could not save local settings.'});}
 }));
 app.get('/api/settings/hardware',local,asyncRoute(async(req,res)=>{try{if(!probeHardware)throw new Error();res.json(await probeHardware());}catch{res.json({cpu:{available:true},cuda:{available:false},devices:['cpu'],error:'GPU detection is unavailable. CPU remains available.'});}}));
 return store;
}
