import test from 'node:test';import assert from 'node:assert/strict';import {editImpact,generationButton} from './edit-impact.mjs';
test('picture scope cannot imply object preservation',()=>{assert.match(editImpact('picture').changes,/entire picture/);assert.match(editImpact('picture').review,/Object edit/)});
test('object promise is limited to verified coverage',()=>{assert.match(editImpact('object').preserves,/outside the final repair coverage/);assert.match(editImpact('object').review,/can change/)});
test('paid action displays estimate and never calls missing pricing free',()=>{assert.equal(generationButton({route:{kind:'higgsfield',estimatedUsd:2.98}}),'Generate preview · est. $2.98');assert.match(generationButton({route:{kind:'higgsfield'}}),/paid/);assert.equal(generationButton({route:{kind:'local'}}),'Create preview')});
import {editScope,reservationLabel} from './edit-impact.mjs';
test('scope distinguishes one frame, full clip and selected range',()=>{assert.equal(editScope({start:2.433333,end:2.466667},5),'This frame only · 1 frame');assert.equal(editScope({start:0,end:5},5),'Whole clip · 150 frames');assert.equal(editScope({start:1,end:3},5),'Selected range · 60 frames')});
test('reservation wording never presents a hold as a verified charge',()=>{assert.match(reservationLabel({route:{kind:'higgsfield',estimatedUsd:1.74}}),/\$3.48.*not a verified charge/);assert.equal(reservationLabel({route:{kind:'local'}}),null)});
test('released provider hold replaces the estimate rather than claiming money is held',()=>{
 assert.equal(reservationLabel({route:{kind:'higgsfield',estimatedUsd:2.55}},{billing:'Provider confirmed no charge; budget reservation released'}),'Provider confirmed no charge; budget reservation released');
 assert.match(reservationLabel({route:{kind:'higgsfield',estimatedUsd:2.55}}),/will reserve/);
});
