// Server-only adapters. No provider text, commands, URLs, or execution arguments
// ever cross this boundary. The editor validates and executes known actions.
export async function classifyWithLlm({text,context,instructions,criteria,actions}, {env={},fetchImpl=fetch}={}) {
  const fail=reason=>({error:reason});
  const provider=env.REASONING_PROVIDER;
  const model=typeof env.LLM_MODEL==='string'?env.LLM_MODEL.trim():'';
  const key=typeof env.LLM_API_KEY==='string'?env.LLM_API_KEY.trim():'';
  if(!model || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model) || /[\r\n]/.test(key))return fail('router_not_configured');
  const system=instructions+' Return only a JSON object with exactly action (one allowed action) and confidence (number 0 to 1). No other fields. Allowed action criteria: '+JSON.stringify(criteria);
  const user=JSON.stringify({text,context});
  let url,headers={'Content-Type':'application/json'},body;
  try {
    if(provider==='openai-compatible') {
      const base=new URL(env.LLM_BASE_URL||'https://api.openai.com/v1');
      const local=['localhost','127.0.0.1','[::1]'].includes(base.hostname);
      if(base.username||base.password||base.search||base.hash||!(base.protocol==='https:'||base.protocol==='http:'&&local))return fail('router_not_configured');
      if(!key&&!local)return fail('router_not_configured');
      url=base.href.replace(/\/$/,'')+'/chat/completions';
      if(key)headers.Authorization=`Bearer ${key}`;
      body={model,messages:[{role:'system',content:system},{role:'user',content:user}],response_format:{type:'json_object'}};
    } else if(provider==='anthropic') {
      if(!key)return fail('router_not_configured');
      url='https://api.anthropic.com/v1/messages';headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';
      body={model,max_tokens:256,system,messages:[{role:'user',content:user}]};
    } else if(provider==='gemini') {
      if(!key)return fail('router_not_configured');
      url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//,''))}:generateContent`;headers['x-goog-api-key']=key;
      body={systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:512}};
    } else return fail('router_not_configured');
    const response=await fetchImpl(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok)return fail([401,403].includes(response.status)?'router_authentication_failed':'router_unavailable');
    const raw=await response.text();
    if(raw.length>65536)return fail('invalid_model_response');
    const data=JSON.parse(raw);
    const content=provider==='anthropic'?data.content?.filter(item=>item.type==='text').map(item=>item.text).join(''):provider==='gemini'?data.candidates?.[0]?.content?.parts?.map(item=>item.text||'').join(''):data.choices?.[0]?.message?.content;
    if(typeof content!=='string'||content.length>2048)return fail('invalid_model_response');
    const answer=JSON.parse(content);
    if(!answer||Array.isArray(answer)||Object.keys(answer).length!==2||!actions.includes(answer.action)||typeof answer.confidence!=='number'||!Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1)return fail('invalid_model_response');
    return {action:answer.action,confidence:answer.confidence,model,provider};
  } catch {return fail('router_unavailable');}
}
