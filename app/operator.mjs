import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {openState} from './state-store.mjs';import {reconcileBilling} from './reconciliation.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));try{process.loadEnvFile(path.join(root,'.env.local'));}catch{}try{process.loadEnvFile(path.join(root,'.env'));}catch{}
const [command,jobId,actual,outcome,evidence]=process.argv.slice(2);
if(!['list-billing','reconcile'].includes(command)){console.log('Stop the studio first. Commands:\n  node operator.mjs list-billing\n  node operator.mjs reconcile JOB_ID ACTUAL_USD OUTCOME "Billing evidence"\nOutcomes: completed, failed, nsfw, canceled, not-submitted. Never guess a charge or acceptance.');process.exit(command?1:0);}
let store;try{store=openState(process.env.LAB_DATA_DIR||path.join(root,'data'));
 if(command==='list-billing')console.log(JSON.stringify({ledger:store.state.spend,jobs:Object.values(store.state.jobs).filter(j=>j.provider).map(j=>({id:j.id,status:j.status,requestId:j.providerState?.requestId,quote:j.quote,reconciliation:j.reconciliation}))},null,2));
 else{if(actual===undefined||actual.trim()==='')throw new Error('Actual USD charge required');reconcileBilling(store.state,jobId,{actualUsd:Number(actual),outcome,evidence});store.save();console.log('Reconciled once. No provider request was sent.');}
}catch(e){console.error(e.message);process.exitCode=1;}finally{store?.close();}
