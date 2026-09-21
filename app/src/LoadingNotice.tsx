import {useEffect,useState} from 'react';
import './LoadingNotice.css';
export function LoadingNotice({message,onActivity}:{message:string;onActivity:()=>void}){
 const [seconds,setSeconds]=useState(0);useEffect(()=>{const start=Date.now();const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer)},[]);
 return <div className="loading-notice" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true"/><div><strong>{message||'Working on your request…'}</strong><p>Keep this tab open. Your current revision is preserved.</p>{seconds>=20&&<small>Still working · {seconds}s elapsed. This is not an estimated finish time.</small>}</div><button type="button" onClick={onActivity}>View activity</button></div>
}
