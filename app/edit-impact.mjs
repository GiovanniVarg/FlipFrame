export function editImpact(action){
 if(action==='object')return {changes:'The reviewed object region and its automatic cleanup margin.',preserves:'Pixels outside the final repair coverage, verified after local compositing. Source audio is retained.',review:'Check the green coverage, moving edges and the complete range. Background inside the cleanup margin can change.'};
 if(action==='picture')return {changes:'The entire picture inside the selected time range—not just one object.',preserves:'The source soundtrack and picture outside the selected interval are retained by the edit pipeline.',review:'For a single item, choose Object edit and review its boundary first.'};
 if(action==='generate_audio')return {changes:'The soundtrack inside the selected time range.',preserves:'The source picture is retained.',review:'Listen across both boundaries. Exact speech and voice identity are not guaranteed.'};
 return null;
}
export function generationButton(plan){const cost=plan.route?.estimatedUsd;return plan.route?.kind==='higgsfield'?`Generate preview${Number.isFinite(cost)&&cost>0?' · est. $'+cost.toFixed(2):' · paid'}`:'Create preview';}
export function editScope(plan,duration,fps=30){
 const frames=Math.max(1,Math.round((plan.end-plan.start)*fps));
 if(frames===1)return 'This frame only · 1 frame';
 if(plan.start<=0.5/fps&&Math.abs(plan.end-duration)<=0.5/fps)return `Whole clip · ${frames} frames`;
 return `Selected range · ${frames} frames`;
}
export function reservationLabel(plan,job){if(job?.billing)return job.billing;const estimate=plan.route?.estimatedUsd;return plan.route?.kind==='higgsfield'&&Number.isFinite(estimate)&&estimate>0?`${job?'Allowance held':'Generation will reserve'}: $${(Math.ceil(estimate*2*1e6)/1e6).toFixed(2)}. This is a reservation, not a verified charge. Actual billing is confirmed separately.`:null;}
