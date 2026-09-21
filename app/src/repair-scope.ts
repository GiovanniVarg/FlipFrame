import {compatibleMasks} from '../mask-corrections.mjs';
type MaskTarget = {time:number;points:[number,number][]};
export function repairVisibleRanges(scope:string,start:number,end:number,ranges:{start:number;end:number}[]) {
 if(scope==='frame'||!ranges.length)return undefined;
 const selected=ranges.map(r=>({start:Math.max(start,r.start),end:Math.min(end,r.end)})).filter(r=>r.end>r.start+1e-7);
 if(!selected.length)throw Error('No tracked object appearances inside this time range. Select a tracked range.');
 return selected;
}
export function repairMasks<T extends MaskTarget>(action:string,scope:string,start:number,end:number,duration:number,fps:number,masks:T[]):T[] {
 if(action!=='object')return masks;
 if(scope!=='frame')return compatibleMasks(masks);
 const mask=masks.find(item=>Math.abs(item.time-start)<0.000001);
 const frameEnd=Math.min(duration,start+1/fps);
 if(!mask||end<=start||Math.abs(end-frameEnd)>0.000001)throw Error('Select one saved mask frame in the timeline, or choose reviewed keyframes in range. The selected range will not be narrowed automatically.');
 return [mask];
}
