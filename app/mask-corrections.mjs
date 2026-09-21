// Replace only returned frame keys; unrelated tracked frames remain intact.
export function mergeFrameMasks(existing, corrected, fps=30) {
 const byFrame=new Map(existing.map(m=>[Math.round(m.time*fps),m]));
 for(const m of corrected){if(!Number.isFinite(m.time)||!Array.isArray(m.points)||m.points.length<3)throw Error('Correction requires a valid frame outline');byFrame.set(Math.round(m.time*fps),{...m,time:Math.round(m.time*fps)/fps});}
 return [...byFrame.values()].sort((a,b)=>a.time-b.time);
}

// Add collinear points only: existing corners and boundary geometry stay unchanged.
export function compatibleMasks(masks){
 const count=Math.max(0,...masks.map(m=>m.points.length));
 if(masks.every(m=>m.points.length===count))return masks;
 return masks.map(m=>{if(m.points.length===count)return m;const points=m.points.map(p=>[...p]);while(points.length<count){let best=0,length=-1;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],d=(a[0]-b[0])**2+(a[1]-b[1])**2;if(d>length){length=d;best=i;}}const a=points[best],b=points[(best+1)%points.length];points.splice(best+1,0,[(a[0]+b[0])/2,(a[1]+b[1])/2]);}return {...m,points};});
}
