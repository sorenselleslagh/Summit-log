'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var account = require('../account.js');
var partners = require('../partners.js');

var secret = 'private preparation note that must never be shared';
var item = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Dôme du Goûter',
  kind: 'peak',
  status: 'planned',
  visibility: 'community',
  lookingForPartner: true,
  routeName: "Par l'Aiguille du Goûter",
  routeGrade: 'PD',
  timeframe: 'July',
  fixedDate: '',
  shareNote: 'A note I am willing to share',
  notes: secret,
  checklist: [{ id: 'step-1', text: 'Crampons', done: false }],
  lat: 45.84,
  lng: 6.83,
  elevation: 4304,
  updatedAt: '2026-11-01T10:00:00.000Z'
};

var share = account.publicShare(item);
assert.ok(share);
assert.strictEqual(share.name, 'Dôme du Goûter');
assert.strictEqual(share.visibility, 'community');
assert.strictEqual(share.looking_for_partner, true);
assert.strictEqual(share.route_grade, 'PD');
assert.strictEqual(share.stage, 'objective');
assert.strictEqual(share.share_note, 'A note I am willing to share');
assert.strictEqual(share.fixed_date, null);
account.PUBLIC_KEYS.forEach(function (key) { assert.ok(Object.prototype.hasOwnProperty.call(share, key), key); });
var encoded = JSON.stringify(share);
assert.ok(!encoded.includes(secret));
assert.ok(!encoded.includes('Crampons'));
assert.ok(!encoded.includes('45.84'));
assert.ok(!Object.prototype.hasOwnProperty.call(share, 'notes'));
assert.ok(!Object.prototype.hasOwnProperty.call(share, 'checklist'));
assert.ok(!Object.prototype.hasOwnProperty.call(share, 'lat'));
assert.ok(!Object.prototype.hasOwnProperty.call(share, 'lng'));

var privateItem = Object.assign({}, item, { visibility: 'private', lookingForPartner: true, id: '00000000-0000-4000-8000-0000000000bb' });
var hidden = account.publicShare(privateItem);
assert.strictEqual(hidden.visibility, 'private');
assert.strictEqual(hidden.looking_for_partner, false);
assert.strictEqual(account.publicShare({ id: 'not-a-uuid', name: 'Nope' }), null);

var first = account.planMigration([item], []);
assert.strictEqual(first.pushed, 1);
assert.strictEqual(first.upserts.length, 1);
assert.strictEqual(first.upserts[0].payload.notes, secret);
var remote = [{
  kind: 'item',
  local_id: item.id,
  payload: item,
  updated_at: item.updatedAt
}];
var second = account.planMigration([item], remote);
assert.strictEqual(second.pushed, 0);
assert.strictEqual(second.pulled, 0);
assert.strictEqual(second.unchanged, 1);
assert.strictEqual(second.upserts.length, 0);
assert.strictEqual(second.nextItems.length, 1);

var newerRemote = [{
  kind: 'item',
  local_id: item.id,
  payload: Object.assign({}, item, { notes: secret, shareNote: 'updated on the account' }),
  updated_at: '2026-11-02T10:00:00.000Z'
}];
var pulled = account.planMigration([item], newerRemote);
assert.strictEqual(pulled.pulled, 1);
assert.strictEqual(pulled.nextItems[0].shareNote, 'updated on the account');
assert.strictEqual(pulled.nextItems[0].notes, secret);

var onlyRemote = account.planMigration([], newerRemote);
assert.strictEqual(onlyRemote.nextItems.length, 1);
assert.strictEqual(onlyRemote.pulled, 1);

assert.strictEqual(account.chooseDisplayName('Soren', ''), 'Soren');
assert.strictEqual(account.chooseDisplayName('Device', 'Account'), 'Account');

var googleNames = account.namesFromMetadata({ given_name: 'Ada', family_name: 'Lovelace', email: 'ada@example.com' });
assert.strictEqual(googleNames.firstName, 'Ada');
assert.strictEqual(googleNames.lastName, 'Lovelace');
var fullNames = account.namesFromMetadata({ full_name: 'Sören Selleslagh' });
assert.strictEqual(fullNames.firstName, 'Sören');
assert.strictEqual(fullNames.lastName, 'Selleslagh');
var partial = account.namesFromMetadata({ given_name: 'Ada' });
assert.strictEqual(partial.firstName, 'Ada');
assert.strictEqual(partial.lastName, '');
assert.strictEqual(account.namesFromMetadata({ name: 'Ada' }).lastName, '');
assert.strictEqual(account.entryChoice({ configured: false, online: true, session: false }), 'plan');
assert.strictEqual(account.entryChoice({ configured: true, online: true, session: true }), 'explore');
assert.strictEqual(account.entryChoice({ configured: true, online: false, session: false, cached: true }), 'explore');
assert.strictEqual(account.entryChoice({ configured: true, online: false, session: false, cached: false }), 'offline');
assert.strictEqual(account.entryChoice({ configured: true, online: true, session: false }), 'register');
assert.strictEqual(account.keepStoredSession('summitlog-auth', false), true);
assert.strictEqual(account.keepStoredSession('summitlog-auth', true), false);
assert.strictEqual(account.keepStoredSession('summitlog-auth-code-verifier', false), false);

var sentence = account.migrationSentence({ pushed: 1, pulled: 0, plans: 1, logs: 2 });
assert.ok(sentence.includes('Your log is on this account'));
assert.ok(sentence.includes('not duplicate'));
assert.ok(account.migrationSentence({ pushed: 0, pulled: 0 }).includes('Already on this account'));

assert.strictEqual(partners.fold('Dôme du Goûter'), 'dome du gouter');

var root = path.join(__dirname, '..');
var config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
var sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261110180000_accounts_and_chat.sql'), 'utf8');
var app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var accountJs = fs.readFileSync(path.join(root, 'account.js'), 'utf8');
var profile = fs.readFileSync(path.join(root, 'profile.js'), 'utf8');
assert.ok(config.includes('https://vjruyrawruirwrwqfeyy.supabase.co'));
assert.ok(config.includes('sb_publishable_VwoY6M9dizu9sinDwHRkNA_Ar6S5OJ2'));
assert.ok(config.includes('service_role'));
assert.ok(!config.includes('eyJ'));
assert.ok(account.redirectTo);
assert.ok(sql.includes('account_records'));
assert.ok(sql.includes("type in ('direct', 'team')"));
assert.ok(sql.includes('accept_partner_request'));
assert.ok(sql.includes('messages_by_conversation'));
assert.ok(sql.includes('Do not put the service_role key'));
var harden = fs.readFileSync(path.join(root, 'supabase/migrations/20261110181000_harden_function_search_path.sql'), 'utf8');
assert.ok(harden.includes("set search_path = ''"));
assert.ok(harden.includes('revoke all on function public.handle_new_user() from public, anon, authenticated'));
assert.ok(harden.includes('revoke all on function public.touch_conversation() from public, anon, authenticated'));
assert.ok(harden.includes('revoke all on function public.accept_partner_request(uuid) from public, anon'));
assert.ok(harden.includes('grant execute on function public.accept_partner_request(uuid) to authenticated'));
assert.ok(harden.includes('extensions.unaccent'));
assert.ok(html.includes('id="messages-panel"'));
assert.ok(html.includes('id="magic-email"'));
assert.ok(html.includes('id="magic-first"'));
assert.ok(html.includes('id="magic-last"'));
assert.ok(!html.includes('id="apple-login"'));
assert.ok(!html.includes('Continue with Apple'));
assert.ok(html.includes('id="google-login"'));
assert.ok(html.includes('I already have an account? Sign in'));
assert.ok(html.includes('Forgot password'));
assert.ok(html.includes('id="auth-resend"'));
assert.ok(html.includes('Connect to create your account'));
assert.ok(app.includes("? 'explore' : 'plan'"));
assert.ok(html.includes('id="name-screen"'));
assert.ok(html.includes('Complete your profile'));
assert.ok(html.includes('not connected'));
assert.ok(config.includes('AUTH_PROVIDERS = { google: false }'));
assert.ok(!config.includes('apple:'));
assert.ok(accountJs.includes('persistSession: true'));
assert.ok(accountJs.includes('autoRefreshToken: true'));
assert.ok(accountJs.includes('signInWithOAuth'));
assert.ok(accountJs.includes('emailRedirectTo: redirectTo()'));
assert.ok(accountJs.includes("google: 'openid email profile'"));
assert.ok(!app.includes('apple-login'));
var namesSql = fs.readFileSync(path.join(root, 'supabase/migrations/20261110210000_profile_names.sql'), 'utf8');
assert.ok(namesSql.includes('first_name'));
assert.ok(namesSql.includes('last_name'));
assert.ok(namesSql.includes('id = auth.uid()'));
assert.ok(namesSql.includes('raw_user_meta_data'));
assert.ok(!namesSql.includes('app_metadata'));
assert.ok(profile.includes('profile-email'));
assert.ok(profile.includes('!previewing && me.email'));
assert.ok(app.includes('Sign in to be visible to others'));
assert.ok(!app.includes('innerHTML'));
assert.ok(!app.includes('localStorage'));

console.log('account tests ok');
