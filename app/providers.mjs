import { createHiggsfieldClient } from '@higgsfield/client/v2';
// Contracts verified against Higgsfield's public API reference, September 19, 2026.
// https://open.higgsfield.ai/models/bytedance/seedance-2.5/video-edit/api-reference
// https://docs.higgsfield.ai/docs/concepts/requests
const API = 'https://api.higgsfield.ai';
const AUDIO_REASON = 'Native soundtrack via Seedance video edit. Requires a source video; returns a video container whose generated audio must be extracted and checked. This is not standalone TTS or voice cloning.';
const MASK_REASON = 'The public Seedance video-edit schema does not accept masks or timestamps. Exact object boundaries and timing must be applied by the local reviewed compositor.';

export function capabilities(env = process.env) {
  const credentials = Boolean(env.HF_CREDENTIALS ? /^[^:\s]+:[^:\s]+$/.test(env.HF_CREDENTIALS) : env.HIGGSFIELD_API_KEY && env.HIGGSFIELD_API_SECRET);
  return { higgsfieldVideo: credentials, higgsfieldAudio: credentials, nativeAudio: credentials, higgsfieldTextToVideo: credentials, standaloneTts: false, voiceCloning: false, providerMasks: false, tracking: false,
    reasons: { higgsfieldVideo: credentials ? null : 'Set server-side HF_CREDENTIALS in .env.local (key-id:key-secret).', higgsfieldAudio: AUDIO_REASON, tracking: MASK_REASON } };
}

function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('A credential-free HTTPS URL is required.');
  return url;
}

function providerUrl(value) {
  const url = httpsUrl(value);
  if (url.origin !== API) throw new Error('Unexpected provider URL.');
  return url.href;
}

export function buildVideoEditBody(input) {
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('A video edit prompt is required.');
  if (input.mask || input.maskUrl || input.sketch || input.sketchUrl || input.tracking || input.timestamp != null) throw new Error(MASK_REASON);
  if (input.voiceId || input.voiceType || input.voice_id || input.voice_type) throw new Error('Voice selection is not supported by the native Seedance soundtrack endpoint.');
  if (input.generateAudio != null && typeof input.generateAudio !== 'boolean') throw new Error('generateAudio must be a boolean.');
  if(input.imageUrls!==undefined&&(!Array.isArray(input.imageUrls)||input.imageUrls.length!==1))throw new Error('Object guidance requires one reference image.');
  return { ...(input.imageUrls?{image_urls:input.imageUrls.map(url=>httpsUrl(url).href)}:{}), prompt: input.prompt.trim(), video_url: httpsUrl(input.videoUrl).href,
    generate_audio: input.kind === 'audio' ? true : input.generateAudio ?? false, ...videoOptions(input) };
}

function videoOptions(input) {
  const result = {};
  for (const [field, output, allowed] of [['resolution', 'resolution', ['480p', '720p']], ['bitrateMode', 'bitrate_mode', ['standard', 'high']]]) {
    if (input[field] !== undefined) {
      if (!allowed.includes(input[field])) throw new Error(`Unsupported ${field}.`);
      result[output] = input[field];
    }
  }
  return result;
}

// Current model input_schema: https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference
export function buildTextToVideoBody(input) {
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('A video prompt is required.');
  if (input.videoUrl || input.voiceId || input.mask || input.maskUrl) throw new Error('Text-to-video does not accept a source, mask, or selected voice.');
  const duration = input.duration ?? 5;
  if (!Number.isInteger(duration) || duration < 4 || duration > 30) throw new Error('Text-to-video duration must be an integer from 4 to 30 seconds.');
  const aspectRatio = input.aspectRatio ?? '16:9';
  if (!['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'].includes(aspectRatio)) throw new Error('Unsupported aspect ratio.');
  if (input.generateAudio != null && typeof input.generateAudio !== 'boolean') throw new Error('generateAudio must be a boolean.');
  return { prompt: input.prompt.trim(), duration, aspect_ratio: aspectRatio, resolution: '720p', bitrate_mode: 'high', ...videoOptions(input), output_format: 'mp4', generate_audio: input.generateAudio ?? true };
}

function generationContract(input) {
  if(input.kind==='reference-to-video'){if(!Array.isArray(input.imageUrls)||!input.imageUrls.length||input.imageUrls.length>4)throw new Error('Attach 1–4 reference images.');return {endpoint:'bytedance/seedance-2.5/reference-to-video',body:{...buildTextToVideoBody(input),image_urls:input.imageUrls.map(url=>httpsUrl(url).href)}};}
  if (input.kind === 'text-to-video') return { endpoint: 'bytedance/seedance-2.5/text-to-video', body: buildTextToVideoBody(input) };
  if (!['video', 'video-edit', 'audio'].includes(input.kind)) throw new Error('Unsupported generation kind.');
  return { endpoint: 'bytedance/seedance-2.5/video-edit', body: buildVideoEditBody(input) };
}

function authorization(env) {
  if (!capabilities(env).higgsfieldVideo) throw new Error(capabilities(env).reasons.higgsfieldVideo);
  return `Key ${env.HF_CREDENTIALS || `${env.HIGGSFIELD_API_KEY}:${env.HIGGSFIELD_API_SECRET}`}`;
}

async function request(url, options, fetchImpl, timeoutMs) {
  return fetchImpl(providerUrl(url), { ...options, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
}

const UNSUPPORTED_DIMENSIONS_MESSAGE='The video dimensions or aspect ratio are not supported by this model. Resize the video and try again.';
function safeGenerationFailure(data){
  if(!['failed','nsfw','canceled'].includes(data.status))return {error:null,failureCategory:null};
  // Exact allowlist, never echo arbitrary provider messages or recursively scan
  // metadata. This category establishes no particular minimum size/aspect ratio.
  const message=typeof data.error==='string'?data.error:undefined;
  if(data.status==='failed'&&message===UNSUPPORTED_DIMENSIONS_MESSAGE)return {
    failureCategory:'unsupported_video_dimensions',
    error:'Higgsfield rejected the source video dimensions or aspect ratio. Verify supported input dimensions and prepare a compatible source before reviewing a new request. Provider-confirmed failed requests are not charged; the app releases their budget reservation.',
  };
  return {error:`Higgsfield generation ${data.status}.`,failureCategory:null};
}

function normalize(data, previous) {
  const requestId = data.request_id || previous.requestId;
  // Response status_url is advisory: the live service also emits platform.higgsfield.ai.
  // Always derive the documented canonical API route; never forward credentials there.
  const statusUrl = typeof requestId === 'string' && requestId ? `${API}/requests/${encodeURIComponent(requestId)}/status` : undefined;
  const statuses = ['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled'];
  if (typeof requestId !== 'string' || !requestId || requestId.length > 200 || !statuses.includes(data.status)) throw new Error('Unrecognized provider response.');
  if (previous.requestId && requestId !== previous.requestId) throw new Error('Mismatched provider request.');
  const output = data.video?.url;
  const outputUrl = output ? httpsUrl(output).href : undefined;
  if (data.status === 'completed' && !outputUrl) throw new Error('Completed provider response has no media URL.');
  if (!statusUrl && ['queued', 'in_progress'].includes(data.status)) throw new Error('Provider response has no status URL.');
  return { ...previous, provider: 'higgsfield', requestId, statusUrl, status: data.status, outputUrl,
    ...safeGenerationFailure(data) };
}

export async function submitGeneration(input, { env = process.env, fetchImpl, sdkClientFactory = createHiggsfieldClient, timeoutMs = 30000 } = {}) {
  const { endpoint, body } = generationContract(input);
  const auth = authorization(env);
  const base = { provider: 'higgsfield', kind: input.kind, endpoint, outputKind: input.kind === 'audio' ? 'video-with-audio' : 'video' };
  let accepted;
  // One POST only. SDK retries and automatic polling must remain disabled.
  try {
    if (fetchImpl) {
      const response = await request(`${API}/${endpoint}`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fetchImpl, timeoutMs);
      if (!response.ok) throw { statusCode: response.status };
      accepted = await response.json();
    } else {
      const client = sdkClientFactory({ credentials: auth.slice(4), baseURL: API, maxRetries: 0, timeout: timeoutMs });
      accepted = await client.subscribe(endpoint, { input: body, withPolling: false });
    }
    return normalize(accepted, base);
  } catch (error) {
    const statusCode = error?.name === 'AuthenticationError' ? 401 : error?.statusCode;
    const rejected = [400, 401, 403, 404, 422, 429].includes(statusCode);
    // Keep an accepted ID even if another response field is malformed. Never expose SDK error text/headers.
    const requestId = typeof accepted?.request_id === 'string' && accepted.request_id.length <= 200 ? accepted.request_id : undefined;
    return { ...base, ...(requestId ? { requestId, statusUrl: `${API}/requests/${encodeURIComponent(requestId)}/status` } : {}), status: rejected ? 'failed' : 'unknown',
      error: rejected ? `Higgsfield submission returned HTTP ${statusCode}.` : 'Higgsfield acceptance is unknown after a connection or response error. Check provider request history before any new submission.' };
  }
}

export async function pollGeneration(job, { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 30000, retryDelayMs = 500 } = {}) {
  if (!job.statusUrl) throw new Error('No verified provider status URL is available; check provider request history.');
  const url = providerUrl(job.statusUrl);
  const headers = { Authorization: authorization(env) };
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10000) throw new Error('Invalid polling retry delay.');
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await request(url, { method: 'GET', headers }, fetchImpl, timeoutMs); }
    catch {
      if (attempt === 2) throw new Error('Higgsfield status check failed after three connection attempts. The existing request may still be processing; retry its status check.');
    }
    if (response) {
      if (response.ok) {
        // Parsing and contract errors are not transient network errors; do not retry them.
        let data;
        try { data = await response.json(); } catch { throw new Error('Higgsfield status check returned invalid JSON.'); }
        return normalize(data, job);
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) throw new Error(`Higgsfield status check returned HTTP ${response.status}.`);
    }
    await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
  }
}

// Match the authenticated provider description exactly. A wording/rate change requires review.
const VIDEO_EDIT_PRICING_DESCRIPTION = 'Token-metered pricing. Billable video tokens = ceil((input video seconds + generated video seconds) \u00d7 output width \u00d7 output height \u00d7 24 fps / 1024). Image and audio references do not count as video input. Video input is required. At 480p or 720p, each 1,000 video tokens cost $0.01284. Both input and generated video durations are billable. Rates shown are before any applicable customer discount.';

const TEXT_TO_VIDEO_PRICING_DESCRIPTION = 'Token-metered pricing. Billable video tokens = ceil((input video seconds + generated video seconds) \u00d7 output width \u00d7 output height \u00d7 24 fps / 1024). Image and audio references do not count as video input. At 480p or 720p, each 1,000 video tokens cost $0.0214. Rates shown are before any applicable customer discount.';

const REFERENCE_TO_VIDEO_PRICING_DESCRIPTION = 'Token-metered pricing. Billable video tokens = ceil((input video seconds + generated video seconds) × output width × output height × 24 fps / 1024). Image and audio references do not count as video input. At 480p or 720p, each 1,000 video tokens cost $0.0214 without video input or $0.01284 with video input (0.6× the standard rate). With video references, both input and generated video durations are billable. Rates shown are before any applicable customer discount.';

function describedVideoEditEstimate(data, input, endpoint, body) {
  const textToVideo = ['bytedance/seedance-2.5/text-to-video','bytedance/seedance-2.5/reference-to-video'].includes(endpoint);
  if ((!textToVideo && endpoint !== 'bytedance/seedance-2.5/video-edit') || data.type !== 'description' || data.pricing_description !== (endpoint === 'bytedance/seedance-2.5/reference-to-video' ? REFERENCE_TO_VIDEO_PRICING_DESCRIPTION : textToVideo ? TEXT_TO_VIDEO_PRICING_DESCRIPTION : VIDEO_EDIT_PRICING_DESCRIPTION)) throw new Error('Unrecognized provider pricing description. No generation was submitted.');
  const dimensions = input.pricingDimensions;
  if (!dimensions || typeof dimensions !== 'object') throw new Error('Explicit pricingDimensions are required for the provider formula.');
  const { width, height, inputSeconds, outputSeconds } = dimensions;
  if (![width, height].every(v => Number.isSafeInteger(v) && v > 0 && v <= 16384) || !Number.isFinite(inputSeconds) || inputSeconds > 3600 || (textToVideo ? inputSeconds !== 0 : inputSeconds <= 0) || !Number.isFinite(outputSeconds) || outputSeconds <= 0 || outputSeconds > 3600) throw new Error('Invalid pricingDimensions: provide positive integer dimensions and positive finite input/output seconds.');
  if (textToVideo && outputSeconds < body.duration) throw new Error('Pricing output seconds must cover the requested generation duration.');
  const resolution = Number((body.resolution || '720p').slice(0, -1));
  if (Math.min(width, height) < resolution) throw new Error('Pricing dimensions must conservatively cover the selected output resolution.');
  const tokens = Math.ceil((inputSeconds + outputSeconds) * width * height * 24 / 1024);
  if (!Number.isSafeInteger(tokens)) throw new Error('Pricing dimensions exceed safe arithmetic limits.');
  // Rates: edit 1.284 cents / 1000 tokens; text-to-video 2.14 cents. Round upward to a full cent.
  const amount = Math.ceil(tokens * (textToVideo ? 2140 : 1284) / 1000000) / 100;
  return { verified: false, formulaVerified: true, isHardCap: false, endpoint, maximumUsd: amount, estimatedUsd: amount,
    billableVideoTokens: tokens, pricingDimensions: { width, height, inputSeconds, outputSeconds },
    body, bodyFingerprint: JSON.stringify(body), quotedAt: new Date().toISOString(), source: 'provider-described-formula',
    assumption: 'Caller dimensions and durations are reservation assumptions, not provider-enforced output limits.' };
}

// https://docs.higgsfield.ai/docs/concepts/billing-and-retention
export async function estimateGeneration(input, { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
  const { endpoint, body } = generationContract(input);
  let response;
  try { response = await request(`${API}/estimate/${endpoint}`, { method: 'POST', headers: { Authorization: authorization(env), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fetchImpl, timeoutMs); }
  catch(error) {
    const code=error?.cause?.code??error?.code;
    throw new Error(['EACCES','EPERM'].includes(code)?'Cost review blocked by this server’s network permissions. Allow outbound HTTPS for the server, then retry Review cost. No generation was submitted.':'Could not reach Higgsfield for a cost estimate. Retry Review cost when the connection is available. No generation was submitted.');
  }
  if (!response.ok) throw new Error(`Higgsfield estimate returned HTTP ${response.status}. No generation was submitted.`);
  const data = await response.json();
  if (data.type === 'description') return describedVideoEditEstimate(data, input, endpoint, body);
  if (!['string', 'number'].includes(typeof data.usd) || String(data.usd).trim() === '') throw new Error('Provider estimate is missing its USD amount.');
  const amount = Number(data.usd);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Provider estimate has an invalid USD amount.');
  return { verified: true, isHardCap: false, endpoint, maximumUsd: amount, estimatedUsd: amount, credits: data.credits, body, bodyFingerprint: JSON.stringify(body), quotedAt: new Date().toISOString(), source: 'authenticated-provider-estimate' };
}

// The upload destination is signed storage selected by Higgsfield, not the API origin.
// Never forward API credentials to it. Restrict to known object-storage domains.
export async function uploadAsset(bytes, contentType, { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 120000 } = {}) {
  if (!['video/mp4', 'image/png', 'image/jpeg', 'audio/wav', 'audio/x-wav'].includes(contentType)) throw new Error('Unsupported Higgsfield upload type.');
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error('Nonempty media bytes are required.');
  const safeUploadFetch = async (...args) => {
    try { return await fetchImpl(...args); } catch (error) {
      const code=error?.cause?.code ?? error?.code;
      if(['EACCES','EPERM'].includes(code))throw new Error('Source upload blocked by this server’s network permissions. Allow outbound HTTPS for the server, then retry preparation. No generation was submitted.');
      const timedOut = ['TimeoutError', 'AbortError'].includes(error?.name);
      throw new Error(`Higgsfield source upload ${timedOut ? 'timed out' : 'failed'}; no generation submitted. Retry preparation.`);
    }
  };
  const response = await request(`${API}/files/generate-upload-url`, { method: 'POST', headers: { Authorization: authorization(env), 'Content-Type': 'application/json' }, body: JSON.stringify({ content_type: contentType }) }, safeUploadFetch, Math.min(timeoutMs, 30000));
  if (!response.ok) throw new Error(`Higgsfield upload preparation returned HTTP ${response.status}.`);
  const data = await response.json();
  const target = httpsUrl(data.upload_url);
  if (!['amazonaws.com', 'r2.cloudflarestorage.com', 'storage.googleapis.com'].some(domain => target.hostname === domain || target.hostname.endsWith(`.${domain}`))) throw new Error('Unrecognized upload storage host; verify the provider storage contract before uploading.');
  const publicUrl = httpsUrl(data.public_url).href;
  const headers = data.upload_headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new Error('Missing provider upload headers.');
  if (Object.keys(headers).some(name => ['authorization', 'cookie', 'host'].includes(name.toLowerCase()))) throw new Error('Unsafe upload headers returned by provider.');
  const uploaded = await safeUploadFetch(target.href, { method: 'PUT', headers, body: bytes, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!uploaded.ok) throw new Error(`Higgsfield asset upload returned HTTP ${uploaded.status}.`);
  return publicUrl;
}
