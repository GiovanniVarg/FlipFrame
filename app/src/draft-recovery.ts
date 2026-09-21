// Recovery files restore unfinished settings only. Server validation remains authoritative.
export function parseRecoveryDraft(raw:string,projectId:string,revisionId:string){
 if(new TextEncoder().encode(raw).length>4*1024*1024)throw Error('Recovery file exceeds 4 MiB.');
 let value;try{value=JSON.parse(raw)}catch{throw Error('Choose a valid recovery JSON file.');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['projectId','baseRevisionId','editor','conversation'].includes(key)))throw Error('This is not a Video Gen Lab recovery file.');
 if(value.projectId!==projectId)throw Error('This recovery file belongs to another project. Open that project first.');
 if(value.baseRevisionId!==revisionId)throw Error('This recovery file belongs to another revision. Its boundaries cannot be reused on the current video.');
 for(const key of ['editor','conversation'])if(!value[key]||typeof value[key]!=='object'||Array.isArray(value[key]))throw Error('Recovery settings are missing or invalid.');
 return {baseRevisionId:revisionId,editor:value.editor,conversation:value.conversation};
}
