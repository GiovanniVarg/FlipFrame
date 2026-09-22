import {budgetHold} from './budget.mjs';
export function editImpact(action){
 if(action==='object')return {changes:'The reviewed object region and its automatic cleanup margin.',preserves:'Pixels outside the final repair coverage, verified after local compositing. Source audio is retained.',review:'Check the green coverage, moving edges and the complete range. Background inside the cleanup margin can change.'};
 if(action==='picture')return {changes:'The entire picture inside the selected time range—not just one object.',preserves:'The source soundtrack and picture outside the selected interval are retained by the edit pipeline.',review:'For a single item, choose Object edit and review its boundary first.'};
 if(action==='generate_audio')return {changes:'The soundtrack inside the selected time range.',preserves:'The source picture is retained.',review:'Listen across both boundaries. Exact speech and voice identity are not guaranteed.'};
 return null;
}
export function generationButton(plan){const cost=plan.route?.estimatedUsd;return plan.route?.kind==='higgsfield'?`Generate preview${Number.isFinite(cost)&&cost>0?' · est. '+formatUSD(cost):' · paid'}`:'Create preview';}
export function editScope(plan,duration,fps=30){
 const frames=Math.max(1,Math.round((plan.end-plan.start)*fps));
 if(frames===1)return 'This frame only · 1 frame';
 if(plan.start<=0.5/fps&&Math.abs(plan.end-duration)<=0.5/fps)return `Whole clip · ${frames} frames`;
 return `Selected range · ${frames} frames`;
}
export function reservationLabel(plan,job){
 if(job?.billing==='Provider confirmed no charge; budget reservation released')return job.billing;
 const estimate=job?.quote?.estimatedUsd??plan.route?.estimatedUsd;
 if(plan.route?.kind!=='higgsfield'||!Number.isFinite(estimate))return null;
 const held=job?.quote?.reservedUsd??budgetHold(estimate);
 if(Number.isFinite(job?.confirmedCharge?.actualUsd))return `Original budget hold: ${formatUSD(held)}; released. ${confirmedChargeLabel(job)}`;
 return `Budget hold: ${formatUSD(held)}. This is workspace allowance, not a provider charge. ${confirmedChargeLabel(job)}`;
}

export function formatUSD(value){
 if(!Number.isFinite(value)||value<0)return 'Not available';
 if(value>0&&value<0.000001)return '<$0.000001';
 return '$'+value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6});
}
export function pricingDetails(quote){
 const number=value=>value.toLocaleString('en-US',{maximumFractionDigits:6});
 if(!quote)return ['A detailed price breakdown is not available for this saved estimate.'];
 const rows=[];
 const names={'authenticated-provider-estimate':'Price estimate returned by the provider','provider-formula':'Estimate calculated from the provider’s pricing formula','local-plan-formula':'Planning estimate calculated from a pricing formula'};
 rows.push(names[quote.pricingBasis]||'Saved estimate. A detailed pricing source was not recorded.');
 const d=quote.pricingDimensions;
 if(d&&[d.inputSeconds,d.outputSeconds,d.width,d.height].every(Number.isFinite))rows.push(`Calculation assumes ${number(d.inputSeconds)} seconds in + ${number(d.outputSeconds)} seconds out at ${d.width} × ${d.height}. Output size and length are assumptions, not a measured result.`);
 if(quote.measuredInput&&[quote.measuredInput.width,quote.measuredInput.height,quote.measuredInput.duration].every(Number.isFinite))rows.push(`Uploaded video measured: ${number(quote.measuredInput.duration)} seconds, ${quote.measuredInput.width} × ${quote.measuredInput.height}.`);
 if(Number.isFinite(quote.rateUsdPer1000Tokens))rows.push(`Rate: ${formatUSD(quote.rateUsdPer1000Tokens)} per 1,000 video tokens.`);
 if(Number.isFinite(quote.billableVideoTokens))rows.push(`Video tokens used in estimate: ${quote.billableVideoTokens.toLocaleString('en-US')}.`);
 for(const [key,label] of [['quotedAt','Estimate saved'],['rateVerifiedAt','Rate last checked']])if(quote[key]&&!Number.isNaN(Date.parse(quote[key])))rows.push(`${label}: ${new Date(quote[key]).toISOString()}.`);
 if(Number.isFinite(quote.roundingAllowanceUsd)&&quote.roundingAllowanceUsd>0)rows.push(`Rounding allowance: ${formatUSD(quote.roundingAllowanceUsd)}.`);
 return rows;
}
export function confirmedChargeLabel(job){return Number.isFinite(job?.confirmedCharge?.actualUsd)?`Final charge confirmed: ${formatUSD(job.confirmedCharge.actualUsd)}.`:'Final charge not confirmed.';}
