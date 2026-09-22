import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilities, buildVideoEditBody, buildTextToVideoBody, submitGeneration, pollGeneration, uploadAsset, estimateGeneration } from './providers.mjs';
const env = { HIGGSFIELD_API_KEY: 'test-id', HIGGSFIELD_API_SECRET: 'test-secret' };
const input = { kind: 'video', prompt: 'make jacket red', videoUrl: 'https://media.example/source.mp4' };
const statusUrl = 'https://api.higgsfield.ai/requests/123/status';
test('capabilities identify native soundtrack support and unsupported masks', () => {
  assert.equal(capabilities({}).higgsfieldVideo, false);
  assert.equal(capabilities(env).higgsfieldVideo, true);
  assert.equal(capabilities(env).higgsfieldAudio, true);
  assert.equal(capabilities(env).nativeAudio, true);
  assert.equal(capabilities({}).higgsfieldAudio, false);
  assert.equal(capabilities(env).tracking, false);
});
test('body contains only verified fields and rejects masks', () => {
  assert.deepEqual(buildVideoEditBody(input), { prompt: input.prompt, video_url: input.videoUrl, generate_audio: false });
  assert.throws(() => buildVideoEditBody({ ...input, mask: {} }), /schema/);
  assert.throws(() => buildVideoEditBody({ ...input, videoUrl: 'file:///video.mp4' }), /HTTPS/);
});
test('submission uses documented endpoint and auth; redirects disabled', async () => {
  const result = await submitGeneration(input, { env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.higgsfield.ai/bytedance/seedance-2.5/video-edit');
    assert.equal(options.headers.Authorization, 'Key test-id:test-secret');
    assert.equal(options.redirect, 'error');
    return Response.json({ status: 'queued', request_id: '123', status_url: statusUrl });
  } });
  assert.equal(result.requestId, '123');
  assert.equal(result.status, 'queued');
});
test('ambiguous POST is never replayed and is not labeled failed', async () => {
  let calls = 0;
  const result = await submitGeneration(input, { env, fetchImpl: async () => { calls++; throw new Error('connection reset'); } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'unknown');
});
test('malformed accepted response is ambiguous; definite rejection fails', async () => {
  assert.equal((await submitGeneration(input, { env, fetchImpl: async () => Response.json({}) })).status, 'unknown');
  assert.equal((await submitGeneration(input, { env, fetchImpl: async () => new Response('', { status: 401 }) })).status, 'failed');
});
test('poll resolves completed media and blocks hostile credential destinations', async () => {
  const job = { provider: 'higgsfield', kind: 'video', requestId: '123', statusUrl };
  const result = await pollGeneration(job, { env, fetchImpl: async () => Response.json({ status: 'completed', request_id: '123', video: { url: 'https://cdn.example/result.mp4' } }) });
  assert.equal(result.outputUrl, 'https://cdn.example/result.mp4');
  await assert.rejects(pollGeneration({ ...job, statusUrl: 'https://evil.example/status' }, { env, fetchImpl: () => assert.fail('must not fetch') }), /Unexpected provider URL/);
});
test('audio requests use verified native soundtrack route and return video container', async () => {
  const audioInput = { ...input, kind: 'audio', prompt: 'Rain and distant thunder', generateAudio: false };
  const bodies = [];
  const quote = await estimateGeneration(audioInput, { env, fetchImpl: async (url, options) => {
    assert.match(url, /estimate\/bytedance\/seedance-2.5\/video-edit$/);
    bodies.push(JSON.parse(options.body));
    return Response.json({ usd: '1.25' });
  } });
  const result = await submitGeneration(audioInput, { env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.higgsfield.ai/bytedance/seedance-2.5/video-edit');
    bodies.push(JSON.parse(options.body));
    return Response.json({ status: 'completed', request_id: '123', video: { url: 'https://cdn.example/soundtrack.mp4' } });
  } });
  assert.equal(quote.verified, true);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(bodies[0].generate_audio, true);
  assert.equal(result.kind, 'audio');
  assert.equal(result.outputKind, 'video-with-audio');
  assert.equal(result.outputUrl, 'https://cdn.example/soundtrack.mp4');
});
test('native audio requires source video and rejects unsupported voice selection', async () => {
  await assert.rejects(submitGeneration({ ...input, kind: 'audio', voiceId: 'voice' }, { env, fetchImpl: () => assert.fail('must not fetch') }), /Voice selection/);
  await assert.rejects(submitGeneration({ kind: 'audio', prompt: 'Rain' }, { env, fetchImpl: () => assert.fail('must not fetch') }));
});
test('upload forwards storage headers but never API auth', async () => {
  const calls = [];
  const url = await uploadAsset(new Uint8Array([1, 2]), 'video/mp4', { env, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return Response.json({ public_url: 'https://cdn.example/input.mp4', upload_url: 'https://bucket.s3.amazonaws.com/upload?signature=test', upload_headers: { 'Content-Type': 'video/mp4', 'x-amz-tagging': 'retention=temporary' } });
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers['x-amz-tagging'], 'retention=temporary');
    assert.equal(options.redirect, 'error');
    return new Response('', { status: 200 });
  } });
  assert.equal(calls.length, 2);
  assert.equal(url, 'https://cdn.example/input.mp4');
});
test('authenticated quote uses identical generation body and validates USD', async () => {
  const quote = await estimateGeneration(input, { env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.higgsfield.ai/estimate/bytedance/seedance-2.5/video-edit');
    assert.deepEqual(JSON.parse(options.body), buildVideoEditBody(input));
    return Response.json({ credits: '15', usd: '0.94' });
  } });
  assert.equal(quote.maximumUsd, 0.94);
  assert.equal(quote.bodyFingerprint, JSON.stringify(buildVideoEditBody(input)));
  await assert.rejects(estimateGeneration(input, { env, fetchImpl: async () => Response.json({ credits: '15' }) }), /missing/);
  await assert.rejects(estimateGeneration(input, { env, fetchImpl: async () => Response.json({ usd: '-1' }) }), /invalid/);
});

test('combined SDK credentials take precedence without entering client payload',async()=>{const combined={...env,HF_CREDENTIALS:'new-id:new-secret'};assert.equal(capabilities(combined).higgsfieldVideo,true);await submitGeneration(input,{env:combined,fetchImpl:async(url,options)=>{assert.equal(options.headers.Authorization,'Key new-id:new-secret');assert.ok(!options.body.includes('new-secret'));return Response.json({status:'queued',request_id:'123',status_url:statusUrl})}});assert.equal(capabilities({...env,HF_CREDENTIALS:'malformed'}).higgsfieldVideo,false);});

test('official SDK submit config disables retries and polling with isolated credentials',async()=>{
 let calls=0;
 const result=await submitGeneration(input,{env,sdkClientFactory:config=>{
  assert.equal(config.credentials,'test-id:test-secret');assert.equal(config.baseURL,'https://api.higgsfield.ai');assert.equal(config.maxRetries,0);assert.equal(config.timeout,30000);
  return {subscribe:async(endpoint,options)=>{calls++;assert.equal(endpoint,'bytedance/seedance-2.5/video-edit');assert.equal(options.withPolling,false);assert.deepEqual(options.input,buildVideoEditBody(input));return {request_id:'123',status:'queued'};}};
 }});
 assert.equal(calls,1);assert.equal(result.statusUrl,statusUrl);
});

test('SDK errors are sanitized and ambiguous submissions are never retried',async()=>{
 for(const error of [{name:'AuthenticationError',message:'sensitive'}, {statusCode:422,message:'sensitive'}, {statusCode:503,message:'sensitive'},new Error('sensitive')]){
  let calls=0;const result=await submitGeneration(input,{env,sdkClientFactory:()=>({subscribe:async()=>{calls++;throw error;}})});
  assert.equal(calls,1);assert.equal(result.status,error.name==='AuthenticationError'||error.statusCode===422?'failed':'unknown');assert.ok(!JSON.stringify(result).includes('sensitive'));
 }
});

test('accepted request identity survives malformed media response',async()=>{
 const result=await submitGeneration(input,{env,sdkClientFactory:()=>({subscribe:async()=>({request_id:'123',status:'completed'})})});
 assert.equal(result.status,'unknown');assert.equal(result.requestId,'123');assert.equal(result.statusUrl,statusUrl);
});

test('terminal status mapping and mismatched request IDs',async()=>{
 const job={requestId:'123',statusUrl};
 for(const status of ['failed','nsfw','canceled'])assert.equal((await pollGeneration(job,{env,fetchImpl:async()=>Response.json({status,request_id:'123'})})).status,status);
 await assert.rejects(pollGeneration(job,{env,fetchImpl:async()=>Response.json({status:'failed',request_id:'other'})}),/Mismatched/);
});

test('verified text-to-video uses same model/body for estimate and one SDK submission',async()=>{
 const creation={kind:'text-to-video',prompt:'Moving clouds',duration:4,aspectRatio:'9:16',resolution:'480p',generateAudio:false};
 const body=buildTextToVideoBody(creation);assert.equal(body.output_format,'mp4');assert.equal(body.duration,4);
 const quote=await estimateGeneration(creation,{env,fetchImpl:async(url,options)=>{assert.equal(url,'https://api.higgsfield.ai/estimate/bytedance/seedance-2.5/text-to-video');assert.deepEqual(JSON.parse(options.body),body);return Response.json({usd:'0.6'});}});
 assert.equal(quote.isHardCap,false);
 const result=await submitGeneration(creation,{env,sdkClientFactory:()=>({subscribe:async(endpoint,options)=>{assert.equal(endpoint,quote.endpoint);assert.deepEqual(options.input,body);return {request_id:'123',status:'completed',video:{url:'https://cdn.example/output.mp4'}};}})});
 assert.equal(result.status,'completed');assert.equal(result.outputKind,'video');
 for(const duration of [3,31,4.5])assert.throws(()=>buildTextToVideoBody({...creation,duration}),/integer/);
 assert.throws(()=>buildTextToVideoBody({...creation,resolution:'1080p'}),/resolution/);
 assert.equal('output_format' in buildVideoEditBody(input),false);
});

const pricingDescription='Token-metered pricing. Billable video tokens = ceil((input video seconds + generated video seconds) × output width × output height × 24 fps / 1024). Image and audio references do not count as video input. Video input is required. At 480p or 720p, each 1,000 video tokens cost $0.01284. Both input and generated video durations are billable. Rates shown are before any applicable customer discount.';
const formulaFetch=async()=>Response.json({type:'description',pricing_description:pricingDescription});
test('exact authenticated description computes rounded-up reservation without asserting hard cap',async()=>{
 const pricingDimensions={width:1280,height:720,inputSeconds:5,outputSeconds:5};
 const quote=await estimateGeneration({...input,pricingDimensions},{env,fetchImpl:formulaFetch});
 assert.equal(quote.billableVideoTokens,216000);assert.equal(quote.estimatedUsd,2.77344);assert.equal(quote.maximumUsd,2.77344);
 assert.equal(quote.verified,false);assert.equal(quote.formulaVerified,true);assert.equal(quote.isHardCap,false);assert.equal(quote.source,'provider-described-formula');
 assert.deepEqual(quote.pricingDimensions,pricingDimensions);assert.equal(quote.body.pricingDimensions,undefined);
 assert.equal(quote.bodyFingerprint,JSON.stringify(buildVideoEditBody(input)));
});
test('formula fails closed on changed descriptions, incompatible model and unsafe assumptions',async()=>{
 const pricingDimensions={width:1280,height:720,inputSeconds:5,outputSeconds:5};
 await assert.rejects(estimateGeneration({...input,pricingDimensions},{env,fetchImpl:async()=>Response.json({type:'description',pricing_description:pricingDescription.replace('$0.01284','$0.02284')})}),/Unrecognized/);
 await assert.rejects(estimateGeneration({kind:'text-to-video',prompt:'Clouds',pricingDimensions},{env,fetchImpl:formulaFetch}),/Unrecognized/);
 await assert.rejects(estimateGeneration(input,{env,fetchImpl:formulaFetch}),/pricingDimensions/);
 for(const invalid of [{width:NaN},{height:0},{width:1.5},{inputSeconds:0},{outputSeconds:Infinity},{width:640,height:480}]){
  await assert.rejects(estimateGeneration({...input,pricingDimensions:{...pricingDimensions,...invalid}},{env,fetchImpl:formulaFetch}),/dimensions|pricingDimensions/i);
 }
});

test('exact text-to-video description prices zero input seconds and requested output duration',async()=>{
 const description='Token-metered pricing. Billable video tokens = ceil((input video seconds + generated video seconds) × output width × output height × 24 fps / 1024). Image and audio references do not count as video input. At 480p or 720p, each 1,000 video tokens cost $0.0214. Rates shown are before any applicable customer discount.';
 const fetchImpl=async()=>Response.json({type:'description',pricing_description:description});
 const creation={kind:'text-to-video',prompt:'Clouds',duration:5,pricingDimensions:{width:1280,height:720,inputSeconds:0,outputSeconds:5}};
 const quote=await estimateGeneration(creation,{env,fetchImpl});
 assert.equal(quote.billableVideoTokens,108000);assert.equal(quote.estimatedUsd,2.3112);assert.equal(quote.formulaVerified,true);assert.equal(quote.verified,false);assert.equal(quote.isHardCap,false);
 await assert.rejects(estimateGeneration({...creation,pricingDimensions:{...creation.pricingDimensions,inputSeconds:1}},{env,fetchImpl}),/pricingDimensions/);
 await assert.rejects(estimateGeneration({...creation,pricingDimensions:{...creation.pricingDimensions,outputSeconds:4}},{env,fetchImpl}),/duration/);
});

test('upload network and timeout failures are actionable and never reveal signed URLs',async()=>{
 for(const phase of ['preparation','storage'])for(const name of ['TimeoutError','TypeError']){
  let calls=0;
  await assert.rejects(uploadAsset(new Uint8Array([1]),'video/mp4',{env,fetchImpl:async()=>{
   calls++;
   if(phase==='storage'&&calls===1)return Response.json({upload_url:'https://bucket.s3.amazonaws.com/upload?secret=hidden',public_url:'https://cdn.example/input.mp4',upload_headers:{'Content-Type':'video/mp4'}});
   throw Object.assign(new Error('https://bucket.s3.amazonaws.com/upload?secret=hidden'),{name});
  }}),error=>{assert.equal(error.message,`Higgsfield source upload ${name==='TimeoutError'?'timed out':'failed'}; no generation submitted. Retry preparation.`);return true;});
  assert.equal(calls,phase==='storage'?2:1);
 }
});

test('platform response status URLs never redirect credentials or break completed jobs',async()=>{
 const requestId='6b1e2fac-d311-447e-b830-c43ff386513e';
 const canonical=`https://api.higgsfield.ai/requests/${requestId}/status`;
 const response={request_id:requestId,status:'queued',status_url:`https://platform.higgsfield.ai/requests/${requestId}/status`};
 const accepted=await submitGeneration(input,{env,sdkClientFactory:()=>({subscribe:async()=>response})});
 assert.equal(accepted.status,'queued');assert.equal(accepted.statusUrl,canonical);
 const completed=await pollGeneration(accepted,{env,fetchImpl:async(url)=>{assert.equal(url,canonical);return Response.json({...response,status:'completed',video:{url:'https://cdn.example/completed.mp4'}});}});
 assert.equal(completed.status,'completed');assert.equal(completed.statusUrl,canonical);
 const hostile=await submitGeneration(input,{env,sdkClientFactory:()=>({subscribe:async()=>({...response,status_url:'https://evil.example/steal'})})});
 assert.equal(hostile.statusUrl,canonical);
});

test('GET status retries transient failures without resubmitting generation',async()=>{
 let calls=0;
 const completed=await pollGeneration({requestId:'123',statusUrl},{env,retryDelayMs:0,fetchImpl:async(url,options)=>{
  assert.equal(options.method,'GET');assert.equal(url,statusUrl);calls++;
  if(calls===1)throw new Error('secret network details');if(calls===2)return new Response('',{status:503});
  return Response.json({request_id:'123',status:'completed',video:{url:'https://cdn.example/result.mp4'}});
 }});
 assert.equal(calls,3);assert.equal(completed.status,'completed');
});
test('GET retry limit and permanent/schema errors fail closed',async()=>{
 for(const scenario of ['network','429','500','401','json','schema']){
  let calls=0;
  await assert.rejects(pollGeneration({requestId:'123',statusUrl},{env,retryDelayMs:0,fetchImpl:async()=>{
   calls++;if(scenario==='network')throw new Error('SECRET');
   if(scenario==='json')return new Response('not JSON');if(scenario==='schema')return Response.json({request_id:'123',status:'unrecognized'});
   return new Response('',{status:Number(scenario)});
  }}),error=>{assert.ok(!error.message.includes('SECRET'));return true;});
  assert.equal(calls,['network','429','500'].includes(scenario)?3:1);
 }
});


test('known accepted dimension failure becomes a curated actionable category without inferring provider limits',async()=>{
 const known='The video dimensions or aspect ratio are not supported by this model. Resize the video and try again.';
 for(const error of [known]){
  let calls=0;const result=await pollGeneration({requestId:'123',statusUrl},{env,fetchImpl:async()=>{calls++;return Response.json({status:'failed',request_id:'123',error});}});
  assert.equal(calls,1);assert.equal(result.status,'failed');assert.equal(result.requestId,'123');assert.equal(result.failureCategory,'unsupported_video_dimensions');
  assert.match(result.error,/Verify supported input dimensions/);assert.match(result.error,/failed requests are not charged/);
  assert.ok(!result.error.includes(known));assert.ok(!/SECRET|private.invalid|640|720/.test(JSON.stringify(result)));
 }
});

test('unrecognized, modified and misplaced failure strings remain generic and cannot leak metadata',async()=>{
 const known='The video dimensions or aspect ratio are not supported by this model. Resize the video and try again.';
 for(const payload of [{error:'SECRET https://private.invalid'},{error:known+' SECRET'},{error:{message:known+' https://private.invalid'}},{message:known},{error:{detail:known}},{error:{message:known,debug:'SECRET'}},{error:[known]}]){
  const result=await pollGeneration({requestId:'123',statusUrl},{env,fetchImpl:async()=>Response.json({status:'failed',request_id:'123',...payload})});
  assert.equal(result.error,'Higgsfield generation failed.');assert.equal(result.failureCategory,null);assert.ok(!/SECRET|private.invalid/.test(JSON.stringify(result)));
 }
});

test('dimension classification preserves accepted submission identity and does not override other statuses',async()=>{
 const known='The video dimensions or aspect ratio are not supported by this model. Resize the video and try again.';
 let posts=0;const result=await submitGeneration(input,{env,fetchImpl:async()=>{posts++;return Response.json({request_id:'123',status:'failed',error:known});}});
 assert.equal(posts,1);assert.equal(result.requestId,'123');assert.equal(result.status,'failed');assert.equal(result.failureCategory,'unsupported_video_dimensions');
 for(const status of ['queued','nsfw','canceled']){
  const polled=await pollGeneration({...result,statusUrl},{env,fetchImpl:async()=>Response.json({request_id:'123',status,error:known})});
  assert.equal(polled.failureCategory,null);assert.equal(polled.error,status==='queued'?null:`Higgsfield generation ${status}.`);
 }
});

 test('upload permission failures explain the server restriction without exposing secrets',async()=>{
 for(const code of ['EACCES','EPERM'])await assert.rejects(uploadAsset(new Uint8Array([1]),'video/mp4',{env,fetchImpl:async()=>{throw Object.assign(new Error('private signed URL'),{cause:{code}});}}),error=>{assert.match(error.message,/server.s network permissions/);assert.match(error.message,/No generation was submitted/);assert.doesNotMatch(error.message,/private signed/);return true;});
 });

test('object reference uses documented image_urls without sending masks',()=>{const body=buildVideoEditBody({...input,imageUrls:['https://media.example/reference.png']});assert.deepEqual(body.image_urls,['https://media.example/reference.png']);assert.equal(body.masks,undefined);assert.throws(()=>buildVideoEditBody({...input,imageUrls:['http://bad.example/ref.png']}),/HTTPS/);});
test('reference-to-video passes user images to the same reviewed provider body',async()=>{
 const creation={kind:'reference-to-video',prompt:'A rotating product',duration:5,aspectRatio:'16:9',imageUrls:['https://media.example/ref1.png','https://media.example/ref2.png']};let quoted;
 const q=await estimateGeneration(creation,{env,fetchImpl:async(url,options)=>{assert.match(url,/reference-to-video$/);quoted=JSON.parse(options.body);assert.deepEqual(quoted.image_urls,creation.imageUrls);assert.equal(quoted.video_urls,undefined);return Response.json({usd:2});}});
 const result=await submitGeneration(creation,{env,sdkClientFactory:()=>({subscribe:async(endpoint,options)=>{assert.equal(endpoint,q.endpoint);assert.deepEqual(options.input,quoted);return {request_id:'refs',status:'queued'};}})});assert.equal(result.status,'queued');
 await assert.rejects(()=>estimateGeneration({...creation,imageUrls:[]},{env}),/reference/);
 await assert.rejects(()=>estimateGeneration({...creation,imageUrls:['http://bad.example/image.png']},{env}),/HTTPS/);
});

 test('reference pricing uses authenticated no-video-input rate and rejects modified descriptions',async()=>{const input={kind:'reference-to-video',prompt:'Blue mug',imageUrls:['https://example.com/ref.png'],duration:5,resolution:'720p',aspectRatio:'16:9',pricingDimensions:{width:1280,height:720,inputSeconds:0,outputSeconds:5}};const description='Token-metered pricing. Billable video tokens = ceil((input video seconds + generated video seconds) × output width × output height × 24 fps / 1024). Image and audio references do not count as video input. At 480p or 720p, each 1,000 video tokens cost $0.0214 without video input or $0.01284 with video input (0.6× the standard rate). With video references, both input and generated video durations are billable. Rates shown are before any applicable customer discount.';const fetchImpl=async()=>new Response(JSON.stringify({type:'description',pricing_description:description}),{status:200});const quote=await estimateGeneration(input,{env:{HF_CREDENTIALS:'id:secret'},fetchImpl});assert.equal(quote.estimatedUsd,2.3112);await assert.rejects(()=>estimateGeneration(input,{env:{HF_CREDENTIALS:'id:secret'},fetchImpl:async()=>new Response(JSON.stringify({type:'description',pricing_description:description+' changed'}),{status:200})}),/Unrecognized/);});

test('estimate network failures explain safe retry without exposing internals',async()=>{
 for(const code of ['EACCES','ETIMEDOUT'])await assert.rejects(estimateGeneration({kind:'text-to-video',prompt:'A bowl',duration:5,resolution:'720p',aspectRatio:'16:9'},{env,fetchImpl:async()=>{throw Object.assign(new Error('fetch failed'),{cause:{code}})}}),code==='EACCES'?/network permissions.*No generation was submitted/:/Retry Review cost.*No generation was submitted/);
});
