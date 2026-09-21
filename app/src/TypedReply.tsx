import {useEffect,useState} from 'react';
export function TypedReply({text,animate}:{text:string;animate:boolean}){
 const [count,setCount]=useState(animate?0:text.length);
 useEffect(()=>{if(!animate||window.matchMedia('(prefers-reduced-motion: reduce)').matches){setCount(text.length);return;}setCount(0);const start=performance.now();const timer=window.setInterval(()=>{const next=Math.min(text.length,Math.floor((performance.now()-start)/12));setCount(next);if(next>=text.length)clearInterval(timer);},30);return()=>clearInterval(timer)},[text,animate]);
 return <p className="typed-reply" aria-label={text}><span aria-hidden="true">{text.slice(0,count)}{count<text.length&&<span className="typing-caret">▍</span>}</span></p>;
}
