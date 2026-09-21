// Server-only Seedance 2.5 example. Run with Node 24: npm run example:seedance
// Official references: https://docs.higgsfield.ai/docs/how-to/sdk
// https://console.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference
import { loadEnvFile } from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHiggsfieldClient, AuthenticationError, APIError } from '@higgsfield/client/v2';

export const model = 'bytedance/seedance-2.5/text-to-video';
export const input = Object.freeze({prompt:'A cinematic scene at sunset',duration:5,resolution:'720p',aspect_ratio:'16:9',output_format:'mp4',generate_audio:true});
type Result = {status:string;request_id?:string;video?:{url?:string}};
export function completedUrl(result:Result):string {
 if(result.status!=='completed')throw new Error(['failed','canceled','cancelled','nsfw','moderated'].includes(result.status)?`Generation ${result.status}; no successful video.`:'Generation has not completed.');
 if(!result.video?.url)throw new Error('Completed response contained no video URL.');
 const url=new URL(result.video.url);
 if(url.protocol!=='https:'||url.username||url.password)throw new Error('Invalid generated video URL.');
 return url.href;
}
export async function waitForCompletion(initial:Result,poll:(id:string)=>Promise<Result>,pause=()=>new Promise<void>(r=>setTimeout(r,2000)),maxPolls=450):Promise<string>{
 let result=initial;const requestId=initial.request_id;
 for(let attempt=0;;attempt++){
  if(!['queued','in_progress'].includes(result.status))return completedUrl(result);
  if(!requestId||! /^[a-zA-Z0-9_-]{1,128}$/.test(requestId))throw new Error('No valid request ID; inspect provider history before retrying.');
  if(attempt>=maxPolls)throw new Error('Polling timed out; the provider may still be running. Do not resubmit.');
  await pause();result=await poll(requestId);
  if(result.request_id!==requestId)throw new Error('Provider request ID mismatch.');
 }
}
export async function main(){
 const root=dirname(fileURLToPath(import.meta.url));
 // Node loads the local secret at runtime. Never print environment or SDK error objects.
 try{loadEnvFile(join(root,'.env.local'));}catch{console.error('Create .env.local and enter HF_CREDENTIALS locally. No request sent.');process.exitCode=1;return;}
 if(!process.env.HF_CREDENTIALS||! /^[^:\s]+:[^:\s]+$/.test(process.env.HF_CREDENTIALS)){console.error('Set HF_CREDENTIALS in .env.local as key-id:key-secret. No request sent.');process.exitCode=1;return;}
 const folder=join(root,'data');mkdirSync(folder,{recursive:true});
 const journal=join(folder,'seedance-sdk-example.json');
 const previous=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):null;
 if(previous?.status==='completed'){console.log(completedUrl(previous));return;}
 if(previous&&!previous.request_id){console.error('A previous submission may have been accepted. Check provider history before another billable request.');process.exitCode=1;return;}
 const persist=(result:Result)=>writeFileSync(journal,JSON.stringify({status:result.status,request_id:result.request_id,video:result.video},null,2));
 try{
  const client=createHiggsfieldClient({credentials:process.env.HF_CREDENTIALS,maxRetries:0,timeout:120000});
  let initial:Result;
  if(previous){initial=previous;}
  else{
   writeFileSync(journal,JSON.stringify({status:'submission-unknown'}),{flag:'wx'});
   // v0.2.6 built-in polling omits canceled; explicit GET polling handles all terminals.
   initial=await client.subscribe(model,{input,withPolling:false});
   persist(initial);
  }
  const url=await waitForCompletion(initial,async requestId=>{
   const response=await fetch(`https://api.higgsfield.ai/requests/${encodeURIComponent(requestId)}/status`,{headers:{Authorization:`Key ${process.env.HF_CREDENTIALS}`},redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw new Error('Status check failed; run again to resume this request, not resubmit.');
   const result=await response.json() as Result;
   if(result.request_id!==requestId)throw new Error('Provider request ID mismatch.');
   persist(result);return result;
  });
  console.log(url);
 }catch(error){
  // SDK/HTTP error objects may carry Authorization headers. Never log them or their payloads.
  if(error instanceof AuthenticationError){persist({status:'authentication-rejected'});console.error('Higgsfield rejected authentication (HTTP 401). No successful generation.');}
  else if(error instanceof APIError)console.error(`Higgsfield API returned HTTP ${Number.isInteger(error.statusCode)?error.statusCode:'error'}. No successful generation.`);
  else if(error instanceof Error && /^Generation (failed|canceled|cancelled|nsfw|moderated); no successful video\.$/.test(error.message))console.error(error.message);
  else if(error && typeof error==='object' && 'code' in error && error.code==='EACCES'){persist({status:'network-permission-denied'});console.error('Network access denied (EACCES). No request could connect.');}
  else console.error('Generation did not complete successfully. It may be failed, canceled, moderated, or still pending. Check the local request journal/provider history; do not blindly resubmit.');
  process.exitCode=1;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
