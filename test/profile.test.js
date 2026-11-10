'use strict';

var assert = require('assert');
var profile = require('../profile.js');

assert.strictEqual(profile.CATALOG.length >= 8, true);
assert.ok(profile.CATALOG.some(function (row) { return row.code === 'ifmga'; }));
assert.ok(profile.CATALOG.some(function (row) { return row.code === 'kvb2'; }));

var declared = profile.assignCredential([], 'kvb1', 'self_declared');
assert.strictEqual(declared.ok, true);
assert.strictEqual(declared.items[0].status, 'self_declared');
var verified = profile.assignCredential(declared.items, 'ifmga', 'verified');
assert.strictEqual(verified.ok, false);
assert.strictEqual(verified.reason, 'verified');

var pub = profile.publicCredentials([
  { code: 'kvb1', status: 'self_declared' },
  { code: 'wfr', status: 'pending', path: 'secret/file' },
  { code: 'ifmga', status: 'verified', reviewedAt: '2026-11-01' }
]);
assert.strictEqual(pub.length, 2);
assert.ok(!JSON.stringify(pub).includes('secret/file'));

var stats = profile.counts([
  { status: 'done', kind: 'peak', name: 'Dom', elevationGain: 1200 },
  { status: 'done', kind: 'hike', name: 'Valley', elevationGain: 400 },
  { status: 'planned', kind: 'peak', name: 'Matterhorn', elevationGain: 9000 }
], [{ name: 'Dom' }]);
assert.strictEqual(stats.summits, 1);
assert.strictEqual(stats.gain, 1600);
assert.strictEqual(stats.four, 1);
var facts = profile.factChips(stats);
assert.strictEqual(facts[0].label, '4000er summits: 1');
assert.ok(facts[0].detail.indexOf('not a ranking') >= 0);

console.log('profile tests ok');
