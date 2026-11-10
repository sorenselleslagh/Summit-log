#!/usr/bin/env node
// Local RLS check for the accounts migration. Uses the Postgres on this machine.
// It does not use a service_role key and it does not talk to a hosted project.
'use strict';

var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var DB = 'summitlog_rls';
var A = '11111111-1111-4111-8111-111111111111';
var B = '22222222-2222-4222-8222-222222222222';
var C = '33333333-3333-4333-8333-333333333333';
var PLAN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
var failed = 0;

function psql(sql) {
  return execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
    encoding: 'utf8'
  });
}

function psqlFile(file) {
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-f', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function setup() {
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', 'postgres', '-c', 'drop database if exists ' + DB], { encoding: 'utf8' });
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', 'postgres', '-c', 'create database ' + DB], { encoding: 'utf8' });
  psql([
    "do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;",
    "do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;",
    "grant authenticated to postgres;",
    "create schema if not exists auth;",
    "create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);",
    "create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;",
    "create schema if not exists storage;",
    "create table if not exists storage.buckets (id text primary key, name text, public boolean default false);",
    "create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);",
    "create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;",
    "alter table storage.objects enable row level security;",
    "grant usage on schema storage to anon, authenticated;",
    "grant select, insert, update, delete on storage.objects to anon, authenticated;"
  ].join('\n'));
  psqlFile(path.join(__dirname, '..', 'supabase/migrations/20261110180000_accounts_and_chat.sql'));
  psqlFile(path.join(__dirname, '..', 'supabase/migrations/20261110181000_harden_function_search_path.sql'));
  psqlFile(path.join(__dirname, '..', 'supabase/migrations/20261110190000_profile_credentials.sql'));
  psql([
    "create or replace function rls_try(uid uuid, stmt text) returns text language plpgsql as $$",
    "begin",
    "  perform set_config('request.jwt.claim.sub', uid::text, true);",
    "  execute 'set local role authenticated';",
    "  execute stmt;",
    "  return 'ok';",
    "exception when others then",
    "  return SQLERRM;",
    "end $$;"
  ].join('\n'));
  psql("insert into auth.users (id, email) values ('" + A + "', 'a@example.com'), ('" + B + "', 'b@example.com'), ('" + C + "', 'c@example.com');");
}

function check(name, uid, stmt, expect) {
  var out = psql("select rls_try('" + uid + "'::uuid, $sql$" + stmt + "$sql$);").trim();
  var ok = expect === 'ok' ? out === 'ok' : out !== 'ok';
  if (expect !== 'ok' && out === 'ok') ok = false;
  if (expect === 'ok' && out !== 'ok') ok = false;
  if (expect === 'denied' && out === 'ok') ok = false;
  if (expect === 'denied' && out !== 'ok') ok = true;
  if (!ok) failed += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' -> ' + out));
  return out;
}

function count(name, uid, stmt, expected) {
  var n = psql([
    "select set_config('request.jwt.claim.sub', '" + uid + "', false);",
    'set role authenticated;',
    stmt + ';'
  ].join('\n'));
  var lines = n.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
  var got = lines[lines.length - 1];
  var ok = got === String(expected);
  if (!ok) failed += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' -> ' + JSON.stringify(lines)));
}

function scalar(sql) {
  var lines = psql(sql).split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
  return lines[lines.length - 1] || '';
}

function expectEq(name, sql, expected) {
  var got = scalar(sql);
  var ok = got === expected;
  if (!ok) failed += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' -> ' + got));
}

setup();

expectEq('unaccent lives in extensions',
  "select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'unaccent'",
  'extensions');
[
  'public.objective_key(text)',
  'public.set_plan_name_key()',
  'public.protect_message_edit()',
  'public.protect_member_row()',
  'public.touch_conversation()',
  'public.handle_new_user()',
  'public.accept_partner_request(uuid)',
  'public.decline_partner_request(uuid)',
  'private.is_conversation_member(uuid, boolean)',
  'private.users_are_blocked(uuid, uuid)'
].forEach(function (fn) {
  expectEq('empty search_path on ' + fn,
    "select proconfig from pg_proc where oid = '" + fn + "'::regprocedure",
    '{"search_path=\\"\\""}');
});
expectEq('anon cannot execute handle_new_user',
  "select has_function_privilege('anon', 'public.handle_new_user()', 'execute')", 'f');
expectEq('authenticated cannot execute handle_new_user',
  "select has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')", 'f');
expectEq('authenticated cannot execute touch_conversation',
  "select has_function_privilege('authenticated', 'public.touch_conversation()', 'execute')", 'f');
expectEq('anon cannot execute accept_partner_request',
  "select has_function_privilege('anon', 'public.accept_partner_request(uuid)', 'execute')", 'f');
expectEq('authenticated can execute accept_partner_request',
  "select has_function_privilege('authenticated', 'public.accept_partner_request(uuid)', 'execute')", 't');
expectEq('anon cannot execute decline_partner_request',
  "select has_function_privilege('anon', 'public.decline_partner_request(uuid)', 'execute')", 'f');
expectEq('authenticated can execute decline_partner_request',
  "select has_function_privilege('authenticated', 'public.decline_partner_request(uuid)', 'execute')", 't');

var key = psql("select public.objective_key('Dôme du Goûter');").trim();
if (key !== 'dome du gouter') {
  failed += 1;
  console.log('FAIL objective_key -> ' + key);
} else console.log('PASS objective_key folds Dôme du Goûter');

var noteCols = psql("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'plan_shares' and column_name in ('notes', 'checklist', 'lat', 'lng');").trim();
if (noteCols !== '0') {
  failed += 1;
  console.log('FAIL plan_shares exposes private columns ' + noteCols);
} else console.log('PASS plan_shares has no notes, checklist, or coordinates');

check('owner stores a private record', A,
  "insert into public.account_records (owner_id, kind, local_id, payload) values ('" + A + "', 'item', '" + PLAN + "', '{\"notes\":\"ridge secret\"}'::jsonb)",
  'ok');
count('other user cannot read private records', B,
  "select count(*) from public.account_records",
  '0');
count('owner can read their private record', A,
  "select count(*) from public.account_records",
  '1');

check('owner publishes a private plan', A,
  "insert into public.plan_shares (owner_id, local_id, name, kind, visibility, share_note) values ('" + A + "', '" + PLAN + "', 'Hidden Peak', 'peak', 'private', '')",
  'ok');
count('other user cannot read a private plan', B,
  "select count(*) from public.plan_shares where name = 'Hidden Peak'",
  '0');

check('owner publishes a community plan', A,
  "insert into public.plan_shares (owner_id, local_id, name, kind, visibility, looking_for_partner, route_name, stage, timeframe) values ('" + A + "', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Dôme du Goûter', 'peak', 'community', true, 'Par l''Aiguille du Goûter', 'objective', 'July')",
  'ok');
count('other user can read the community plan', B,
  "select count(*) from public.plan_shares where name_key = 'dome du gouter'",
  '1');

check('stranger cannot open a conversation directly', B,
  "insert into public.conversations (type, objective_name) values ('direct', 'Dôme du Goûter')",
  'denied');

check('request is stored while pending', B,
  "insert into public.partner_requests (to_user, objective_name, route_name, dates, stage) values ('" + A + "', 'Dôme du Goûter', 'Par l''Aiguille du Goûter', 'July', 'objective')",
  'ok');

var requestId = psql("select id from public.partner_requests where from_user = '" + B + "' and status = 'pending'").trim();
check('message before a conversation exists is rejected', B,
  "insert into public.messages (conversation_id, sender_id, kind, body, client_id) values ('" + PLAN + "', '" + B + "', 'text', 'hello', '" + PLAN + "')",
  'denied');
check('recipient cannot mark accepted by a plain update', A,
  "update public.partner_requests set status = 'accepted' where id = '" + requestId + "'",
  'denied');
check('sender cannot accept a request that is not addressed to them', B,
  "select public.accept_partner_request('" + requestId + "'::uuid)",
  'denied');

var conv = psql("select rls_try('" + A + "'::uuid, $sql$select public.accept_partner_request('" + requestId + "'::uuid)$sql$)").trim();
if (conv !== 'ok') {
  failed += 1;
  console.log('FAIL accept_partner_request -> ' + conv);
} else console.log('PASS accept creates the direct conversation');

count('sender can read the conversation after accept', B,
  "select count(*) from public.conversations where request_id = '" + requestId + "'",
  '1');
count('third user cannot read the conversation', C,
  "select count(*) from public.conversations",
  '0');

var convId = psql("select id from public.conversations where request_id = '" + requestId + "'").trim();
check('sender can write a message after accept', B,
  "insert into public.messages (conversation_id, sender_id, kind, body, client_id) values ('" + convId + "', '" + B + "', 'text', 'See you in July', '" + B + "')",
  'ok');
count('recipient can read that message', A,
  "select count(*) from public.messages",
  '1');
count('third user cannot read messages', C,
  "select count(*) from public.messages",
  '0');

check('block is stored', A,
  "insert into public.blocks (blocker_id, blocked_id) values ('" + A + "', '" + B + "')",
  'ok');
check('blocked user cannot send another message', B,
  "insert into public.messages (conversation_id, sender_id, kind, body, client_id) values ('" + convId + "', '" + B + "', 'text', 'still here', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')",
  'denied');
count('blocked user still cannot read the other private notes', B,
  "select count(*) from public.account_records",
  '0');

check('member cannot self-verify a credential', A,
  "insert into public.profile_credentials (profile_id, code, status) values ('" + A + "', 'ifmga', 'verified')",
  'denied');
check('member can self-declare a credential', A,
  "insert into public.profile_credentials (profile_id, code, status) values ('" + A + "', 'kvb1', 'self_declared')",
  'ok');
check('member can offer a certificate as pending', A,
  "insert into public.profile_credentials (profile_id, code, status) values ('" + A + "', 'wfr', 'pending')",
  'ok');
var credId = scalar("select id from public.profile_credentials where profile_id = '" + A + "' and code = 'wfr'");
check('member cannot update their chip to verified', A,
  "update public.profile_credentials set status = 'verified' where id = '" + credId + "'",
  'denied');
check('member stores a proof path', A,
  "insert into public.credential_proofs (credential_id, owner_id, path) values ('" + credId + "', '" + A + "', '" + A + "/wfr')",
  'ok');
count('other user cannot read proof paths', B,
  "select count(*) from public.credential_proofs",
  '0');
psql("insert into storage.objects (bucket_id, name, owner) values ('credential-proofs', '" + A + "/wfr.jpg', '" + A + "')");
count('other user cannot select the proof file', B,
  "select count(*) from storage.objects where bucket_id = 'credential-proofs'",
  '0');
count('owner can select their proof file', A,
  "select count(*) from storage.objects where bucket_id = 'credential-proofs'",
  '1');
expectEq('anon cannot execute review_credential',
  "select has_function_privilege('anon', 'public.review_credential(uuid, text)', 'execute')", 'f');
try {
  psql([
    "select set_config('request.jwt.claim.sub', '" + C + "', false);",
    "select set_config('request.jwt.claims', '{\"sub\":\"" + C + "\",\"user_metadata\":{\"role\":\"admin\"}}', false);",
    "set role authenticated;",
    "select public.review_credential('" + credId + "'::uuid, 'verified');"
  ].join('\n'));
  failed += 1;
  console.log('FAIL user_metadata admin cannot verify');
} catch (err) {
  console.log('PASS user_metadata admin cannot verify');
}
try {
  psql([
    "select set_config('request.jwt.claim.sub', '" + C + "', false);",
    "select set_config('request.jwt.claims', '{\"sub\":\"" + C + "\",\"app_metadata\":{\"role\":\"admin\"}}', false);",
    "set role authenticated;",
    "select public.review_credential('" + credId + "'::uuid, 'verified');"
  ].join('\n'));
} catch (err) {
  failed += 1;
  console.log('FAIL app_metadata admin can verify -> ' + (err.stderr || err.message));
}
var after = scalar("select status from public.profile_credentials where id = '" + credId + "'");
if (after === 'verified') console.log('PASS app_metadata admin can verify');
else { failed += 1; console.log('FAIL app_metadata admin can verify status ' + after); }

if (failed) {
  console.log(failed + ' RLS check(s) failed');
  process.exit(1);
}
console.log('RLS checks passed');
