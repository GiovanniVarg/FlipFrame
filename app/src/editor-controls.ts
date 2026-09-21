export type TimeRange={start:number,end:number};
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
export function frameTime(value:number,duration:number,fps=30){if(![value,duration,fps].every(Number.isFinite)||duration<=0||fps<=0)throw Error('Invalid media time');return clamp(Math.round(value*fps)/fps,0,duration)}
export function selectionAt(edge:'in'|'out'|'frame',time:number,start:number,end:number,duration:number,fps=30):TimeRange{
 const frames=Math.max(1,Math.round(duration*fps));const t=clamp(Math.round(time*fps),0,frames),a=clamp(Math.round(start*fps),0,frames-1),b=clamp(Math.round(end*fps),1,frames);
 if(edge==='frame'){const first=Math.min(t,frames-1);return {start:first/fps,end:Math.min(duration,(first+1)/fps)}}
 if(edge==='in'){const first=Math.min(t,frames-1);return {start:first/fps,end:Math.min(duration,Math.max(first+1,b)/fps)}}
 const last=Math.max(1,t);return {start:Math.min(a,last-1)/fps,end:Math.min(duration,last/fps)};
}
export function windowAround(center:number,length:number,duration:number):TimeRange{if(![center,length,duration].every(Number.isFinite)||length<=0||duration<=0)throw Error('Invalid view window');const span=Math.min(duration,length),start=clamp(center-span/2,0,duration-span);return {start,end:start+span}}
export function reviewWindow(start:number,end:number,duration:number):TimeRange{if(![start,end,duration].every(Number.isFinite)||start<0||end<=start||end>duration)throw Error('Invalid review interval');return {start:Math.max(0,start-.75),end:Math.min(duration,end+.75)}}
export function panelWidth(value:number){return Number.isFinite(value)?Math.round(clamp(value,300,520)):380}
export type ShortcutInput={key:string;ctrlKey?:boolean;metaKey?:boolean;shiftKey?:boolean;altKey?:boolean;editable?:boolean;interactive?:boolean;isComposing?:boolean;repeat?:boolean};
export function shortcutFor(e:ShortcutInput):string|null{
 if(e.isComposing||e.altKey)return null;
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!e.repeat)return 'commands';
 if(e.editable||e.interactive||e.ctrlKey||e.metaKey)return null;
 if(e.key==='ArrowLeft')return e.shiftKey?'back-ten':'back-frame';if(e.key==='ArrowRight')return e.shiftKey?'forward-ten':'forward-frame';
 if(e.repeat)return null;
 return ({' ':'play',i:'mark-in',o:'mark-out',m:'markers',c:'compare','?':'commands'} as Record<string,string>)[e.key.toLowerCase()]??null;
}
