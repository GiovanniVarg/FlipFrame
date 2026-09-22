import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEdit} from './decision-router.mjs';
const request={text:'Please make the music feel a little softer',context:{availableCapabilities:['gain']}};
function fake(provider,answer={action:'gain',confidence:.95},inspect=()=>{}) {return async(url,options)=>{inspect(url,options);const text=JSON.stringify(answer);return new Response(JSON.stringify(provider==='anthropic'?{content:[{type:'text',text}]}:provider==='gemini'?{candidates:[{content:{parts:[{text}]}}]}:{choices:[{message:{content:text}}]}));};}
for(const provider of ['openai-compatible','anthropic','gemini']) {
  const env={REASONING_PROVIDER:provider,LLM_MODEL:'test-model',LLM_API_KEY:'fake-test-key'};
  test(provider+' classifies through native wire format',async()=>{
    const result=await classifyEdit(request,{env,fetchImpl:fake(provider,undefined,(url,options)=>{
      assert.equal(options.redirect,'error');assert.ok(options.signal);const body=JSON.parse(options.body);assert.ok(!url.includes('fake-test-key'));
      if(provider==='anthropic'){assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(options.headers['x-api-key'],'fake-test-key');assert.ok(body.system);}
      if(provider==='gemini'){assert.match(url,/models\/test-model:generateContent$/);assert.ok(body.systemInstruction);assert.equal(options.headers['x-goog-api-key'],'fake-test-key');}
      if(provider==='openai-compatible'){assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(body.response_format.type,'json_object');}
    })});assert.equal(result.action,'gain');assert.equal(result.source,provider);
  });
  test(provider+' rejects model-generated arguments and unknown actions',async()=>{for(const answer of [{action:'gain',confidence:.99,args:{url:'https://bad.test'}},{action:'shell',confidence:.99},{action:'gain',confidence:2}])assert.equal((await classifyEdit(request,{env,fetchImpl:fake(provider,answer)})).action,'clarify');});
  test(provider+' rejects uncertainty and unavailable capabilities',async()=>{assert.equal((await classifyEdit(request,{env,fetchImpl:fake(provider,{action:'gain',confidence:.5})})).reason,'uncertain_intent');assert.equal((await classifyEdit(request,{env,fetchImpl:fake(provider,{action:'mute',confidence:.99})})).action,'unsupported');});
  test(provider+' keeps rules local and redacts error details',async()=>{assert.equal((await classifyEdit({text:'pause'},{env,fetchImpl:()=>{throw Error('must not call');}})).source,'rules');assert.equal((await classifyEdit(request,{env,fetchImpl:()=>{throw Error('fake-test-key');}})).reason,'router_unavailable');});
}
test('custom compatible URL is configuration-only and loopback supports no key',async()=>{const result=await classifyEdit(request,{env:{REASONING_PROVIDER:'openai-compatible',LLM_MODEL:'local',LLM_BASE_URL:'http://127.0.0.1:11434/v1'},fetchImpl:fake('openai-compatible',undefined,(url,options)=>{assert.equal(url,'http://127.0.0.1:11434/v1/chat/completions');assert.equal(options.headers.Authorization,undefined);})});assert.equal(result.action,'gain');});
test('unsafe base URLs cannot receive credentials',async()=>{for(const base of ['http://remote.test/v1','https://user:pass@host.test/v1','https://host.test/v1?key=x']){assert.equal((await classifyEdit(request,{env:{REASONING_PROVIDER:'openai-compatible',LLM_MODEL:'test',LLM_API_KEY:'fake',LLM_BASE_URL:base},fetchImpl:()=>{throw Error('must not call');}})).reason,'router_not_configured');}});
test('references are omitted from model state',async()=>{await classifyEdit({text:'Soften this track https://example.com/private',context:{}},{env:{REASONING_PROVIDER:'anthropic',LLM_MODEL:'test',LLM_API_KEY:'fake'},fetchImpl:fake('anthropic',undefined,(_url,options)=>assert.ok(!options.body.includes('https://example.com/private')))});});
