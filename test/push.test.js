'use strict';

var assert = require('assert');
var push = require('../supabase/functions/send-push/targets.cjs');

var now = Date.parse('2026-11-10T18:00:00.000Z');
var message = { sender_id: 'alex', conversation_id: 'c1', body: 'See you at the hut' };
var members = [
  { user_id: 'alex', left_at: null, muted_until: null },
  { user_id: 'blair', left_at: null, muted_until: null },
  { user_id: 'muted', left_at: null, muted_until: '2026-12-01T00:00:00.000Z' },
  { user_id: 'left', left_at: '2026-01-01T00:00:00.000Z', muted_until: null },
  { user_id: 'blocked', left_at: null, muted_until: null }
];
var blocks = [{ blocker_id: 'alex', blocked_id: 'blocked' }];
var subscriptions = [
  { id: 's1', user_id: 'alex', endpoint: 'https://push.example/alex' },
  { id: 's2', user_id: 'blair', endpoint: 'https://push.example/blair' },
  { id: 's3', user_id: 'muted', endpoint: 'https://push.example/muted' },
  { id: 's4', user_id: 'blocked', endpoint: 'https://push.example/blocked' },
  { id: 's5', user_id: 'left', endpoint: 'https://push.example/left' }
];
var targets = push.selectPushTargets({
  message: message,
  members: members,
  blocks: blocks,
  subscriptions: subscriptions,
  now: now
});
assert.deepStrictEqual(targets.map(function (row) { return row.id; }), ['s2']);
assert.strictEqual(push.isExpiredPush(410), true);
assert.strictEqual(push.isExpiredPush(404), true);
assert.strictEqual(push.isExpiredPush(201), false);

var fs = require('fs');
var path = require('path');
var sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261110200000_message_push.sql'), 'utf8');
var fn = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/send-push/index.ts'), 'utf8');
assert.ok(sql.includes('vault.decrypted_secrets'));
assert.ok(sql.includes('private.enqueue_message_push'));
assert.ok(sql.includes("if dest is null or secret is null or dest = '' or secret = ''"));
assert.ok(!sql.includes('BEGIN PRIVATE KEY') && !/VAPID_PRIVATE_KEY=.+/.test(sql));
assert.ok(fn.includes('isExpiredPush'));
assert.ok(fn.includes('x-webhook-secret'));
assert.ok(fn.includes('push_runtime_secrets'));
assert.ok(!fn.includes('BEGIN EC PRIVATE'));
var rls = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261110190500_credential_types_rls.sql'), 'utf8');
assert.ok(rls.includes('credential_types_read'));
assert.ok(rls.includes('enable row level security'));

console.log('push tests ok');
