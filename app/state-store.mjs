import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';import path from 'node:path';
export function openState(directory){
 fs.mkdirSync(directory,{recursive:true});
 const lock=path.join(directory,'studio.lock');
 for(let attempt=0;;attempt++){
  try{fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx'});break;}
  catch(e){if(e.code!=='EEXIST')throw e;let owner;try{owner=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{throw new Error('Workspace lock is unreadable. Inspect it before starting another writer.');}
   let alive=true;try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
   if(alive||attempt>1)throw new Error('Workspace is already open. Stop the other server before maintenance.');
   fs.rmSync(lock,{force:true});
  }
 }
 const db=new DatabaseSync(path.join(directory,'studio.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS app_state(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL)');
 const row=db.prepare('SELECT body FROM app_state WHERE id=1').get();
 const legacy=path.join(directory,'manifest.json');const state=row?JSON.parse(row.body):fs.existsSync(legacy)?JSON.parse(fs.readFileSync(legacy,'utf8')):{projects:{},assets:{},candidates:{},jobs:{},spend:{spent:0,reserved:0}};
 const write=db.prepare('INSERT INTO app_state(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body');
 return {state,save:()=>write.run(JSON.stringify(state)),close:()=>{db.close();fs.rmSync(lock,{force:true});}};
}
