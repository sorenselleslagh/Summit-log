'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var logic = require('../logic.js');
var partners = require('../partners.js');
var storageApi = require('../storage.js');
var doc = require('../data/collections/uiaa-alps-4000.json');

var NOW = '2026-10-29T12:00:00.000Z';

function sequenceMint() {
  var n = 0;
  return function () {
    n += 1;
    var tail = n.toString(16).padStart(12, '0');
    return '00000000-0000-4000-8000-' + tail;
  };
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

var catalog = partners.buildCatalog({
  peaks: doc.collections[0].peaks,
  famous: logic.FAMOUS,
  logs: [{ id: '00000000-0000-4000-8000-0000000000aa', name: 'Font 7A', kind: 'route', grade: '7A', crag: 'Fontainebleau' }],
  backlog: [{ id: '00000000-0000-4000-8000-0000000000bb', name: 'Matterhorn', kind: 'peak', elevation: 4478 }]
});

assert.strictEqual(catalog.filter(function (item) { return partners.fold(item.name) === 'matterhorn'; }).length, 1);
assert.strictEqual(catalog.filter(function (item) { return item.name === 'Mont Blanc'; }).length, 1);
assert.ok(catalog.some(function (item) { return item.name === 'Tour du Mont Blanc' && item.kind === 'hike'; }));
assert.ok(catalog.some(function (item) { return item.name === 'Font 7A' && item.range === 'Fontainebleau'; }));

var withLog = partners.buildCatalog({
  peaks: doc.collections[0].peaks,
  famous: logic.FAMOUS,
  logs: [{ id: '00000000-0000-4000-8000-0000000000cc', name: 'Matterhorn (Hörnli)', kind: 'peak', elevation: 4478 }],
  backlog: []
});
assert.strictEqual(withLog.filter(function (item) { return /matterhorn/i.test(item.name); }).length, 1);
assert.strictEqual(partners.searchObjectives(withLog, 'hornli', 4)[0].name, 'Matterhorn');
assert.strictEqual(partners.searchObjectives(withLog, 'ecrins', 8).filter(function (item) { return item.name.indexOf('Écrins') >= 0; }).length, 2);

var ma = partners.searchObjectives(catalog, 'Ma', 8);
assert.ok(ma.length > 0);
assert.strictEqual(ma[0].name, 'Matterhorn');
assert.strictEqual(ma[0].kind, 'peak');
assert.strictEqual(ma[0].elevation, 4478);
assert.ok(ma[0].grade);
assert.ok(ma[0].range);
ma.forEach(function (item) {
  var folded = partners.fold(item.name);
  var words = folded.split(' ');
  var prefix = folded.indexOf('ma') === 0 || words.some(function (word) { return word.indexOf('ma') === 0; });
  assert.ok(prefix, item.name);
});

assert.strictEqual(partners.searchObjectives(catalog, 'dom', 8)[0].name, 'Dom');
assert.strictEqual(partners.searchObjectives(catalog, 'ecrins', 8)[0].name, 'Barre des Écrins');
assert.strictEqual(partners.searchObjectives(catalog, 'materhorn', 8)[0].name, 'Matterhorn');
assert.strictEqual(partners.searchObjectives(catalog, 'hrp', 8)[0].name, 'Haute Randonnée Pyrénéenne');
assert.strictEqual(partners.searchObjectives(catalog, 'tmb', 8)[0].name, 'Tour du Mont Blanc');
assert.deepStrictEqual(partners.searchObjectives(catalog, '   ', 8), []);

var backlogItem = { id: '00000000-0000-4000-8000-0000000000bb', name: 'Matterhorn', kind: 'peak' };
var resolved = partners.resolveObjective(catalog, backlogItem);
assert.strictEqual(resolved.name, 'Matterhorn');
assert.ok(resolved.id.indexOf('collection:') === 0);

var queue = partners.demoQueue(resolved);
assert.ok(queue.length >= 3);
queue.forEach(function (person) {
  assert.strictEqual(person.demo, true);
  assert.ok(person.name);
  assert.ok(person.level);
});
assert.ok(queue.some(function (person) { return person.logs.length === 0; }));
assert.ok(queue.some(function (person) { return person.logs.length > 0; }));
assert.strictEqual(partners.demoQueue({ name: 'Font 7A' }).length, 0);

var ctx = { now: NOW, mint: sequenceMint() };
var joined = partners.upsertMembership([], {
  objectiveId: resolved.id,
  objectiveName: 'Matterhorn',
  dates: 'next weekend',
  note: 'hope the rock is dry',
  attachedIds: []
}, ctx);
assert.strictEqual(joined.length, 1);
assert.strictEqual(joined[0].attachedIds.length, 0);
assert.strictEqual(joined[0].dates, 'next weekend');
assert.ok(logic.isUuid(joined[0].id));
var edited = partners.upsertMembership(joined, {
  objectiveId: resolved.id,
  objectiveName: 'Matterhorn',
  dates: 'August',
  note: '',
  attachedIds: ['00000000-0000-4000-8000-0000000000aa', '<bad>', '00000000-0000-4000-8000-0000000000aa']
}, ctx);
assert.strictEqual(edited.length, 1);
assert.strictEqual(edited[0].id, joined[0].id);
assert.deepStrictEqual(edited[0].attachedIds, ['00000000-0000-4000-8000-0000000000aa']);
assert.strictEqual(partners.removeMembership(edited, resolved).length, 0);

var dirty = partners.normalizeMembership({
  objectiveName: '  Dom ',
  objectiveId: '<script>',
  dates: 'June',
  note: 'ok',
  attachedIds: []
}, ctx, 'create');
assert.strictEqual(dirty.objectiveId, '');
assert.strictEqual(dirty.objectiveName, 'Dom');

var store = memoryStorage({
  partnerposts: JSON.stringify([{ objective: 'Eiger', dates: 'June', looking: 'a rope', attachedIds: [] }])
});
var repo = storageApi.createRepository({
  storage: store,
  logic: logic,
  partners: partners,
  now: function () { return NOW; },
  mint: sequenceMint()
});
var seeded = repo.loadMemberships();
assert.strictEqual(seeded.length, 1);
assert.strictEqual(seeded[0].objectiveName, 'Eiger');
assert.strictEqual(seeded[0].note, 'a rope');
assert.deepStrictEqual(seeded[0].attachedIds, []);
assert.strictEqual(repo.loadMemberships().length, 1);
var saved = repo.saveMemberships(joined);
assert.strictEqual(saved[0].objectiveName, 'Matterhorn');
assert.strictEqual(repo.loadMemberships()[0].objectiveName, 'Matterhorn');
assert.ok(!JSON.stringify(repo.loadMemberships()).includes('demo-lea'));

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
var sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
assert.ok(html.includes("What's your objective?"));
assert.ok(html.includes('src="partners.js"'));
assert.ok(html.includes('>Find partners<'));
assert.ok(app.includes("text: 'Find partners'"));
assert.ok(app.includes('Join the queue'));
assert.ok(app.includes('Leave the queue'));
assert.ok(app.includes('Sign in to be visible to others'));
assert.ok(app.includes("text: person.demo ? 'Demo'"));
assert.ok(!app.includes('innerHTML'));
assert.ok(!app.includes('localStorage'));
assert.ok(sw.includes('./partners.js'));
assert.ok(sw.includes("VERSION = 'v5'"));
assert.ok(!html.includes('Post an objective'));

console.log('partners tests ok', catalog.length, 'objectives');
