import './StackedComparison.css';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {comparisonSync,mappedComparisonTime} from '../comparison-sync.mjs';
export function StackedComparison({originalLabel='Current',projectId,candidateId,sourceFrames,current,candidate,master,time,onTime,onPlaying,onError}:{originalLabel?:string;projectId?:string;candidateId?:string;sourceFrames?:number[];current:string,candidate:string,master:RefObject<HTMLVideoElement|null>,time:number,onTime:(v:number)=>void,onPlaying:(v:boolean)=>void,onError:()=>void}){
 const [loading,setLoading]=useState(true);
 const original=useRef<HTMLVideoElement>(null),initial=useRef(time),frames=useRef(sourceFrames);
 frames.current=sourceFrames;
 const [proxy,setProxy]=useState<{key:string,url:string}|null>(null),[fullQuality,setFullQuality]=useState(false),[proxyError,setProxyError]=useState(''),[proxyRetry,setProxyRetry]=useState(0);
 const qualityRef=useRef(fullQuality);qualityRef.current=fullQuality;
 const key=projectId+':'+candidateId;
 const previewUrl=proxy?.key===key?proxy.url:undefined;
 const changeQuality=(full:boolean)=>{initial.current=master.current?.currentTime??time;master.current?.pause();onPlaying(false);setFullQuality(full);};
 useEffect(()=>{if(!projectId||!candidateId)return;const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;setProxyError('');setFullQuality(false);
  const endpoint=`/api/projects/${encodeURIComponent(projectId)}/candidates/${encodeURIComponent(candidateId)}/playback-preview`;
  const check=async(first:boolean)=>{try{const response=await fetch(endpoint,{method:first?'POST':'GET',...(first?{headers:{'Content-Type':'application/json'},body:'{}'}:{}),signal:abort.signal});const result=await response.json();if(!response.ok||result.status==='error')throw Error('Smooth preview unavailable. Full quality is still available.');if(abort.signal.aborted)return;if(result.status==='ready'&&typeof result.url==='string'&&result.url.startsWith('/media/')){if(!qualityRef.current){initial.current=master.current?.currentTime??time;master.current?.pause();}setProxy({key,url:result.url});}else if(result.status==='preparing')timer=setTimeout(()=>void check(false),2000);else throw Error('Smooth preview unavailable. Full quality is still available.');}catch(error){if(!abort.signal.aborted)setProxyError((error as Error).message);}};
  void check(true);return()=>{abort.abort();clearTimeout(timer);};
 },[projectId,candidateId,proxyRetry]);
 const playbackUrl=!fullQuality&&previewUrl?previewUrl:candidate;
 useEffect(()=>{let raf=0,disposed=false,playPending=false,lastIndex:number|null=null;
  const sync=()=>{const a=original.current,b=master.current;
   if(a&&b&&a.readyState>=2){
    const next=comparisonSync({time:b.currentTime,originalTime:a.currentTime,paused:b.paused,ended:b.ended,readyState:b.readyState,seeking:b.seeking,originalSeeking:a.seeking,frames:frames.current,lastIndex});
    setLoading(previous=>previous===next.loading?previous:next.loading);
    // Let a decoder finish its current seek before requesting another frame.
    if(next.seek){a.currentTime=next.target;lastIndex=next.index;}
    else if(!a.seeking&&!b.seeking)lastIndex=next.index;
    if(next.pause||a.seeking){if(!a.paused)a.pause();}
    else if(a.paused&&!playPending){playPending=true;void a.play().catch(()=>{}).finally(()=>{playPending=false;});}
    const rate=b.playbackRate*next.rate;if(Math.abs(a.playbackRate-rate)>.001)a.playbackRate=rate;
   }
   if(!disposed)raf=requestAnimationFrame(sync);
  };
  raf=requestAnimationFrame(sync);
  return()=>{disposed=true;cancelAnimationFrame(raf);original.current?.pause();};
 },[current,playbackUrl,master]);
 return <div className="stacked-comparison" aria-label="Synchronized current and candidate comparison">{projectId&&candidateId&&<div className="comparison-quality"><span>{fullQuality?'Full quality':previewUrl?'Smooth preview · up to 720p':proxyError||'Preparing smooth preview…'}</span><button type="button" aria-pressed={fullQuality} onClick={()=>changeQuality(!fullQuality)}>{fullQuality?'Smooth preview':'Full quality'}</button>{proxyError&&<button type="button" onClick={()=>setProxyRetry(value=>value+1)}>Retry smooth preview</button>}<small>Preview only. Apply and export keep full quality.</small></div>}{loading&&<p role="status">Synchronizing comparison frames…</p>}<section><span>{originalLabel} · original audio muted</span><video ref={original} src={current} muted playsInline preload="auto" onLoadedMetadata={e=>{const b=master.current;if(b)e.currentTarget.currentTime=mappedComparisonTime(b.currentTime,frames.current)}} onError={onError}/></section><section><span>Candidate · playback audio</span><video ref={master} src={playbackUrl} playsInline preload="auto" onLoadedMetadata={e=>{e.currentTarget.currentTime=Math.min(initial.current,Math.max(0,e.currentTarget.duration-1/30));onPlaying(false)}} onTimeUpdate={e=>onTime(e.currentTarget.currentTime)} onSeeked={e=>onTime(e.currentTarget.currentTime)} onPlay={()=>onPlaying(true)} onPause={()=>onPlaying(false)} onEnded={()=>onPlaying(false)} onError={onError}/></section></div>
}
