import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function check(id, scope, status, message) {
  return {id, scope, status, message};
}

function mediaRuntimeAvailable(python, root, runner = spawnSync) {
  if (!python || typeof python !== 'string') return false;
  try {
    const result = runner(python, ['-c', "import media_engine; import subprocess; subprocess.run([media_engine.FFMPEG, '-version'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)"], {
      cwd: root,
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
    });
    return result?.status === 0;
  } catch {
    return false;
  }
}

function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function validPublicOrigin(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.origin === value;
  } catch {
    return false;
  }
}

/**
 * Check local submission prerequisites without loading dotenv files or making
 * network/provider calls. `env` and `root` are injectable for deterministic tests.
 */
export function runPreflight({env = process.env, root = ROOT, commandRunner = spawnSync} = {}) {
  const checks = [];
  const distIndex = path.join(root, 'dist', 'index.html');
  const dockerfile = path.join(root, 'deployment', 'Dockerfile');
  const compose = path.join(root, 'deployment', 'compose.yaml');
  const configuredMode = env.LAB_MODE || 'local';
  const mode = ['local', 'authenticated-local', 'saas'].includes(configuredMode) ? configuredMode : 'invalid';

  checks.push(fileExists(distIndex)
    ? check('production-build', 'local', 'ready', 'dist/index.html is present.')
    : check('production-build', 'local', 'blocked', 'Run npm run build before submission; dist/index.html is missing.'));

  const python = env.PYTHON || 'python';
  const mediaReady = mediaRuntimeAvailable(python, root, commandRunner);
  checks.push(mediaReady
    ? check('python-runtime', 'local', 'ready', 'The configured Python runtime and media dependencies are available.')
    : check('python-runtime', 'local', 'blocked', 'The configured Python runtime cannot import the media engine.'));
  checks.push(mediaReady
    ? check('ffmpeg-runtime', 'local', 'ready', 'The media engine resolved an executable ffmpeg runtime.')
    : check('ffmpeg-runtime', 'local', 'blocked', 'The media engine could not resolve and execute ffmpeg.'));

  checks.push(fileExists(dockerfile) && fileExists(compose)
    ? check('deployment-manifests', 'public', 'ready', 'Deployment Dockerfile and compose manifest are present.')
    : check('deployment-manifests', 'public', 'blocked', 'Deployment Dockerfile and compose manifest are required.'));

  if (mode === 'saas') {
    checks.push(check('public-auth-mode', 'public', 'ready', 'SaaS mode enables authenticated public access.'));
    checks.push(validPublicOrigin(env.APP_ORIGIN)
      ? check('public-origin', 'public', 'ready', 'APP_ORIGIN is an exact HTTPS origin.')
      : check('public-origin', 'public', 'blocked', 'SaaS mode requires APP_ORIGIN as an exact HTTPS origin without a trailing slash.'));
  } else {
    checks.push(check('public-auth-mode', 'public', 'blocked', mode === 'authenticated-local'
      ? 'Authenticated-local mode is local-only and must not be exposed publicly; use LAB_MODE=saas.'
      : mode === 'local'
        ? 'Local-owner mode must not be exposed publicly; use LAB_MODE=saas.'
        : 'LAB_MODE is invalid; use LAB_MODE=saas for public deployment.'));
    checks.push(check('public-origin', 'public', 'blocked', 'Public deployment is blocked until LAB_MODE=saas and APP_ORIGIN is configured.'));
  }

  const credentialsConfigured = typeof env.HF_CREDENTIALS === 'string'
    ? /^[^:\s]+:[^:\s]+$/.test(env.HF_CREDENTIALS)
    : Boolean(env.HIGGSFIELD_API_KEY && env.HIGGSFIELD_API_SECRET);
  checks.push(credentialsConfigured
    ? check('provider-configuration', 'public', 'info', 'Provider credential shape is configured; no provider call was made.')
    : check('provider-configuration', 'public', 'info', 'Provider credentials are not configured; no provider call was made.'));

  const segmentationPython=env.SEGMENTATION_PYTHON||path.join(root,'.segmentation-env',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const checkpoint=env.SAM2_CHECKPOINT||path.join(root,'.segmentation','sam2.1_hiera_tiny.pt');
  let objectEditingReady=false;
  if(fileExists(checkpoint)){
    try{objectEditingReady=commandRunner(segmentationPython,['-c','from segmentation import predictor; predictor()'],{cwd:root,stdio:'ignore',timeout:30000,windowsHide:true,env:{...process.env,SAM2_CHECKPOINT:checkpoint}})?.status===0;}catch{}
  }
  checks.push(check('object-editing-runtime','object',objectEditingReady?'ready':'blocked',objectEditingReady?'The local SAM model loaded successfully; no provider request was made.':'Object editing is unavailable: install the segmentation runtime and local SAM checkpoint. Basic audio and picture tools alone are not the competition workflow.'));

  const localChecks = checks.filter(item => item.scope === 'local');
  const publicChecks = checks.filter(item => item.scope === 'public');
  return {
    version: 1,
    kind: 'submission-preflight',
    network: 'not-used',
    mode,
    ready: localChecks.every(item => item.status !== 'blocked'),
    publicConfigurationReady: publicChecks.every(item => item.status !== 'blocked'),
    objectEditingReady,
    deploymentVerified: false,
    checks,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runPreflight();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ready || !result.objectEditingReady) process.exitCode = 1;
}
