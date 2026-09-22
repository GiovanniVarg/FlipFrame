import test from 'node:test';import assert from 'node:assert/strict';import {selectionIntent} from './selection-intent.mjs';
test('explicit selected-object edits use reviewed selection',()=>{assert.equal(selectionIntent('Change only the selected moving toy car to blue',true),'object');assert.equal(selectionIntent('Repaint the selected dress red',true),'object');assert.equal(selectionIntent('Change the selected car',false),undefined)});
test('selection never hijacks playback, audio, apply or unrelated commands',()=>{for(const text of ['mute selected range','apply selected candidate','Change selected object audio','export video','make the background blue'])assert.equal(selectionIntent(text,true),undefined)});

test('reviewed object transformation needs no repeated selection instructions',()=>{const text='have in this frame a hyperrealistic trasformers movie transformation from the car into a mechanical humanoid robot that looks like a transformer';assert.equal(selectionIntent(text,true),'object');assert.equal(selectionIntent(text,false),undefined);for(const text of ['Do not transform the car into a robot','Transform the background into space','blur selected object'])assert.equal(selectionIntent(text,true),undefined);});

test('explicit object instruction retains intent with camera and background constraints',()=>{assert.equal(selectionIntent('Edit the selected object: car becomes a robot. Preserve background and camera.',true),'object');assert.equal(selectionIntent('Edit the selected object: car becomes a robot.',false),undefined);});

test('explicit whole-scene request cannot inherit selected-object routing',()=>{for(const ready of [true,false])assert.equal(selectionIntent('Edit the entire scene: robot camera orbit',ready),'picture');});

test('explicit background edit keeps a separate foreground-preserving intent',()=>{
 for(const ready of [false,true])for(const text of ['Change the background to a beach','Replace background with a studio','Edit the background behind the object'])assert.equal(selectionIntent(text,ready),'background');
 assert.equal(selectionIntent('Do not change the background',true),undefined);
});
