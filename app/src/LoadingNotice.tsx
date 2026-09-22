import {useEffect,useState} from 'react';
import './LoadingNotice.css';
export function LoadingNotice({message,onActivity,progress,onCancel,canceling=false}:{message:string;onActivity:()=>void;progress?:{completed:number,total:number};onCancel?:()=>void;canceling?:boolean}){
 const [seconds,setSeconds]=useState(0);useEffect(()=>{const start=Date.now();const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer)},[]);
 const hasProgress=progress&&progress.total>0;
 return <div className="loading-notice" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true"/><div><strong>{canceling?'Stopping tracking…':message||'Working on your request…'}</strong>{hasProgress&&<><p>{progress.completed} of {progress.total} frames</p><progress aria-label="Processing frames" value={progress.completed} max={progress.total}/></>}<p>Your current video and saved selection stay safe.</p><small>{seconds}s elapsed{!hasProgress?' · Preparing or processing':''}</small></div>{onCancel&&<button type="button" disabled={canceling} onClick={onCancel}>{canceling?'Stopping…':'Cancel tracking'}</button>}<button type="button" onClick={onActivity}>View activity</button></div>
}
