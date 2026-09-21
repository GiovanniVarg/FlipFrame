export function editImpact(action:string):{changes:string;preserves:string;review:string}|null;
export function generationButton(plan:{route?:{kind?:string;estimatedUsd?:number}}):string;
export function editScope(plan:{start:number;end:number},duration:number,fps?:number):string;
export function reservationLabel(plan:{route?:{kind?:string;estimatedUsd?:number}},job?:{billing?:string}):string|null;
