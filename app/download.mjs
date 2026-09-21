import fs from 'node:fs';import {Readable,Transform} from 'node:stream';import {pipeline} from 'node:stream/promises';
export async function saveDownload(body,target,maxBytes=200*1024*1024){
 if(!body)throw new Error('Candidate response has no body');let size=0;
 const limit=new Transform({transform(chunk,encoding,callback){size+=chunk.length;callback(size>maxBytes?new Error('Candidate exceeds download limit'):null,chunk);}});
 let owned=false;const file=fs.createWriteStream(target,{flags:'wx'});file.on('open',()=>{owned=true;});
 try{await pipeline(Readable.fromWeb(body),limit,file);}
 catch(error){if(owned)fs.rmSync(target,{force:true});throw error;}
 return size;
}
