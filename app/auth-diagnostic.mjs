import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// One non-generating authentication probe; never logs credentials or signed URLs.
const fileEnv = parseEnv(readFileSync(new URL('./.env', import.meta.url), 'utf8'));
const names = ['HIGGSFIELD_API_KEY', 'HIGGSFIELD_API_SECRET'];
const flags = Object.fromEntries(names.map(name => {
  const value = fileEnv[name] ?? '';
  return [name, {
    filePresent: Boolean(value),
    processPresent: Boolean(process.env[name]),
    fileVsProcessEqual: process.env[name] === value,
    surroundingWhitespace: value !== value.trim(),
    containsWhitespace: /\s/.test(value),
    looksPlaceholder: /^(your[-_ ]|replace[-_ ]|changeme|test[-_ ]|example|<)/i.test(value),
    containsColon: value.includes(':'),
  }];
}));
console.log(JSON.stringify({ credentialFlags: flags }));
if (names.some(name => !fileEnv[name])) {
  console.log(JSON.stringify({ submitted: false, reason: 'Missing file credentials.' }));
  process.exitCode = 1;
} else {
  const redact = text => {
    let safe = String(text);
    for (const name of names) {
      const value = fileEnv[name];
      for (const candidate of [value, encodeURIComponent(value)]) if (candidate) safe = safe.split(candidate).join('[REDACTED]');
    }
    return safe.replace(/https?:\/\/[^\s"<>]+/gi, '[URL REDACTED]').slice(0, 300);
  };
  try {
    const response = await fetch('https://api.higgsfield.ai/files/generate-upload-url', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Key ${fileEnv.HIGGSFIELD_API_KEY}:${fileEnv.HIGGSFIELD_API_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: 'video/mp4' }),
    });
    let data;
    try { data = await response.json(); } catch { data = null; }
    console.log(JSON.stringify({ submitted: true, generationSubmitted: false, status: response.status,
      error: response.ok ? null : redact(typeof data?.detail === 'string' ? data.detail : 'Provider returned an error without a simple detail message.'),
      uploadPrepared: response.ok && Boolean(data?.upload_url && data?.public_url) }));
  } catch (error) {
    console.log(JSON.stringify({ submitted: true, generationSubmitted: false, error: redact(error?.message || 'Request failed') }));
    process.exitCode = 1;
  }
}
