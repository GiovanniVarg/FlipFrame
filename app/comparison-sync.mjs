export function mappedComparisonTime(time,frames){
 if(!frames?.length)return time;
 const position=Math.max(0,time*30),index=Math.min(frames.length-1,Math.floor(position+1e-5));
 const fraction=index===frames.length-1?0:position-Math.floor(position);
 return (frames[index]+fraction)/30;
}
export function comparisonSync({time,originalTime,paused,ended,readyState,seeking,originalSeeking,frames,lastIndex}){
 const target=mappedComparisonTime(time,frames),drift=target-originalTime;
 const index=frames?.length?Math.min(frames.length-1,Math.max(0,Math.floor(time*30+1e-5))):null;
 const jumped=index!==null&&lastIndex!==null&&lastIndex!==undefined&&index!==lastIndex&&frames[index]-frames[lastIndex]!==index-lastIndex;
 const pause=paused||ended||readyState<3||seeking;
 const seek=!seeking&&!originalSeeking&&(Math.abs(drift)>(pause?1/60:.12)||jumped&&Math.abs(drift)>1/60);
 return {target,seek,pause,index,rate:Math.abs(drift)>.025?(drift>0?1.04:.96):1,loading:seeking||originalSeeking||readyState<2||Math.abs(drift)>.12};
}
