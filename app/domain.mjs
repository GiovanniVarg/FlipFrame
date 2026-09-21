export function validateEdit(project, input) {
 if(input.baseRevisionId!==project.activeRevisionId) throw new Error('Project revision changed. Review your edit again.');
 const {start,end}=input;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>project.duration+0.001) throw new Error('Invalid range: choose start before end inside the source.');
 const snappedStart=Math.ceil(start*30-1e-7)/30,snappedEnd=Math.min(project.duration,Math.ceil(end*30-1e-7)/30);
 if(snappedEnd<=snappedStart)throw new Error('Select at least one complete frame.');
 if(!['mute','gain','replace_audio','picture','object'].includes(input.operation)) throw new Error('Unsupported operation');
 if(input.operation==='gain'&&(!Number.isFinite(input.gainDb)||input.gainDb < -60||input.gainDb>12))throw new Error('Gain must be between -60 and 12 dB');
 if(input.operation==='object') {
  const masks=input.masks;
  if(!Array.isArray(masks)||!masks.length||masks.length>1800)throw new Error('Draw a mask first.');
  let previous=-1, count=masks[0].points?.length;
  for(const mask of masks){
   if(!Number.isFinite(mask.time)||mask.time<0||mask.time>project.duration||mask.time<=previous)throw new Error('Mask keyframes must be ordered inside the source.');
   previous=mask.time;
   if(!Array.isArray(mask.points)||mask.points.length<3||mask.points.length>500||mask.points.length!==count||mask.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('Invalid polygon mask; use matching vertices inside the frame.');
  }
  if(input.visibleRanges){
   if(!Array.isArray(input.visibleRanges)||!input.visibleRanges.length||input.visibleRanges.length>1800)throw new Error('Invalid visible ranges');let lastEnd=snappedStart;
   for(const range of input.visibleRanges){if(Math.abs(range.start*30-Math.round(range.start*30))>1e-5||Math.abs(range.end*30-Math.round(range.end*30))>1e-5)throw new Error('Visible ranges must align to video frames');if(!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<snappedStart-1e-6||range.start<lastEnd-1e-6||range.end<=range.start||range.end>snappedEnd+1e-6)throw new Error('Invalid or overlapping visible ranges');lastEnd=range.end;
    for(let f=Math.ceil(range.start*30-1e-7);f<Math.ceil(range.end*30-1e-7);f++){if(!masks.some(m=>Math.abs(m.time-f/30)<1e-5))throw new Error('Each visible frame needs its own reviewed mask');}
   }
  }
  if(!['frame','range'].includes(input.scope))throw new Error('Choose frame or reviewed range.');
  if(input.scope==='frame'&&(masks.length!==1||Math.abs(masks[0].time-start)>1/30+1e-6||end-start>1/30+1e-6))throw new Error('Single-frame scope requires exactly one frame at its mask keyframe.');
  if(input.scope==='range'&&!input.visibleRanges&&(masks.length<2||masks[0].time>Math.ceil(start*30-1e-7)/30+1e-6||masks.at(-1).time<(Math.ceil(end*30-1e-7)-1)/30-1e-6))throw new Error('Mask keyframes must cover the reviewed range.');
 }
 return {...input,scope:input.operation==='object'?input.scope:undefined,start:Math.ceil(start*30-1e-7)/30,end:Math.min(project.duration,Math.ceil(end*30-1e-7)/30)};
}
export function applyCandidate(project,candidate){
 if(candidate.baseRevisionId!==project.activeRevisionId)throw new Error('Candidate belongs to an older revision.');
 if(project.revisions.some(r=>r.id===candidate.id))throw new Error('Candidate already applied.');
 return {...project,activeRevisionId:candidate.id,revisions:[...project.revisions,{...candidate,parentId:project.activeRevisionId,createdAt:new Date().toISOString()}]};
}
export function undoProject(project){const active=project.revisions.find(r=>r.id===project.activeRevisionId);return {...project,activeRevisionId:active?.parentId||project.revisions[0].id};}
