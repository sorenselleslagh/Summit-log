'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var logic = require('../logic.js');
var storageApi = require('../storage.js');

var NOW = '2026-10-29T12:00:00.000Z';
var LATER = '2026-11-01T08:30:00.000Z';

function sequenceMint() {
  var n = 0;
  return function () {
    n += 1;
    var tail = n.toString(16).padStart(12, '0');
    return '00000000-0000-4000-8000-' + tail;
  };
}

function ctx(mint) {
  return { now: NOW, mint: mint || sequenceMint() };
}

function memoryStorage(initial) {
  var data = Object.assign({}, initial || {});
  return {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem: function (key, value) { data[key] = String(value); },
    removeItem: function (key) { delete data[key]; }
  };
}

function repo(initial, mint) {
  var ids = mint || sequenceMint();
  return storageApi.createRepository({
    storage: memoryStorage(initial),
    logic: logic,
    now: function () { return NOW; },
    mint: ids
  });
}

var migrated = logic.migrateLogs(logic.SAMPLE_LOGS, ctx());
assert.strictEqual(migrated.length, 3);
assert.strictEqual(migrated[0].name, 'Mont Blanc');
assert.strictEqual(migrated[2].name, 'Local sport session');
assert.strictEqual(migrated[2].elevation, 0);
assert.strictEqual(migrated[2].lat, 46);
assert.strictEqual(migrated[2].lng, 7.5);
assert.ok(logic.isUuid(migrated[0].id));
assert.notStrictEqual(migrated[0].id, migrated[1].id);
assert.strictEqual(migrated[0].createdAt, NOW);
assert.strictEqual(migrated[0].updatedAt, NOW);

var again = logic.migrateLogs(migrated, {
  now: LATER,
  mint: function () { throw new Error('minted twice'); }
});
assert.deepStrictEqual(again, migrated);

var stats = logic.computeStats(migrated);
assert.strictEqual(stats.peaks, 2);
assert.strictEqual(stats.trips, 3);
assert.strictEqual(stats.elevation, 8286);
assert.strictEqual(stats.entries, 3);
assert.notStrictEqual(stats.peaks, stats.entries);

var sameDay = logic.computeStats([
  logic.normalizeLog({ name: 'A', type: 'Hiking / Peak bagging', date: '2024-06-01', elevation: 100 }, ctx()),
  logic.normalizeLog({ name: 'B', type: 'Alpine / Mountaineering', date: '2024-06-01', elevation: 50 }, ctx()),
  logic.normalizeLog({ name: 'C', type: 'Sport / Trad climbing', date: '2024-06-02', elevation: 10 }, ctx()),
  logic.normalizeLog({ name: 'D', type: 'Ice / Mixed', date: '2024-06-03', elevation: 0 }, ctx()),
  logic.normalizeLog({ name: 'E', type: 'Ski touring', date: '', elevation: null }, ctx())
]);
assert.strictEqual(sameDay.peaks, 3);
assert.strictEqual(sameDay.trips, 3);
assert.strictEqual(sameDay.elevation, 160);
assert.strictEqual(sameDay.entries, 5);

assert.strictEqual(logic.isPeak({ type: 'Sport / Trad climbing' }), false);
assert.strictEqual(logic.isPeak({ type: 'Ice / Mixed' }), false);
assert.strictEqual(logic.isPeak({ type: 'Ski touring' }), true);

var zero = logic.normalizeLog({ id: 1, name: 'Null Island', lat: 0, lng: 0, elevation: 0, date: '2024-01-02' }, ctx());
assert.strictEqual(zero.lat, 0);
assert.strictEqual(zero.lng, 0);
assert.strictEqual(zero.elevation, 0);
assert.ok(logic.isUuid(zero.id));
assert.strictEqual(logic.hasCoords(zero), true);
assert.strictEqual(logic.hasCoords({ lat: 0, lng: null }), false);
assert.strictEqual(logic.formatNumberInput(0), '0');
assert.strictEqual(logic.formatNumberInput(null), '');

assert.strictEqual(logic.normalizeLog({ name: 'A', elevation: '' }, ctx()).elevation, null);
assert.strictEqual(logic.normalizeLog({ name: 'A', elevation: '0' }, ctx()).elevation, 0);
assert.strictEqual(logic.normalizeLog({ name: 'A', elevation: '3808' }, ctx()).elevation, 3808);
assert.strictEqual(logic.normalizeLog({ name: 'A', lat: '0', lng: '0' }, ctx()).lat, 0);
assert.strictEqual(logic.normalizeLog({ name: 'A', lat: 0, lng: 200 }, ctx()).lat, null);
assert.strictEqual(logic.normalizeLog({ name: 'A', date: '2024-13-01' }, ctx()).date, '');
assert.strictEqual(logic.normalizeLog({ name: 'A\u0000B' }, ctx()).name, 'AB');
assert.strictEqual(logic.loggedInArea({ lat: 0, lng: 0 }, { lat: 0, lng: 0, radius: 1000 }), true);
assert.strictEqual(logic.loggedInArea({ lat: 0, lng: 0 }, { lat: 45.8326, lng: 6.8652, radius: 18000 }), false);
assert.strictEqual(logic.loggedInArea({ lat: null, lng: null }, { lat: 0, lng: 0, radius: 1000 }), false);
assert.strictEqual(logic.loggedInArea({ lat: 45.8326, lng: 6.8652 }, { lat: 45.8326, lng: 6.8652, radius: 18000 }), true);

var legacyStringId = logic.normalizeLog({
  id: '1730550000000ab12',
  name: '<img src=x onerror=alert(1)>',
  notes: '<script>alert(1)</script>',
  type: 'Sport / Trad climbing'
}, ctx());
assert.ok(logic.isUuid(legacyStringId.id));
assert.notStrictEqual(legacyStringId.id, '1730550000000ab12');
assert.strictEqual(legacyStringId.name, '<img src=x onerror=alert(1)>');
assert.strictEqual(legacyStringId.notes, '<script>alert(1)</script>');

var keptId = '11111111-1111-4111-8111-111111111111';
var imported = logic.prepareImport({
  logs: [{
    id: keptId,
    name: 'Kept',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-06-01T00:00:00.000Z',
    elevation: 0,
    lat: 0,
    lng: 0,
    type: 'Alpine / Mountaineering'
  }],
  partnerPosts: [{ id: 3, objective: '<b>obj</b>', dates: '<i>soon</i>', looking: '<script>', shared: '<svg onload=alert(1)>' }]
}, ctx());
assert.strictEqual(imported.logs[0].id, keptId);
assert.strictEqual(imported.logs[0].createdAt, '2020-01-01T00:00:00.000Z');
assert.strictEqual(imported.logs[0].updatedAt, '2020-06-01T00:00:00.000Z');
assert.strictEqual(imported.logs[0].lat, 0);
assert.strictEqual(imported.logs[0].elevation, 0);
assert.ok(logic.isUuid(imported.partnerPosts[0].id));
assert.strictEqual(imported.partnerPosts[0].objective, '<b>obj</b>');
assert.strictEqual(imported.partnerPosts[0].createdAt, NOW);

var created = logic.createLog({ id: 1, name: 'New', elevation: 0, lat: 0, lng: 0 }, ctx());
assert.ok(logic.isUuid(created.id));
assert.notStrictEqual(created.id, '1');
assert.strictEqual(created.createdAt, NOW);
assert.strictEqual(created.updatedAt, NOW);
assert.strictEqual(created.lat, 0);

var edited = logic.updateLog(created, { notes: 'Changed', id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, { now: LATER, mint: sequenceMint() });
assert.strictEqual(edited.id, created.id);
assert.strictEqual(edited.createdAt, created.createdAt);
assert.strictEqual(edited.updatedAt, LATER);
assert.strictEqual(edited.notes, 'Changed');
assert.strictEqual(edited.name, 'New');

assert.throws(function () { logic.prepareImport(null); });
assert.throws(function () { logic.prepareImport([]); });
assert.throws(function () { logic.prepareImport({ logs: {} }); });
assert.throws(function () { logic.prepareImport({}); });
assert.throws(function () { logic.prepareImport({ logs: [{ name: '' }] }); });

var mixed = logic.prepareImport({ logs: [{ name: 'Ok' }, { name: '  ' }, null, 'x'] }, ctx());
assert.strictEqual(mixed.logs.length, 1);
assert.strictEqual(mixed.skippedLogs, 3);
assert.strictEqual(mixed.replacePosts, false);

var dup = logic.prepareImport({
  logs: [
    { id: keptId, name: 'One' },
    { id: keptId, name: 'Two' }
  ]
}, ctx());
assert.notStrictEqual(dup.logs[0].id, dup.logs[1].id);
assert.strictEqual(dup.logs[0].name, 'One');
assert.strictEqual(dup.logs[1].name, 'Two');

logic.prepareImport(JSON.parse('{"logs":[{"name":"Ok","__proto__":{"polluted":true}}],"partnerPosts":[]}'));
assert.strictEqual({}.polluted, undefined);

assert.deepStrictEqual(logic.parseStoredArray('{"nope"'), { ok: false, items: [] });
assert.deepStrictEqual(logic.parseStoredArray('[]'), { ok: true, items: [] });
assert.strictEqual(logic.todayISO(new Date(2024, 0, 5, 23, 30)), '2024-01-05');
assert.strictEqual(logic.readCoordPair('0', '0').lat, 0);
assert.ok(logic.readCoordPair('', '5').error);
assert.strictEqual(logic.readElevation('0').value, 0);
assert.ok(logic.readElevation('-4').error);

var store = memoryStorage({ summitlogs: JSON.stringify(logic.SAMPLE_LOGS) });
var library = storageApi.createRepository({
  storage: store,
  logic: logic,
  now: function () { return NOW; },
  mint: sequenceMint()
});
var loaded = library.loadLogs();
var loadedAgain = library.loadLogs();
assert.strictEqual(loaded.length, 3);
assert.strictEqual(loaded[0].id, loadedAgain[0].id);
assert.strictEqual(loaded[0].createdAt, loadedAgain[0].createdAt);
assert.ok(logic.isUuid(JSON.parse(store.getItem('summitlogs'))[0].id));
assert.notStrictEqual(JSON.parse(store.getItem('summitlogs'))[0].id, 1);
assert.strictEqual(loaded[2].elevation, 0);

library.setDisplayName('Ada');
assert.strictEqual(library.getDisplayName(), 'Ada');
assert.strictEqual(library.loadLogs()[0].name, 'Mont Blanc');
library.clearDisplayName();
assert.strictEqual(library.getDisplayName(), '');
assert.strictEqual(library.loadLogs().length, 3);

assert.strictEqual(library.isIntroDismissed(), false);
assert.strictEqual(library.dismissIntro(), true);
assert.strictEqual(store.getItem('summitlog_intro_seen'), '1');
assert.strictEqual(library.isIntroDismissed(), true);
library.clearDisplayName();
assert.strictEqual(library.isIntroDismissed(), true);

var fresh = repo();
assert.strictEqual(fresh.loadLogs().length, 3);
assert.strictEqual(fresh.loadPosts().length, 0);
var post = logic.createPost({ objective: 'Eiger' }, ctx());
fresh.savePosts([post]);
assert.strictEqual(fresh.loadPosts()[0].objective, 'Eiger');
assert.ok(logic.isUuid(fresh.loadPosts()[0].id));

var root = path.join(__dirname, '..');
function read(name) { return fs.readFileSync(path.join(root, name), 'utf8'); }

var manifest = JSON.parse(read('manifest.webmanifest'));
var manifestUrl = new URL('https://sorenselleslagh.github.io/Summit-log/manifest.webmanifest');
var scope = new URL(manifest.scope, manifestUrl);
var start = new URL(manifest.start_url, manifestUrl);
assert.strictEqual(scope.pathname, '/Summit-log/');
assert.ok(start.href.startsWith(scope.href));
manifest.icons.forEach(function (icon) {
  assert.ok(!icon.src.startsWith('/') && !icon.src.startsWith('http'));
  assert.ok(fs.statSync(path.join(root, icon.src)).size > 500);
});

var sw = read('sw.js');
assert.ok(sw.includes("new URL("));
assert.ok(sw.includes('./storage.js'));
assert.ok(sw.includes('./illustrations/mountain.svg'));
assert.ok(sw.includes('./favicon.ico'));
assert.ok(!sw.includes("'/index"));
assert.ok(!sw.includes('"/index'));
assert.ok(!sw.includes("scope: '/'"));

var html = read('index.html');
var app = read('app.js');
assert.ok(html.includes('href="favicon.ico"'));
assert.ok(html.includes('href="manifest.webmanifest"'));
assert.ok(html.includes('src="storage.js"'));
assert.ok(html.includes('Your climbs, your log, your partners'));
assert.ok(html.includes('Start logging'));
assert.ok(html.includes('illustrations/mountain.svg'));
assert.ok(html.includes('View intro'));
assert.ok(!html.includes('I have an account'));
assert.ok(!html.includes('src="/'));
assert.ok(!html.includes('href="/'));
assert.ok(!app.includes('innerHTML'));
assert.ok(!app.includes('insertAdjacentHTML'));
assert.ok(!app.includes('localStorage'));
assert.ok(!fs.existsSync(path.join(root, 'summitlog.tar.gz')));
assert.ok(fs.existsSync(path.join(root, '.nojekyll')));
assert.ok(fs.existsSync(path.join(root, 'illustrations/mountain.svg')));
assert.ok(fs.statSync(path.join(root, 'favicon.ico')).size > 100);

console.log('data tests ok');
