export const LOCAL_TOOLS:Record<string,{title:string,command:string,criterion:string,preserves:string,mask?:boolean,reference?:boolean,corners?:boolean,whole?:boolean,timeline?:boolean}>;
export function directLocalTool(text:string):string|null;
export function localParameters(id:string,text:string):Record<string,unknown>;
