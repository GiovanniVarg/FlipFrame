import fs from 'node:fs';
const base='http://127.0.0.1:8780',statePath=new URL('./data/object-quality-validation.json',import.meta.url);
const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{};
const save=()=>fs.writeFileSync(statePath,JSON.stringify(state,null,2));
async function call(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d;}
const sample=state.projectId?await call('/api/projects/'+state.projectId):await call('/api/projects/example',{idempotencyKey:'object-quality-balloon-v1'});
state.projectId=sample.id;save();
if(!state.planId){const response=await call('/api/projects/'+sample.id+'/conversation',{text:'Change only the warm red and orange balloon envelope to rich cobalt blue. Keep the balloon shape, position, motion, illustration style, basket, ropes, coastline, ocean, text, lighting and camera unchanged.',intent:'object',start:2,end:4,quality:'standard',baseRevisionId:sample.activeRevisionId,idempotencyKey:'balloon-cobalt-v1'});const plan=response.plans.find(p=>p.id===response.requestedPlanId);if(!plan)throw Error('No matching plan');state.planId=plan.id;state.plan=plan;save();}
console.log(JSON.stringify({projectId:state.projectId,planId:state.planId,start:state.plan.start,end:state.plan.end,processStart:state.plan.processStart,processEnd:state.plan.processEnd,route:state.plan.route}));
if(process.argv.includes('--execute')&&!state.jobId){
 const masks=Array.from({length:60},(_,i)=>{const frame=60+i,t=frame/30,x=Math.trunc(105+36*t),y=Math.trunc(119+Math.sin(t*1.4)*13);return {time:t,points:Array.from({length:32},(_,j)=>{const angle=2*Math.PI*j/32;return [(x+32*Math.cos(angle))/640,(y+40*Math.sin(angle))/360];})};});
 const result=await call('/api/projects/'+sample.id+'/conversation/plans/'+state.planId+'/execute',{baseRevisionId:sample.activeRevisionId,scope:'range',masks,visibleRanges:[{start:2,end:4}],reviewed:true});state.jobId=result.job.id;save();
}
if(state.jobId){const job=await call('/api/jobs/'+state.jobId);state.status=job.status;state.candidate=job.result;save();console.log(JSON.stringify({jobId:job.id,status:job.status,phase:job.phase,error:job.error,quote:job.quote,result:job.result,budget:(await call('/api/capabilities')).budget}));}
