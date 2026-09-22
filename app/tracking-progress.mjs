import {spawn} from 'node:child_process';
export const mediaWorkerTimeout=action=>['normalize','background_replace'].includes(action)?7200000:600000;
export const progressPhase=stage=>({preparing:'Preparing video',tracking:'Following object',compositing:'Replacing background',encoding:'Saving video',verifying:'Checking preserved pixels'}[stage]||'Processing video');
export const canceledError=()=>Object.assign(new Error('Canceled'),{name:'AbortError'});
export function trackingProgress(line){
 if(!line.startsWith('FLIPFRAME_PROGRESS '))return null;
 try{const p=JSON.parse(line.slice(19));if(!['preparing','tracking','compositing','encoding','verifying'].includes(p.stage)||!Number.isInteger(p.completed)||!Number.isInteger(p.total)||p.total<0||p.completed<0||p.completed>p.total)return null;return {stage:p.stage,completed:p.completed,total:p.total};}catch{return null;}
}
export function cancellableLocal(job){return !job.provider&&(job.status==='queued'||job.status==='running'&&['segment','track'].includes(job.workRequest?.kind));}
// Keep the queue occupied until close: rejecting immediately would let another model start while this one is alive.
export function collectWorker(child,{signal,timeoutMs=600000,onStderr=()=>{},killTree=()=>{if(process.platform==='win32'){const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}else {try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}}}={}){
 return new Promise((resolve,reject)=>{
  let stdout='',failure;const stop=error=>{if(failure)return;failure=error;killTree();};
  const abort=()=>stop(canceledError());const timer=setTimeout(()=>stop(new Error(`Media processing exceeded the ${timeoutMs/60000} minute limit.`)),timeoutMs);
  child.stdout.on('data',b=>{stdout+=b;if(stdout.length>12000000)stop(new Error('Media output exceeded its limit.'));});
  child.stderr.on('data',b=>{if(!failure)onStderr(String(b));});
  child.on('error',e=>{failure ||= e;});
  child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure)reject(failure);else resolve({stdout,code});});
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
}
