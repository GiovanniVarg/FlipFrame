import {useId,type ReactNode} from 'react';
export function InspectorGroup({id,title,description,active,onChange,children}:{id:string,title:string,description:string,active:string,onChange:(id:string)=>void,children:ReactNode}){
 const panel=useId(),open=active===id;
 return <section className={`inspector-group ${open?'is-open':''}`}><h3><button type="button" aria-expanded={open} aria-controls={panel} onClick={()=>onChange(open?'':id)}><span><strong>{title}</strong><small>{description}</small></span><span aria-hidden="true">{open?'−':'+'}</span></button></h3><div id={panel} hidden={!open} className="inspector-group-body">{children}</div></section>;
}
