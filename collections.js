// Peak-collection rules: progress, matching a log entry, and build-up steps.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SummitCollections = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var GRADE_ORDER = ['F', 'PD-', 'PD', 'PD+', 'AD-', 'AD', 'AD+', 'D-', 'D', 'D+', 'TD-', 'TD', 'TD+', 'ED-', 'ED', 'ED+'];

  function normName(name) {
    return String(name || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function gradeRank(grade) {
    if (!grade) return null;
    var best = null;
    String(grade).split('/').forEach(function (part) {
      var index = GRADE_ORDER.indexOf(part.trim());
      if (index >= 0 && (best == null || index > best)) best = index;
    });
    return best;
  }

  function countryLabel(peak) {
    return (peak.countries || []).join(' / ');
  }

  function matchingLogPeaks(peak, logs) {
    var want = normName(peak.name);
    return (logs || []).filter(function (item) {
      if (!item || item.kind !== 'peak') return false;
      if (item.collectionId && item.collectionId === peak.id) return true;
      return normName(item.name) === want;
    });
  }

  function isSummited(peak, logs) {
    var direct = matchingLogPeaks(peak, logs);
    if (direct.length) return true;
    var ids = {};
    direct.forEach(function (item) { ids[item.id] = true; });
    return (logs || []).some(function (item) {
      if (!item || item.kind === 'peak' || !item.peakIds) return false;
      return item.peakIds.some(function (id) { return ids[id]; });
    });
  }

  function progress(peaks, logs) {
    var list = peaks || [];
    var done = 0;
    list.forEach(function (peak) { if (isSummited(peak, logs)) done += 1; });
    return { done: done, total: list.length };
  }

  function groupCollection(collection) {
    var countries = {};
    (collection.peaks || []).forEach(function (peak) {
      var country = countryLabel(peak) || 'Unknown';
      if (!countries[country]) countries[country] = {};
      var sub = peak.subrange || 'Other';
      if (!countries[country][sub]) countries[country][sub] = [];
      countries[country][sub].push(peak);
    });
    return Object.keys(countries).sort().map(function (country) {
      var subs = countries[country];
      return {
        name: country,
        peaks: Object.keys(subs).reduce(function (all, sub) { return all.concat(subs[sub]); }, []),
        subranges: Object.keys(subs).sort().map(function (sub) {
          return { name: sub, peaks: subs[sub].slice().sort(function (a, b) { return b.elevation - a.elevation; }) };
        })
      };
    });
  }

  function estimateLevel(logs, peaks, manual) {
    if (manual && manual.useManual) {
      return {
        grade: manual.grade || null,
        elevation: typeof manual.elevation === 'number' ? manual.elevation : null,
        glacier: manual.glacier === true ? true : manual.glacier === false ? false : null,
        source: 'manual'
      };
    }
    var elevation = null;
    var bestRank = null;
    var grade = null;
    var glacier = null;
    (peaks || []).forEach(function (peak) {
      if (!isSummited(peak, logs)) return;
      if (typeof peak.elevation === 'number' && (elevation == null || peak.elevation > elevation)) elevation = peak.elevation;
      var rank = gradeRank(peak.grade);
      if (rank != null && (bestRank == null || rank > bestRank)) {
        bestRank = rank;
        grade = peak.grade;
      }
      if (peak.terrain && peak.terrain.indexOf('glacier') >= 0) glacier = true;
    });
    (logs || []).forEach(function (item) {
      if (!item || item.kind !== 'peak' || typeof item.elevation !== 'number') return;
      if (elevation == null || item.elevation > elevation) elevation = item.elevation;
    });
    return { grade: grade, elevation: elevation, glacier: glacier, source: 'logged' };
  }

  function suggestBuildUp(target, peaks, level) {
    var rankTarget = gradeRank(target.grade);
    var rankUser = level ? gradeRank(level.grade) : null;
    var userElev = level && typeof level.elevation === 'number' ? level.elevation : null;
    var above = false;
    if (typeof target.elevation === 'number' && userElev != null && target.elevation > userElev) above = true;
    if (rankTarget != null && rankUser != null && rankTarget > rankUser) above = true;
    if (userElev == null && rankUser == null) above = true;

    var note = above
      ? 'A few summits that build toward this one. This is only for you, not a ranking.'
      : 'From what you have logged, this looks within reach. Nothing here is a score.';
    if (!target.grade) {
      note = 'Normal-route grade for this peak is unknown, so these ideas use elevation and area only, not a guessed grade. ' + note;
    }

    var pool = (peaks || []).filter(function (peak) {
      if (peak.id === target.id) return false;
      if (typeof peak.elevation !== 'number' || typeof target.elevation !== 'number') return false;
      if (peak.elevation >= target.elevation) return false;
      if (rankTarget != null && gradeRank(peak.grade) != null && gradeRank(peak.grade) > rankTarget) return false;
      return true;
    });
    pool.sort(function (a, b) {
      var subA = a.subrange === target.subrange ? 0 : 1;
      var subB = b.subrange === target.subrange ? 0 : 1;
      if (subA !== subB) return subA - subB;
      var countryA = countryLabel(a) === countryLabel(target) ? 0 : 1;
      var countryB = countryLabel(b) === countryLabel(target) ? 0 : 1;
      if (countryA !== countryB) return countryA - countryB;
      return b.elevation - a.elevation;
    });
    return { above: above, note: note, steps: pool.slice(0, 3) };
  }

  return {
    GRADE_ORDER: GRADE_ORDER,
    normName: normName,
    gradeRank: gradeRank,
    countryLabel: countryLabel,
    matchingLogPeaks: matchingLogPeaks,
    isSummited: isSummited,
    progress: progress,
    groupCollection: groupCollection,
    estimateLevel: estimateLevel,
    suggestBuildUp: suggestBuildUp
  };
});
