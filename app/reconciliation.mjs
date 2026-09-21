export function reconcileBilling(state,jobId,{actualUsd,outcome,evidence}) {
 const job=state.jobs[jobId];
 if(!job||job.provider!=='higgsfield')throw new Error('Higgsfield job not found');
 if(job.reconciliation)throw new Error('This job is already reconciled');
 if(['queued','running'].includes(job.status))throw new Error('Cannot reconcile running or queued work. Stop the server and verify provider status first.');
 if(!Number.isFinite(actualUsd)||actualUsd<0||actualUsd>100000)throw new Error('Enter the actual nonnegative USD charge from billing');
 if(!['completed','failed','nsfw','canceled','not-submitted'].includes(outcome))throw new Error('A verified terminal provider outcome is required');
 if(typeof evidence!=='string'||evidence.trim().length<10||evidence.length>1000)throw new Error('Record the billing/request evidence, without secrets');
 const hold=job.quote?.reservedUsd||0;
 if(!Number.isFinite(hold)||hold<0||state.spend.reserved+1e-8<hold)throw new Error('Ledger hold mismatch; inspect before changing billing');
 state.spend={...state.spend,spent:Math.round((state.spend.spent+actualUsd)*1e8)/1e8,reserved:Math.max(0,Math.round((state.spend.reserved-hold)*1e8)/1e8)};
 job.reconciliation={actualUsd,outcome,evidence:evidence.trim(),at:new Date().toISOString()};
 job.billing='Actual charge reconciled';
 if(job.status==='unknown'){job.status='reconciled';job.phase='Provider outcome verified by operator';}
 return job;
}
