import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseEnv} from 'node:util';
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
const managedPrefix='# FlipFrame managed settings: ';
function readEnvironment(ROOT){
 const file=path.join(ROOT,'.env.local');if(!fs.existsSync(file))return '';
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new Error('Invalid local environment file');
 return fs.readFileSync(file,'utf8');
}
function environmentBlocks(text){
 const lines=text.split(/\r?\n/),blocks=[];
 for(let i=0;i<lines.length;i++){
  const block={lines:[lines[i]]},match=lines[i].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if(match){block.key=match[1];const rhs=match[2],quote=['"',"'",'`'].includes(rhs[0])?rhs[0]:null;
   if(quote&&rhs.indexOf(quote,1)<0){let closed=false;while(i+1<lines.length){i++;block.lines.push(lines[i]);if(lines[i].includes(quote)){closed=true;break;}}if(!closed)throw new Error('Unclosed quoted environment value');}
  }
  blocks.push(block);
 }return blocks;
}
function managedKeys(text){
 const block=environmentBlocks(text).find(block=>!block.key&&block.lines[0].startsWith(managedPrefix));if(!block)return [];
 try{const keys=JSON.parse(block.lines[0].slice(managedPrefix.length));if(!Array.isArray(keys)||keys.some(key=>!fields.includes(key)))throw Error();return keys;}catch{throw new Error('Invalid managed settings metadata');}
}
function serializeValue(value){
 for(const quote of ['"',"'",'`'])if(!value.includes(quote)){const serialized=quote+value+quote;if(parseEnv('VALUE='+serialized).VALUE===value)return serialized;}
 throw invalid('A setting cannot contain all three quote styles.');
}
// Keep unrelated assignments/comments verbatim. Replace a complete quoted assignment,
// including an older multiline value, so no leftover lines become environment entries.
function updateEnvironment(text,patch){
 const keys=[...new Set([...managedKeys(text),...Object.keys(patch)])];
 const output=[],written=new Set();
 for(const block of environmentBlocks(text)){
  if(!block.key&&block.lines[0].startsWith(managedPrefix))continue;
  if(!block.key||!Object.hasOwn(patch,block.key)){output.push(...block.lines);continue;}
  if(!written.has(block.key)){output.push(block.key+'='+serializeValue(patch[block.key]));written.add(block.key);}
 }
 while(output.length&&output.at(-1)==='')output.pop();
 for(const [key,value] of Object.entries(patch))if(!written.has(key))output.push(key+'='+serializeValue(value));
 output.push(managedPrefix+JSON.stringify(keys));return output.join('\n')+'\n';
}
// Legacy per-field settings remain effective until that field is saved into .env.local.
export function loadRuntimeSettings(ROOT,env=process.env){
 const text=readEnvironment(ROOT),parsed=parseEnv(text),managed=managedKeys(text);
 const dir=path.join(ROOT,'.local-settings'),patch={};
 if(fs.existsSync(dir)){
  if(fs.lstatSync(dir).isSymbolicLink())throw new Error('Invalid settings directory');
  for(const key of fields){if(managed.includes(key))continue;const file=path.join(dir,key);if(!fs.existsSync(file))continue;const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw new Error('Invalid saved setting');patch[key]=fs.readFileSync(file,'utf8');}
 }
 for(const key of managed){if(!Object.hasOwn(parsed,key))throw new Error('Missing managed setting');patch[key]=parsed[key];}
 Object.assign(env,validateSettings(patch,{credentials:false}));
}
export function createSettingsStore({ROOT,env=process.env}){return {snapshot:()=>publicSettings(env),save(input){
 const patch=validateSettings(input);if(!Object.keys(patch).length)return publicSettings(env);
 const original=readEnvironment(ROOT),text=updateEnvironment(original,patch);
 // Verify dotenv round-trips exactly before committing. Never return file contents.
 const parsed=parseEnv(text);for(const [key,value] of Object.entries(patch))if(parsed[key]!==value)throw invalid('This setting cannot be saved as environment text.');
 for(const [key,value] of Object.entries(parseEnv(original)))if(!Object.hasOwn(patch,key)&&parsed[key]!==value)throw new Error('Unrelated environment value changed');
 const target=path.join(ROOT,'.env.local'),temporary=path.join(ROOT,`.env.local.${randomUUID()}.tmp`);
 try{fs.writeFileSync(temporary,text,{mode:0o600,flag:'wx'});fs.renameSync(temporary,target);}
 catch{try{fs.rmSync(temporary,{force:true});}catch{}throw new Error('Could not save local settings.');}
 Object.assign(env,patch);return publicSettings(env);
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
