import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {runPreflight} from './submission-preflight.mjs';

function fixture({build = true, deployment = true} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'submission-preflight-'));
  if (build) {
    fs.mkdirSync(path.join(root, 'dist'), {recursive: true});
    fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<!doctype html>');
  }
  if (deployment) {
    fs.mkdirSync(path.join(root, 'deployment'), {recursive: true});
    fs.writeFileSync(path.join(root, 'deployment', 'Dockerfile'), 'FROM node');
    fs.writeFileSync(path.join(root, 'deployment', 'compose.yaml'), 'services: {}');
  }
  return root;
}

const runner = (command, args) => ({status: command === 'python' && args?.[0] === '-c' ? 0 : 1});

test('reports local readiness and does not claim public readiness for local owner mode', () => {
  const root = fixture();
  try {
    const result = runPreflight({root, env: {LAB_MODE: 'local'}, commandRunner: runner});
    assert.equal(result.ready, true);
    assert.equal(result.publicConfigurationReady, false);
    assert.equal(result.deploymentVerified, false);
    assert.equal(result.network, 'not-used');
    assert.equal(result.checks.find(item => item.id === 'public-auth-mode').status, 'blocked');
    assert.match(result.checks.find(item => item.id === 'public-auth-mode').message, /must not be exposed publicly/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('requires exact HTTPS origin in SaaS mode', () => {
  const root = fixture();
  try {
    const valid = runPreflight({root, env: {LAB_MODE: 'saas', APP_ORIGIN: 'https://studio.example'}, commandRunner: runner});
    assert.equal(valid.publicConfigurationReady, true);
    const invalid = runPreflight({root, env: {LAB_MODE: 'saas', APP_ORIGIN: 'http://studio.example/'}, commandRunner: runner});
    assert.equal(invalid.publicConfigurationReady, false);
    assert.equal(invalid.checks.find(item => item.id === 'public-origin').status, 'blocked');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('does not reflect arbitrary mode values and keeps authenticated-local local-only', () => {
  const root = fixture();
  try {
    const invalid = runPreflight({root, env: {LAB_MODE: 'secret-mode'}, commandRunner: runner});
    assert.equal(invalid.mode, 'invalid');
    assert.match(invalid.checks.find(item => item.id === 'public-auth-mode').message, /LAB_MODE is invalid/);
    const localAuth = runPreflight({root, env: {LAB_MODE: 'authenticated-local'}, commandRunner: runner});
    assert.equal(localAuth.mode, 'authenticated-local');
    assert.match(localAuth.checks.find(item => item.id === 'public-auth-mode').message, /local-only/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('blocks missing local build and runtimes without exposing env values', () => {
  const root = fixture({build: false, deployment: false});
  const secret = 'super-secret-provider-value';
  try {
    const result = runPreflight({root, env: {LAB_MODE: 'local', HF_CREDENTIALS: `id:${secret}`, PYTHON: 'missing-python'}, commandRunner: () => ({status: 1})});
    assert.equal(result.ready, false);
    assert.equal(result.publicConfigurationReady, false);
    assert.ok(result.checks.some(item => item.id === 'production-build' && item.status === 'blocked'));
    assert.ok(result.checks.some(item => item.id === 'python-runtime' && item.status === 'blocked'));
    assert.ok(result.checks.some(item => item.id === 'ffmpeg-runtime' && item.status === 'blocked'));
    assert.ok(!JSON.stringify(result).includes(secret));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('core object editing readiness requires a local model and working segmentation runtime',()=>{
 const root=fixture();try{
  const missing=runPreflight({root,env:{},commandRunner:runner});
  assert.equal(missing.objectEditingReady,false);
  const checkpoint=path.join(root,'checkpoint.pt');fs.writeFileSync(checkpoint,'fixture');
  const good=runPreflight({root,env:{SAM2_CHECKPOINT:checkpoint,SEGMENTATION_PYTHON:'python'},commandRunner:runner});
  assert.equal(good.objectEditingReady,true);
  const broken=runPreflight({root,env:{SAM2_CHECKPOINT:checkpoint,SEGMENTATION_PYTHON:'broken'},commandRunner:runner});
  assert.equal(broken.objectEditingReady,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
