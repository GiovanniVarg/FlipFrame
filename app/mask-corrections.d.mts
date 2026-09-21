export function mergeFrameMasks<T extends {time:number;points:[number,number][]}>(existing:T[],corrected:T[],fps?:number):T[];
export function compatibleMasks<T extends {time:number;points:[number,number][]}>(masks:T[]):T[];
