// Round twice the decimal USD quote up to microUSD without binary-float drift.
export function budgetHold(quote){
 if(!Number.isFinite(quote)||quote<=0)throw Error('A positive USD estimate is required');
 const [coefficient,exponent='0']=String(quote).toLowerCase().split('e');
 const [whole,fraction='']=coefficient.split('.');const power=Number(exponent)-fraction.length;
 let numerator=BigInt(whole+fraction)*2000000n,denominator=1n;
 if(power>=0)numerator*=10n**BigInt(power);else denominator=10n**BigInt(-power);
 const micros=(numerator+denominator-1n)/denominator;
 if(micros>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Estimate exceeds safe currency arithmetic');
 return Number(micros)/1e6;
}
export function reserve(ledger,ceiling,quote){if(!Number.isFinite(quote)||quote<=0||!Number.isFinite(ceiling)||ceiling<=0)throw new Error('A positive USD estimate and budget are required');if(!Number.isFinite(ledger.spent)||ledger.spent<0||!Number.isFinite(ledger.reserved)||ledger.reserved<0)throw new Error('Invalid billing ledger');const hold=budgetHold(quote);if(quote>5)throw new Error('One generation estimate is limited to $5. Shorten the selected range.');const nano=value=>{const units=Math.round(value*1e9);if(!Number.isSafeInteger(units))throw Error('Billing amount exceeds safe precision');return BigInt(units);};const nextReserved=nano(ledger.reserved)+nano(hold);if(nano(ledger.spent)+nextReserved>nano(ceiling))throw new Error('Test budget would be exceeded');return {...ledger,reserved:Number(nextReserved)/1e9};}

// Inputs are already quoted to microUSD; sum their integer units, not float dollars.
export function sumMicroUsd(amounts){let sum=0n;for(const amount of amounts){const units=Math.round(amount*1e6);if(!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(units))throw Error('Invalid microUSD amount');sum+=BigInt(units);}if(sum>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Total exceeds safe currency arithmetic');return Number(sum)/1e6;}
