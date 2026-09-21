type MaskTarget = {time:number};
export function repairMasks<T extends MaskTarget>(action:string,scope:string,start:number,end:number,duration:number,fps:number,masks:T[]):T[] {
 if(action!=='object'||scope!=='frame')return masks;
 const mask=masks.find(item=>Math.abs(item.time-start)<0.000001);
 const frameEnd=Math.min(duration,start+1/fps);
 if(!mask||end<=start||Math.abs(end-frameEnd)>0.000001)throw Error('Select one saved mask frame in the timeline, or choose reviewed keyframes in range. The selected range will not be narrowed automatically.');
 return [mask];
}
