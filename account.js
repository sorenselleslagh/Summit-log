// Account sign-in and the lossless copy of this device's log.
// With no Supabase URL the functions stay idle and the page keeps using storage.js.
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SummitAccount = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // 2.119 keeps sb_publishable keys in the apikey header. 2.49 sent every key as a Bearer JWT.
  var SDK = 'https://esm.sh/@supabase/supabase-js@2.119.0';
  var client = null;
  var sessionUser = null;
  var sessionMeta = null;
  var bootPromise = null;
  var PENDING_NAME = 'summitlog_pending_name';
  var migratedFor = '';
  var snapshotProvider = function () { return {}; };
  var listeners = [];
  var PUBLIC_KEYS = [
    'local_id', 'name', 'kind', 'route_name', 'route_grade', 'stage', 'visibility',
    'looking_for_partner', 'timeframe', 'fixed_date', 'season', 'share_note',
    'elevation', 'status', 'updated_at'
  ];

  function cfg() {
    return root.SUMMIT_CONFIG || { supabaseUrl: '', supabaseAnonKey: '', pushEnabled: false };
  }

  function configured() {
    var c = cfg();
    return !!(c.supabaseUrl && c.supabaseAnonKey);
  }

  function pushEnabled() {
    return configured() && cfg().pushEnabled === true;
  }

  function user() {
    return sessionUser;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(sessionUser); } catch (err) { /* a listener must not break sign-in */ }
    });
  }

  function stageOf(item) {
    if (!item) return 'idea';
    if (item.fixedDate) return 'scheduled';
    if (item.stageManual && (item.stage === 'idea' || item.stage === 'objective' || item.stage === 'scheduled')) return item.stage;
    if (item.routeName || item.timeframe || item.lookingForPartner) return 'objective';
    return 'idea';
  }

  function clean(value, max) {
    if (value == null) return '';
    return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
  }

  function dateOrNull(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  // What may be stored on plan_shares. Notes, checklist, and coordinates are absent.
  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  function publicShare(item) {
    if (!item || !isUuid(item.id) || !item.name) return null;
    var visibility = item.visibility === 'people' || item.visibility === 'community' ? item.visibility : 'private';
    var season = ['winter', 'spring', 'summer', 'autumn'].indexOf(item.season) >= 0 ? item.season : '';
    var share = {
      local_id: String(item.id),
      name: clean(item.name, 200),
      kind: item.kind === 'route' || item.kind === 'hike' ? item.kind : 'peak',
      route_name: clean(item.routeName, 200),
      route_grade: clean(item.routeGrade, 40),
      stage: stageOf(item),
      visibility: visibility,
      looking_for_partner: visibility === 'community' && item.lookingForPartner === true,
      timeframe: clean(item.timeframe, 120),
      fixed_date: dateOrNull(item.fixedDate),
      season: season,
      share_note: clean(item.shareNote, 500),
      elevation: typeof item.elevation === 'number' && isFinite(item.elevation) ? item.elevation : null,
      status: item.status === 'planned' ? 'planned' : 'done',
      updated_at: item.updatedAt || new Date().toISOString()
    };
    if (!share.name) return null;
    return share;
  }

  function timeOf(value) {
    var n = Date.parse(value || '');
    return isNaN(n) ? 0 : n;
  }

  // First run copies local rows up. A later run keeps the newer updatedAt and
  // does not insert a second copy of the same local id.
  function planMigration(localItems, remoteRecords) {
    var remoteBy = {};
    (remoteRecords || []).forEach(function (row) {
      if (!row || row.kind !== 'item' || !row.local_id) return;
      remoteBy[String(row.local_id)] = row;
    });
    var seen = {};
    var upserts = [];
    var next = [];
    var pushed = 0;
    var pulled = 0;
    var unchanged = 0;
    (localItems || []).forEach(function (item) {
      if (!item || !item.id) return;
      var id = String(item.id);
      seen[id] = true;
      var remote = remoteBy[id];
      var localTime = timeOf(item.updatedAt);
      var remoteTime = remote ? timeOf(remote.updated_at) : 0;
      if (!remote || localTime > remoteTime) {
        upserts.push({
          local_id: id,
          kind: 'item',
          payload: item,
          updated_at: item.updatedAt || new Date().toISOString()
        });
        next.push(item);
        pushed += 1;
      } else if (remote && remoteTime > localTime && remote.payload && typeof remote.payload === 'object') {
        next.push(remote.payload);
        pulled += 1;
      } else {
        next.push(item);
        unchanged += 1;
      }
    });
    Object.keys(remoteBy).forEach(function (id) {
      if (seen[id]) return;
      var remote = remoteBy[id];
      if (remote.payload && typeof remote.payload === 'object') {
        next.push(remote.payload);
        pulled += 1;
      }
    });
    return { upserts: upserts, nextItems: next, pushed: pushed, pulled: pulled, unchanged: unchanged };
  }

  function chooseDisplayName(localName, remoteName) {
    var remote = clean(remoteName, 80);
    if (remote) return remote;
    return clean(localName, 80);
  }

  function namesFromMetadata(meta) {
    var source = meta || {};
    var first = clean(source.given_name || source.first_name || '', 40);
    var last = clean(source.family_name || source.last_name || '', 40);
    var full = clean(source.full_name || source.name || source.display_name || '', 80);
    var parts = full ? full.split(/\s+/).filter(Boolean) : [];
    if (!first && parts.length) first = clean(parts[0], 40);
    if (!last && parts.length > 1) last = clean(parts.slice(1).join(' '), 40);
    return { firstName: first, lastName: last };
  }

  function fullName(first, last) {
    return clean(String(first || '').trim() + ' ' + String(last || '').trim(), 80);
  }

  function rememberPending(first, last) {
    try {
      root.sessionStorage.setItem(PENDING_NAME, JSON.stringify({
        first: clean(first, 40),
        last: clean(last, 40)
      }));
    } catch (err) { /* the email link can still carry the names */ }
  }

  function readPending() {
    try {
      var parsed = JSON.parse(root.sessionStorage.getItem(PENDING_NAME) || 'null');
      if (!parsed) return { firstName: '', lastName: '' };
      return { firstName: clean(parsed.first, 40), lastName: clean(parsed.last, 40) };
    } catch (err) {
      return { firstName: '', lastName: '' };
    }
  }

  function clearPending() {
    try { root.sessionStorage.removeItem(PENDING_NAME); } catch (err) { /* ignore */ }
  }

  function applyNames(first, last) {
    if (!sessionUser) return '';
    var display = fullName(first, last);
    sessionUser.firstName = clean(first, 40);
    sessionUser.lastName = clean(last, 40);
    sessionUser.displayName = display;
    sessionUser.needsName = false;
    emit();
    return display;
  }

  function loadNames() {
    if (!client || !sessionUser) return Promise.resolve({ complete: true });
    return client.from('profiles').select('first_name, last_name, display_name').eq('id', sessionUser.id).maybeSingle()
      .then(function (result) {
        if (result.error || !sessionUser) {
          if (sessionUser) sessionUser.needsName = false;
          return { complete: true };
        }
        var row = result.data || {};
        var first = clean(row.first_name, 40);
        var last = clean(row.last_name, 40);
        if (first && last) {
          var display = applyNames(first, last);
          clearPending();
          if (clean(row.display_name, 80) !== display) {
            return client.from('profiles').update({
              display_name: display,
              updated_at: new Date().toISOString()
            }).eq('id', sessionUser.id).then(function () {
              return { complete: true };
            }, function () { return { complete: true }; });
          }
          return { complete: true };
        }
        var pending = readPending();
        var hinted = namesFromMetadata(sessionMeta);
        var guessFirst = first || pending.firstName || hinted.firstName;
        var guessLast = last || pending.lastName || hinted.lastName;
        if (guessFirst && guessLast) return saveNames(guessFirst, guessLast);
        sessionUser.firstName = guessFirst;
        sessionUser.lastName = guessLast;
        sessionUser.needsName = true;
        emit();
        return { complete: false, firstName: guessFirst, lastName: guessLast };
      }, function () {
        if (sessionUser) sessionUser.needsName = false;
        return { complete: true };
      });
  }

  function saveNames(first, last) {
    var given = clean(first, 40);
    var family = clean(last, 40);
    if (!given || !family) return Promise.resolve({ ok: false, reason: 'name' });
    if (!client || !sessionUser) return Promise.resolve({ ok: false, reason: 'signed-out' });
    var display = fullName(given, family);
    return client.from('profiles').update({
      first_name: given,
      last_name: family,
      display_name: display,
      updated_at: new Date().toISOString()
    }).eq('id', sessionUser.id).then(function (result) {
      if (result.error) return { ok: false, reason: 'save' };
      clearPending();
      return { ok: true, displayName: applyNames(given, family), firstName: given, lastName: family };
    }, function () { return { ok: false, reason: 'save' }; });
  }

  function redirectTo() {
    // Magic links must return to this app. On GitHub Pages that is
    // https://sorenselleslagh.github.io/Summit-log/ and it has to be on the
    // Supabase redirect allow-list. A local server uses its own origin.
    if (!root.location || !root.location.origin) return 'https://sorenselleslagh.github.io/Summit-log/';
    var url = new URL(root.location.href);
    url.hash = '';
    url.search = '';
    if (/\/index\.html$/i.test(url.pathname)) url.pathname = url.pathname.replace(/index\.html$/i, '');
    if (url.pathname.length > 1 && url.pathname.charAt(url.pathname.length - 1) !== '/') url.pathname += '/';
    return url.origin + url.pathname;
  }

  function loadSdk() {
    if (client) return Promise.resolve(client);
    if (!configured() || typeof root.document === 'undefined') return Promise.resolve(null);
    return import(SDK).then(function (mod) {
      var create = (mod && mod.createClient) || (mod.default && mod.default.createClient);
      if (!create) throw new Error('sdk');
      var c = cfg();
      client = create(c.supabaseUrl, c.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'summitlog-auth'
        }
      });
      return client;
    });
  }

  function setUserFromSession(session) {
    var next = session && session.user ? session.user : null;
    sessionMeta = next && next.user_metadata ? next.user_metadata : null;
    var hinted = namesFromMetadata(sessionMeta);
    var name = fullName(hinted.firstName, hinted.lastName) || (next && next.email) || '';
    sessionUser = next ? {
      id: next.id,
      email: next.email || '',
      displayName: clean(name, 80),
      firstName: hinted.firstName,
      lastName: hinted.lastName,
      needsName: false,
      admin: !!(next.app_metadata && next.app_metadata.role === 'admin')
    } : null;
    if (!next) sessionMeta = null;
    emit();
    return sessionUser;
  }

  function prepareScreen() {
    if (typeof root.document === 'undefined') return;
    var flags = (cfg().authProviders) || {};
    var anyProvider = false;
    Object.keys(flags).forEach(function (name) {
      var node = root.document.getElementById(name + '-login');
      var on = configured() && flags[name] === true;
      if (on) anyProvider = true;
      if (node) node.classList.toggle('hidden', !on);
    });
    var orLine = root.document.getElementById('auth-or');
    if (orLine) orLine.classList.toggle('hidden', !anyProvider);
    var authBox = root.document.getElementById('account-auth');
    var note = root.document.querySelector('.login-note');
    var demoIds = ['login-username', 'login-password', 'login-btn'];
    if (!configured()) return;
    demoIds.forEach(function (id) {
      var node = root.document.getElementById(id);
      if (node) node.classList.add('hidden');
    });
    var divider = root.document.querySelector('#login-screen .divider');
    if (divider) divider.classList.add('hidden');
    if (authBox) authBox.classList.remove('hidden');
    if (note) note.textContent = 'First and last name are required. We email you a sign-in link. No password is stored.';
    var status = root.document.getElementById('account-status');
    if (status && !sessionUser) status.textContent = 'Sign in with the email link to keep this log on your account. Until then it stays on this device.';
  }

  function showMigration(text) {
    ['account-migration', 'migration-banner'].forEach(function (id) {
      var node = root.document && root.document.getElementById(id);
      if (!node) return;
      node.textContent = text;
      node.classList.remove('hidden');
    });
  }

  function migrationSentence(summary) {
    if (!summary) return '';
    if (summary.pushed === 0 && summary.pulled === 0) {
      return 'Already on this account. Nothing new to copy, and nothing was duplicated.';
    }
    var plans = summary.plans || 0;
    var logs = summary.logs || 0;
    return 'Your log is on this account. ' + plans + (plans === 1 ? ' plan' : ' plans') +
      ' and ' + logs + (logs === 1 ? ' log entry' : ' log entries') +
      ' are saved. Private notes stay visible only to you. Signing in again will not duplicate them.';
  }

  function migrate(snapshot) {
    if (!client || !sessionUser) return Promise.resolve(null);
    var data = snapshot || {};
    var items = Array.isArray(data.items) ? data.items : [];
    return client.from('account_records').select('local_id, kind, payload, updated_at').eq('kind', 'item')
      .then(function (result) {
        if (result.error) throw result.error;
        var plan = planMigration(items, result.data || []);
        var rows = plan.upserts.map(function (row) {
          return {
            owner_id: sessionUser.id,
            kind: 'item',
            local_id: row.local_id,
            payload: row.payload,
            updated_at: row.updated_at
          };
        });
        var write = rows.length
          ? client.from('account_records').upsert(rows, { onConflict: 'owner_id,kind,local_id' })
          : Promise.resolve({ error: null });
        return write.then(function (saved) {
          if (saved.error) throw saved.error;
          var shares = [];
          plan.nextItems.forEach(function (item) {
            var share = publicShare(item);
            if (!share) return;
            share.owner_id = sessionUser.id;
            shares.push(share);
          });
          var shareWrite = shares.length
            ? client.from('plan_shares').upsert(shares, { onConflict: 'owner_id,local_id' })
            : Promise.resolve({ error: null });
          return shareWrite.then(function (shareResult) {
            if (shareResult.error) throw shareResult.error;
            return copyMemberships(data.memberships).then(function () {
              return copyLevel(data.level);
            }).then(function () {
              var plans = 0;
              var logs = 0;
              plan.nextItems.forEach(function (item) {
                if (item && item.status === 'planned') plans += 1;
                else if (item) logs += 1;
              });
              var summary = {
                pushed: plan.pushed,
                pulled: plan.pulled,
                unchanged: plan.unchanged,
                plans: plans,
                logs: logs,
                nextItems: plan.nextItems
              };
              summary.text = migrationSentence(summary);
              return summary;
            });
          });
        });
      });
  }

  function copyMemberships(memberships) {
    var rows = (memberships || []).filter(function (row) { return row && row.id; }).map(function (row) {
      return {
        owner_id: sessionUser.id,
        kind: 'membership',
        local_id: String(row.id),
        payload: row,
        updated_at: row.updatedAt || new Date().toISOString()
      };
    });
    if (!rows.length) return Promise.resolve();
    return client.from('account_records').upsert(rows, { onConflict: 'owner_id,kind,local_id' }).then(function (result) {
      if (result.error) throw result.error;
    });
  }

  function copyLevel(level) {
    if (!level || typeof level !== 'object') return Promise.resolve();
    return client.from('account_records').upsert({
      owner_id: sessionUser.id,
      kind: 'level',
      local_id: 'device-level',
      payload: level,
      updated_at: new Date().toISOString()
    }, { onConflict: 'owner_id,kind,local_id' }).then(function (result) {
      if (result.error) throw result.error;
    });
  }

  function publishItem(item) {
    if (!client || !sessionUser) return Promise.resolve(null);
    var share = publicShare(item);
    if (!share) return Promise.resolve(null);
    share.owner_id = sessionUser.id;
    var record = {
      owner_id: sessionUser.id,
      kind: 'item',
      local_id: String(item.id),
      payload: item,
      updated_at: item.updatedAt || new Date().toISOString()
    };
    return client.from('account_records').upsert(record, { onConflict: 'owner_id,kind,local_id' }).then(function (saved) {
      if (saved.error) throw saved.error;
      return client.from('plan_shares').upsert(share, { onConflict: 'owner_id,local_id' });
    });
  }

  function publishMembership(objective, membership, planItem) {
    var source = planItem ? Object.assign({}, planItem) : {
      id: membership && membership.id,
      name: objective && objective.name,
      kind: objective && objective.kind,
      routeName: '',
      timeframe: membership && membership.dates || '',
      shareNote: membership && membership.note || '',
      status: 'planned',
      updatedAt: (membership && membership.updatedAt) || new Date().toISOString()
    };
    source.visibility = 'community';
    source.lookingForPartner = true;
    if (membership && membership.note) source.shareNote = membership.note;
    if (membership && membership.dates && !source.timeframe) source.timeframe = membership.dates;
    return publishItem(source);
  }

  function saveArea(label) {
    if (!client || !sessionUser) return Promise.resolve({ ok: false, reason: 'signed-out' });
    var cleanLabel = clean(label, 80);
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(cleanLabel)) {
      return Promise.resolve({ ok: false, reason: 'coordinates' });
    }
    return client.from('profiles').update({
      region_label: cleanLabel,
      updated_at: new Date().toISOString()
    }).eq('id', sessionUser.id).then(function (result) {
      if (result.error) return { ok: false, reason: 'save' };
      return { ok: true, region: cleanLabel };
    });
  }

  function uploadPhotos(listPhotos) {
    if (!client || !sessionUser || typeof listPhotos !== 'function' || !pushReadyStorage()) return Promise.resolve(0);
    return Promise.resolve().then(listPhotos).then(function (photos) {
      var rows = (photos || []).slice(0, 20);
      return rows.reduce(function (chain, photo) {
        return chain.then(function (count) {
          if (!photo || !photo.blob || !photo.itemId || !photo.id) return count;
          var path = sessionUser.id + '/' + photo.itemId + '/' + photo.id + '.jpg';
          return client.storage.from('log-photos').upload(path, photo.blob, {
            upsert: true,
            contentType: 'image/jpeg'
          }).then(function (result) {
            return result.error ? count : count + 1;
          }, function () { return count; });
        });
      }, Promise.resolve(0));
    }, function () { return 0; });
  }

  function pushReadyStorage() {
    return client && client.storage && typeof client.storage.from === 'function';
  }

  function signInWithEmail(email, first, last) {
    var address = clean(email, 200);
    var given = clean(first, 40);
    var family = clean(last, 40);
    if (!configured()) return Promise.resolve({ ok: false, reason: 'unconfigured' });
    if (!given || !family) return Promise.resolve({ ok: false, reason: 'name' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return Promise.resolve({ ok: false, reason: 'email' });
    rememberPending(given, family);
    return loadSdk().then(function (api) {
      if (!api) return { ok: false, reason: 'unconfigured' };
      return api.auth.signInWithOtp({
        email: address,
        options: {
          emailRedirectTo: redirectTo(),
          data: {
            first_name: given,
            last_name: family,
            display_name: fullName(given, family)
          }
        }
      }).then(function (result) {
        if (result.error) return { ok: false, reason: 'send' };
        return { ok: true };
      });
    }, function () { return { ok: false, reason: 'sdk' }; });
  }

  // Scopes for each OAuth provider. A new one also needs a flag in
  // AUTH_PROVIDERS and a button id of "<name>-login".
  var OAUTH_SCOPES = { google: 'openid email profile' };

  function signInWithProvider(provider) {
    if (!configured()) return Promise.resolve({ ok: false, reason: 'unconfigured' });
    if (!OAUTH_SCOPES[provider]) return Promise.resolve({ ok: false, reason: 'provider' });
    var flags = cfg().authProviders || {};
    if (flags[provider] !== true) return Promise.resolve({ ok: false, reason: 'provider-off' });
    return loadSdk().then(function (api) {
      if (!api) return { ok: false, reason: 'unconfigured' };
      return api.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: redirectTo(),
          scopes: OAUTH_SCOPES[provider]
        }
      }).then(function (result) {
        if (result.error) return { ok: false, reason: 'provider-off' };
        return { ok: true };
      });
    }, function () { return { ok: false, reason: 'sdk' }; });
  }

  function signOut() {
    var done = client ? client.auth.signOut() : Promise.resolve();
    return done.then(function () {
      sessionUser = null;
      migratedFor = '';
      emit();
      prepareScreen();
      var status = root.document && root.document.getElementById('account-status');
      if (status) status.textContent = 'Signed out. Your log is still on this device.';
    }, function () {
      sessionUser = null;
      emit();
    });
  }

  function useAccessToken(accessToken, refreshToken) {
    if (!accessToken) return Promise.resolve(null);
    return loadSdk().then(function (api) {
      if (!api) return null;
        return api.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken || accessToken
        }).then(function (result) {
          if (result.error) throw result.error;
          setUserFromSession(result.data.session);
          return runMigration().then(function () { return sessionUser; });
        });
      });
  }

  function runMigration() {
    if (!client || !sessionUser) return Promise.resolve(null);
    if (migratedFor === sessionUser.id) return Promise.resolve(null);
    var id = sessionUser.id;
    migratedFor = id;
    var snapshot = snapshotProvider() || {};
    return ensureProfile(snapshot.displayName).then(function () {
      return loadNames();
    }).then(function () {
      return migrate(snapshot);
    }).then(function (summary) {
      if (summary && summary.text) showMigration(summary.text);
      if (summary && summary.pulled > 0 && typeof snapshot.onApply === 'function') snapshot.onApply(summary.nextItems);
      return uploadPhotos(snapshot.listPhotos).then(function () { return summary; });
    }).catch(function () {
      if (migratedFor === id) migratedFor = '';
      return null;
    });
  }

  function ensureProfile(displayName) {
    if (!client || !sessionUser) return Promise.resolve();
    var name = chooseDisplayName(displayName, sessionUser.displayName);
    return client.from('profiles').upsert({
      id: sessionUser.id,
      display_name: name,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' }).then(function (result) {
      if (result.error) throw result.error;
      if (name) sessionUser.displayName = name;
    });
  }

  function boot(snapshotFn) {
    prepareScreen();
    if (typeof snapshotFn === 'function') snapshotProvider = snapshotFn;
    if (!configured()) return Promise.resolve(null);
    if (bootPromise) return bootPromise.then(function () { return runMigration().then(function () { return sessionUser; }); });
    bootPromise = loadSdk().then(function (api) {
      if (!api) return null;
      api.auth.onAuthStateChange(function (_event, session) {
        setUserFromSession(session);
        runMigration();
      });
      return api.auth.getSession().then(function (result) {
        setUserFromSession(result.data && result.data.session);
        return runMigration().then(function () { return sessionUser; });
      });
    }).catch(function () {
      bootPromise = null;
      var status = root.document && root.document.getElementById('account-status');
      if (status) status.textContent = 'The account service could not be reached. Your log is still on this device.';
      return null;
    });
    return bootPromise;
  }

  function bindLogin() {
    if (typeof root.document === 'undefined' || root.document.documentElement.dataset.accountBound) return;
    root.document.documentElement.dataset.accountBound = '1';
    var send = root.document.getElementById('magic-send');
    if (send) send.addEventListener('click', function () {
      var input = root.document.getElementById('magic-email');
      var first = root.document.getElementById('magic-first');
      var last = root.document.getElementById('magic-last');
      var status = root.document.getElementById('magic-status');
      signInWithEmail(input ? input.value : '', first ? first.value : '', last ? last.value : '').then(function (result) {
        if (!status) return;
        if (result.ok) status.textContent = 'Check your email for the sign-in link. You can close this and come back from that link.';
        else if (result.reason === 'name') status.textContent = 'Enter your first name and your last name.';
        else if (result.reason === 'email') status.textContent = 'Enter the email address you want the link sent to.';
        else if (result.reason === 'unconfigured') status.textContent = 'Accounts are not connected on this copy yet.';
        else status.textContent = 'The link could not be sent. Your log is still on this device.';
      });
    });
    var area = root.document.getElementById('account-area-save');
    if (area) area.addEventListener('click', function () {
      var input = root.document.getElementById('account-area');
      var status = root.document.getElementById('account-status');
      if (!configured()) {
        if (status) status.textContent = 'An account server is not connected yet, so this place name is not saved or shared.';
        return;
      }
      if (!sessionUser) {
        if (status) status.textContent = 'Sign in to save an approximate area on your account.';
        return;
      }
      saveArea(input ? input.value : '').then(function (result) {
        if (!status) return;
        if (result.ok) status.textContent = result.region ? 'Saved. Others can see the place name only, not a map pin.' : 'Cleared. No place name is shared.';
        else if (result.reason === 'coordinates') status.textContent = 'Use a place name, such as Chamonix. Coordinates are not stored.';
        else status.textContent = 'The place name could not be saved. Nothing else changed.';
      });
    });
  }

  bindLogin();

  return {
    configured: configured,
    pushEnabled: pushEnabled,
    user: user,
    client: function () { return client; },
    onChange: onChange,
    prepareScreen: prepareScreen,
    publicShare: publicShare,
    planMigration: planMigration,
    chooseDisplayName: chooseDisplayName,
    namesFromMetadata: namesFromMetadata,
    saveNames: saveNames,
    redirectTo: redirectTo,
    migrationSentence: migrationSentence,
    boot: boot,
    signInWithEmail: signInWithEmail,
    signInWithProvider: signInWithProvider,
    signOut: signOut,
    useAccessToken: useAccessToken,
    publishItem: publishItem,
    publishMembership: publishMembership,
    saveArea: saveArea,
    PUBLIC_KEYS: PUBLIC_KEYS
  };
});
