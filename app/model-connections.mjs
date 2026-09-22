export const REASONING_PROVIDERS = Object.freeze([
  {id:'jev', label:'Jev (TypeSafe)', protocol:'typesafe-choice'},
  {id:'openai-compatible', label:'OpenAI or compatible server', protocol:'chat-completions'},
  {id:'anthropic', label:'Anthropic Claude', protocol:'messages'},
  {id:'gemini', label:'Google Gemini', protocol:'generate-content'},
]);
export const VIDEO_PROVIDERS = Object.freeze([{id:'higgsfield',label:'Higgsfield / Seedance 2.5',capabilities:['text-to-video','reference-to-video','video-edit','native-audio'],nativeMasks:false}]);
// New video integrations must implement these operations and declare their own
// input restrictions. Supplying a model name alone cannot supply an adapter.
export const VIDEO_ADAPTER_CONTRACT = Object.freeze({methods:['estimate','submit','poll','cancel'],requiredCapabilities:['kinds','nativeMasks','audio'],requiresImplementation:true});
export function reasoningProvider(env={}) { return env.REASONING_PROVIDER || 'jev'; }
export function reasoningConfigured(env={}) {
  const provider=reasoningProvider(env);
  if(provider==='jev')return Boolean(env.TYPESAFE_API_KEY);
  if(!REASONING_PROVIDERS.some(item=>item.id===provider))return false;
  return Boolean(env.LLM_MODEL && (env.LLM_API_KEY || provider==='openai-compatible' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(env.LLM_BASE_URL||'')));
}
export function modelConnections(env={}) {
  return {reasoning:{provider:reasoningProvider(env),configured:reasoningConfigured(env),providers:REASONING_PROVIDERS},video:{provider:'higgsfield',providers:VIDEO_PROVIDERS,extension:VIDEO_ADAPTER_CONTRACT}};
}
