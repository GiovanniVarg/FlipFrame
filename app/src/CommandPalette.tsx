import {useEffect,useRef,useState} from 'react';
import './CommandPalette.css';
export type EditorCommand={id:string,label:string,description:string,shortcut?:string,disabled?:boolean,run:()=>void};
export function CommandPalette({open,onClose,commands}:{open:boolean,onClose:()=>void,commands:EditorCommand[]}){
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);const [query,setQuery]=useState(''),[selected,setSelected]=useState(0);
 const visible=commands.filter(c=>`${c.label} ${c.description} ${c.shortcut??''}`.toLowerCase().includes(query.toLowerCase()));
 useEffect(()=>{if(!open)return;const previous=document.activeElement as HTMLElement|null;setQuery('');setSelected(0);dialog.current?.showModal();input.current?.focus();return()=>{dialog.current?.close();previous?.focus()}},[open]);
 useEffect(()=>{dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'})},[selected,query,open]);
 function choose(command:EditorCommand|undefined){if(!command||command.disabled)return;onClose();command.run()}
 return <dialog ref={dialog} className="command-palette" aria-labelledby="commands-title" onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===dialog.current)onClose()}} onKeyDown={e=>{if(e.nativeEvent.isComposing||e.target!==input.current)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setSelected(v=>visible.length?(v+(e.key==='ArrowDown'?1:-1)+visible.length)%visible.length:0)}else if(e.key==='Enter'){e.preventDefault();choose(visible[selected])}}}>
  <div className="commands-top"><div><span className="eyebrow">Move without the menus</span><h2 id="commands-title">Find a command.</h2></div><button aria-label="Close commands" onClick={onClose}>Esc</button></div>
  <label className="sr-only" htmlFor="command-search">Search commands</label><input ref={input} id="command-search" role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={visible[selected]?`command-${visible[selected].id}`:undefined} value={query} onChange={e=>{setQuery(e.target.value);setSelected(0)}} placeholder="Try play, moments, compare, or history…" autoComplete="off"/>
  <div id="command-results" className="command-results" role="listbox" aria-label="Commands">{visible.map((c,index)=><button key={c.id} id={`command-${c.id}`} role="option" aria-selected={selected===index} aria-disabled={!!c.disabled} tabIndex={-1} className={selected===index?'selected':''} onPointerMove={()=>setSelected(index)} onClick={()=>choose(c)}><span><strong>{c.label}</strong><small>{c.description}</small></span>{c.shortcut&&<kbd>{c.shortcut}</kbd>}</button>)}{!visible.length&&<p className="commands-empty">No matching command. Try “frame” or “moments”.</p>}</div>
  <div className="commands-foot"><span>↑ ↓ to move · Enter to select</span><span>Generation and applying edits always require review.</span></div>
 </dialog>;
}
