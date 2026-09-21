import test from 'node:test';import assert from 'node:assert/strict';
import {parseRecoveryDraft} from './src/draft-recovery.ts';
const file={projectId:'p',baseRevisionId:'r',editor:{points:[[.1,.2]]},conversation:{text:'unfinished',quality:'standard'}};
test('recovery accepts matching context and returns only draft payload',()=>{assert.deepEqual(parseRecoveryDraft(JSON.stringify(file),'p','r'),{baseRevisionId:'r',editor:file.editor,conversation:file.conversation});});
test('recovery refuses foreign project, stale geometry, invalid and oversized input',()=>{for(const value of ['null','[]','bad',JSON.stringify({...file,projectId:'other'}),JSON.stringify({...file,baseRevisionId:'old'}),JSON.stringify({...file,approved:true}),JSON.stringify({...file,editor:[]}),JSON.stringify({...file,conversation:{text:'x'.repeat(4*1024*1024)}})])assert.throws(()=>parseRecoveryDraft(value,'p','r'));});
