// Rates are pinned, not a live catalog. Provider formula use requires exact description matching.
export const RATE_SOURCE_URL='https://open.higgsfield.ai/models/bytedance/seedance-2.5/video-edit/api-reference';
function durationFraction(seconds){
 const frames=Math.round(seconds*30);
 if(Math.abs(seconds*30-frames)<1e-9)return [BigInt(frames),30n];
 const [coefficient,exponent='0']=String(seconds).toLowerCase().split('e');
 const [whole,fraction='']=coefficient.split('.');const power=Number(exponent)-fraction.length;
 const numerator=BigInt(whole+fraction);
 return power>=0?[numerator*10n**BigInt(power),1n]:[numerator,10n**BigInt(-power)];
}
export function formulaEstimate(dimensions,{creation=false,basis='local-plan-formula',quotedAt=new Date().toISOString()}={}){
 const {width,height,inputSeconds,outputSeconds}=dimensions;
 if(![width,height].every(v=>Number.isSafeInteger(v)&&v>0&&v<=16384)||![inputSeconds,outputSeconds].every(v=>Number.isFinite(v)&&v>=0&&v<=3600)||outputSeconds<=0)throw Error('Invalid pricing dimensions');
 const [a,b]=durationFraction(inputSeconds),[c,d]=durationFraction(outputSeconds);
 const numerator=(a*d+c*b)*BigInt(width)*BigInt(height)*24n,denominator=b*d*1024n;
 const tokens=Number((numerator+denominator-1n)/denominator);
 if(!Number.isSafeInteger(tokens))throw Error('Pricing exceeds safe arithmetic limits');
 const nanos=BigInt(tokens)*BigInt(creation?21400:12840),micros=(nanos+999n)/1000n;
 const computedUsd=Number(nanos)/1e9,estimatedUsd=Number(micros)/1e6;
 return {estimatedUsd,computedUsd,computedNanoUsd:nanos.toString(),roundingAllowanceUsd:Number(micros*1000n-nanos)/1e9,billableVideoTokens:tokens,rateUsdPer1000Tokens:creation?.0214:.01284,pricingDimensions:{width,height,inputSeconds,outputSeconds},pricingBasis:basis,rateSourceUrl:creation?RATE_SOURCE_URL.replace('video-edit','text-to-video'):RATE_SOURCE_URL,rateProvenance:basis==='provider-formula'?'Exact authenticated provider description matched at quote time':'Pinned local plan rate; fresh provider check required before submission',rateVerifiedAt:basis==='provider-formula'?quotedAt:null,quotedAt,isHardCap:false};
}
export function preparedShape(width,height,resolution='720p'){
 const short=Number.parseInt(resolution);if(![480,720].includes(short)||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Invalid prepared clip shape');
 let w=short===720?1280:854,h=short;if(width<height)[w,h]=[h,w];if(Math.abs(width/height-1)<.05)w=h=short;
 return {width:w,height:h};
}
export function assumedOutputShape(width,height){return {width:Math.ceil(width/64)*64,height:Math.ceil(height/64)*64};}
export function publicPriceQuote(quote,hold){
 if(!quote)return undefined;const result={};
 for(const key of ['estimatedUsd','computedUsd','computedNanoUsd','roundingAllowanceUsd','billableVideoTokens','rateUsdPer1000Tokens','pricingDimensions','pricingBasis','rateSourceUrl','rateProvenance','rateVerifiedAt','quotedAt','source','formulaVerified','verified','isHardCap','assumption','measuredInput'])if(quote[key]!==undefined)result[key]=quote[key];
 if(Number.isFinite(hold)){result.reservedUsd=hold;result.safetyBufferUsd=Math.max(0,hold-quote.estimatedUsd);}
 return result;
}
