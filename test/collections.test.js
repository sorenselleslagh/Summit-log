'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Col = require('../collections.js');
var doc = require('../data/collections/uiaa-alps-4000.json');

var collection = doc.collections[0];
assert.strictEqual(collection.id, 'uiaa-alps-4000');
assert.strictEqual(collection.peaks.length, 82);

var graded = collection.peaks.filter(function (peak) { return peak.grade; });
assert.strictEqual(graded.length, 82);
graded.forEach(function (peak) {
  assert.ok(peak.normalRoute);
  assert.ok(peak.sourceUrl);
  assert.ok(!Object.prototype.hasOwnProperty.call(peak, 'gear'));
  assert.ok(!Object.prototype.hasOwnProperty.call(peak, 'gearSource'));
});

var blanc = collection.peaks.filter(function (peak) { return peak.name === 'Mont Blanc'; })[0];
var hornli = { id: 'log-1', kind: 'peak', name: 'Matterhorn (Hörnli)', elevation: 4478, collectionId: '' };
var logs = [
  { id: 'log-mb', kind: 'peak', name: 'Mont Blanc', elevation: 4808, collectionId: '' },
  hornli
];
assert.strictEqual(Col.isSummited(blanc, logs), true);
assert.strictEqual(Col.isSummited(collection.peaks.filter(function (peak) { return peak.name === 'Matterhorn'; })[0], logs), true);
assert.strictEqual(Col.normName('Matterhorn (Hörnli)'), 'matterhorn');
var count = Col.progress(collection.peaks, logs);
assert.strictEqual(count.done, 2);
assert.strictEqual(count.total, 82);

var groups = Col.groupCollection(collection);
var summed = groups.reduce(function (n, group) { return n + group.peaks.length; }, 0);
assert.strictEqual(summed, 82);

var signal = collection.peaks.filter(function (peak) { return peak.name === 'Signalkuppe'; })[0];
assert.strictEqual(signal.grade, 'F');
assert.ok(signal.sourceUrl.indexOf('camptocamp.org') >= 0);
var ungraded = { id: 'x', name: 'Ungraded', elevation: 4300, subrange: signal.subrange, countries: signal.countries, grade: null };
var level = Col.estimateLevel(logs, collection.peaks, null);
assert.strictEqual(level.elevation, 4809);
assert.ok(level.grade);
var plan = Col.suggestBuildUp(ungraded, collection.peaks.concat([ungraded]), level);
assert.ok(plan.note.indexOf('unknown') >= 0);
assert.ok(plan.steps.length > 0);
plan.steps.forEach(function (step) {
  assert.ok(step.elevation < ungraded.elevation);
});

var manual = Col.estimateLevel(logs, collection.peaks, { useManual: true, grade: 'F', elevation: 2500, glacier: false });
assert.strictEqual(manual.grade, 'F');
assert.strictEqual(manual.elevation, 2500);
assert.strictEqual(manual.source, 'manual');
var toward = Col.suggestBuildUp(blanc, collection.peaks, manual);
assert.strictEqual(toward.above, true);
toward.steps.forEach(function (step) {
  assert.ok(step.elevation < blanc.elevation);
  if (step.grade && blanc.grade) assert.ok(Col.gradeRank(step.grade) <= Col.gradeRank(blanc.grade));
});

var sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.ok(sw.includes('./data/collections/uiaa-alps-4000.json'));
assert.ok(sw.includes('./collections.js'));
assert.ok(html.includes('src="collections.js"'));
assert.ok(html.includes('Build up') === false);
assert.ok(html.includes('Your level'));
assert.ok(!html.includes('Pyrenees'));

console.log('collections tests ok', graded.length, 'of 82 graded');
