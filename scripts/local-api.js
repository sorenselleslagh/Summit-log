#!/usr/bin/env node
// Local API for the chat check: Postgres row security, PostgREST, and a tiny
// auth front so the browser client can hold a session. Dev only.
'use strict';

var http = require('http');
var crypto = require('crypto');
var fs = require('fs');
var execFileSync = require('child_process').execFileSync;
var spawn = require('child_process').spawn;

var DB = 'summitlog_rls';
var SECRET = 'summitlog-local-dev-jwt-secret-32';
var A = '11111111-1111-4111-8111-111111111111';
var B = '22222222-2222-4222-8222-222222222222';
var POSTGREST = process.env.POSTGREST_BIN || '/tmp/postgrest/postgrest';
var REST_PORT = 3001;
var API_PORT = 54321;

function psqlAdmin(db, sql) {
  return execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
}

function jwt(payload) {
  var header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  var body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  var sig = crypto.createHmac('sha256', SECRET).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + sig;
}

function decode(token) {
  var body = String(token || '').split('.')[1] || '';
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

function setupDatabase() {
  try { psqlAdmin('postgres', 'drop database if exists ' + DB); } catch (err) { /* first run */ }
  psqlAdmin('postgres', 'create database ' + DB);
  psqlAdmin(DB, [
    "do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;",
    "do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;",
    "do $$ begin create role authenticator noinherit login password 'summitlog'; exception when duplicate_object then null; end $$;",
    "alter role authenticator password 'summitlog';",
    "grant authenticated to postgres;",
    "grant authenticated, anon to authenticator;",
    "grant connect on database " + DB + " to authenticator;",
    "create schema if not exists auth;",
    "create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);",
    "create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;"
  ].join('\n'));
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-f',
    require('path').join(__dirname, '..', 'supabase/migrations/20261110180000_accounts_and_chat.sql')
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  psqlAdmin(DB, "grant usage on schema public to anon, authenticator;");
  psqlAdmin(DB, "insert into auth.users (id, email, raw_user_meta_data) values ('" + A + "', 'alex@example.com', '{\"display_name\":\"Alex M.\"}'), ('" + B + "', 'blair@example.com', '{\"display_name\":\"Blair T.\"}');");
  psqlAdmin(DB, "update profiles set display_name = 'Alex M.', region_label = 'Chamonix' where id = '" + A + "';");
  psqlAdmin(DB, "update profiles set display_name = 'Blair T.', region_label = 'Annecy' where id = '" + B + "';");
  psqlAdmin(DB, "insert into plan_shares (owner_id, local_id, name, kind, visibility, looking_for_partner, route_name, route_grade, stage, timeframe, share_note, elevation, status) values ('" + A + "', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Dôme du Goûter', 'peak', 'community', true, 'Par l''Aiguille du Goûter', 'PD', 'objective', 'July', 'Weekday start', 4304, 'planned');");
}

function userToken(id, email, name) {
  return jwt({
    role: 'authenticated',
    sub: id,
    aud: 'authenticated',
    email: email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
    user_metadata: { display_name: name }
  });
}

function startPostgrest() {
  var env = Object.assign({}, process.env, {
    PGRST_DB_URI: 'postgres://authenticator:summitlog@127.0.0.1:5432/' + DB,
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: SECRET,
    PGRST_SERVER_PORT: String(REST_PORT),
    PGRST_DB_EXTRA_SEARCH_PATH: 'public'
  });
  var child = spawn(POSTGREST, [], { env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', function (buf) { process.stdout.write(buf); });
  child.stderr.on('data', function (buf) { process.stderr.write(buf); });
  return child;
}

function proxy() {
  return http.createServer(function (req, res) {
    var cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      'access-control-expose-headers': 'content-range,content-location,location,preference-applied'
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (req.url.indexOf('/auth/v1/') === 0) {
      var header = req.headers.authorization || '';
      var token = header.replace(/^Bearer\s+/i, '');
      var claims = {};
      try { claims = token ? decode(token) : {}; } catch (err) { claims = {}; }
      var body = {
        id: claims.sub || null,
        aud: 'authenticated',
        role: 'authenticated',
        email: claims.email || '',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: claims.user_metadata || {},
        created_at: new Date().toISOString()
      };
      if (req.url.indexOf('/auth/v1/token') === 0) {
        body = { access_token: token, refresh_token: token, token_type: 'bearer', expires_in: 3600, user: body };
      }
      res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors));
      res.end(JSON.stringify(body));
      return;
    }
    if (req.url.indexOf('/rest/v1/') !== 0) {
      res.writeHead(404, cors);
      res.end('{}');
      return;
    }
    var target = req.url.replace(/^\/rest\/v1/, '') || '/';
    var proxied = http.request({
      hostname: '127.0.0.1',
      port: REST_PORT,
      method: req.method,
      path: target,
      headers: {
        authorization: req.headers.authorization || '',
        apikey: req.headers.apikey || '',
        accept: req.headers.accept || 'application/json',
        'content-type': req.headers['content-type'] || 'application/json',
        prefer: req.headers.prefer || '',
        range: req.headers.range || ''
      }
    }, function (upstream) {
      var headers = Object.assign({}, upstream.headers, cors);
      res.writeHead(upstream.statusCode || 502, headers);
      upstream.pipe(res);
    });
    proxied.on('error', function () {
      res.writeHead(502, cors);
      res.end('{}');
    });
    req.pipe(proxied);
  }).listen(API_PORT, '127.0.0.1');
}

setupDatabase();
var anon = jwt({ role: 'anon', exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 });
var tokens = {
  anon: anon,
  alex: userToken(A, 'alex@example.com', 'Alex M.'),
  blair: userToken(B, 'blair@example.com', 'Blair T.')
};
fs.writeFileSync('/tmp/summit-tokens.json', JSON.stringify(tokens, null, 2));
startPostgrest();
proxy();
console.log('local api on http://127.0.0.1:' + API_PORT);
