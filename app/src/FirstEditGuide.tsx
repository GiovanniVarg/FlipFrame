import {useState} from 'react';
import './FirstEditGuide.css';
type Props={project:boolean;selected:boolean;candidate:boolean;busy:boolean;onImport:()=>void;onExample:()=>void;onGenerate:()=>void;onSelect:()=>void;onDescribe:()=>void;onReview:()=>void};
export function FirstEditGuide(p:Props){
 const [hidden,setHidden]=useState(()=>{try{return localStorage.getItem('lab-first-edit-guide')==='hidden'}catch{return false}});
 const toggle=(value:boolean)=>{setHidden(value);try{localStorage.setItem('lab-first-edit-guide',value?'hidden':'visible')}catch{}};
 const step=!p.project?0:p.candidate?3:p.selected?2:1;
 const titles=['Start with a video','Choose what should change','Describe the change','Compare before you keep it'];
 return <section className="first-edit-guide" aria-label="First edit guide">{hidden?<button onClick={()=>toggle(false)}>Show first-edit guide</button>:<>
 <header><strong>Your first object edit</strong><button onClick={()=>toggle(true)} aria-label="Hide first-edit guide">Hide</button></header>
 <ol>{titles.map((title,i)=><li key={title} aria-current={step===i?'step':undefined}><span>{i+1}</span>{title}</li>)}</ol>
 <p>{['Generate an original from your description and optional reference images, or import a video you already have.','Choose a time range. Draw around the object, refine the outline, track it through the range, and review its coverage.','Say what the selected object should become. Attach an image if helpful. Review the proposed model, range and cost before running.','Watch the whole range with A / B or enlarged preview. Check edges, motion and the surrounding scene. Only Apply candidate changes your current revision.'][step]}</p>
 <div className="guide-actions">{step===0?<><button disabled={p.busy} onClick={p.onGenerate}>Describe a new video</button><button disabled={p.busy} onClick={p.onImport}>Import a video</button><button disabled={p.busy} onClick={p.onExample}>Try a sample · free</button></>:<button disabled={p.busy} onClick={step===1?p.onSelect:step===2?p.onDescribe:p.onReview}>{['','Select an object','Write my edit','Compare this candidate'][step]}</button>}</div>
 <small>Opening a step does not generate or apply an edit. You can hide this guide anytime.</small>
 </>}</section>
}
