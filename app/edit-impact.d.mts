export function editImpact(action:string):{changes:string;preserves:string;review:string}|null;
export function generationButton(plan:{route?:{kind?:string;estimatedUsd?:number}}):string;
export function editScope(plan:{start:number;end:number},duration:number,fps?:number):string;
export function reservationLabel(plan:{route?:{kind?:string;estimatedUsd?:number}},job?:{billing?:string;quote?:PricingQuote;confirmedCharge?:{actualUsd:number}}):string|null;

export type PricingQuote={estimatedUsd?:number;reservedUsd?:number;computedUsd?:number;roundingAllowanceUsd?:number;rateUsdPer1000Tokens?:number;billableVideoTokens?:number;pricingDimensions?:{width:number;height:number;inputSeconds:number;outputSeconds:number};measuredInput?:{width:number;height:number;duration:number};pricingBasis?:string;rateSourceUrl?:string;rateVerifiedAt?:string;quotedAt?:string};
export function formatUSD(value:number):string;
export function pricingDetails(quote?:PricingQuote):string[];
export function confirmedChargeLabel(job?:{confirmedCharge?:{actualUsd:number}}):string;
