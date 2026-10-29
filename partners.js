// Objective search and partner queues. Demo people live in this file on purpose:
// they are sample profiles, never accounts, and the UI must badge them as Demo.
// Your own queue places are records the storage module can later send to a server.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SummitPartners = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FAMOUS_ALIASES = {
    'tour du mont blanc': ['TMB', 'UTMB'],
    'haute randonnee pyreneenne': ['HRP'],
    'tour du mont rose': ['Monte Rosa', 'Tour of Monte Rosa']
  };

  // Invented sample climbers. Shared logs are examples, not anyone's real ascents.
  var DEMOS = [
    {
      id: 'demo-lea',
      name: 'Léa M.',
      initials: 'LM',
      level: 'Alpine AD, glacier travel',
      entries: [
        {
          objective: 'Matterhorn',
          dates: 'mid July',
          note: 'Looking for a rope of three on the Hörnli.',
          logs: [
            { name: 'Gran Paradiso', kind: 'peak', detail: '4061 m · 2024' },
            { name: 'Breithorn', kind: 'peak', detail: '4164 m · 2023' }
          ]
        }
      ]
    },
    {
      id: 'demo-jonas',
      name: 'Jonas K.',
      initials: 'JK',
      level: 'Alpine PD+, some rock leading',
      entries: [
        {
          objective: 'Matterhorn',
          dates: 'late August',
          note: 'Free after the 20th. Can take a turn on easy pitches.',
          logs: [
            { name: 'Allalinhorn', kind: 'peak', detail: '4027 m · 2025' }
          ]
        },
        {
          objective: 'Mont Blanc',
          dates: 'early July',
          note: 'A weekday would keep the huts quieter.',
          logs: [
            { name: 'Aiguille du Tour', kind: 'peak', detail: '3540 m · 2024' }
          ]
        }
      ]
    },
    {
      id: 'demo-sam',
      name: 'Sam R.',
      initials: 'SR',
      level: 'Alpine F, learning glacier travel',
      entries: [
        {
          objective: 'Matterhorn',
          dates: 'September, flexible',
          note: 'First 4000 with a guide was last year. Happy to follow.',
          logs: []
        }
      ]
    },
    {
      id: 'demo-ines',
      name: 'Inès P.',
      initials: 'IP',
      level: 'Long trails, no glacier',
      entries: [
        {
          objective: 'Tour du Mont Blanc',
          dates: 'two weeks in July',
          note: 'Counter-clockwise. Hut bookings are not made yet.',
          logs: [
            { name: 'GR5', kind: 'hike', detail: 'A week in the Chamonix valley · 2024' }
          ]
        },
        {
          objective: 'Haute Randonnée Pyrénéenne',
          dates: 'August',
          note: 'Looking at the western half only.',
          logs: []
        }
      ]
    },
    {
      id: 'demo-noah',
      name: 'Noah B.',
      initials: 'NB',
      level: 'Alpine F+',
      entries: [
        {
          objective: 'Barre des Écrins',
          dates: 'late June',
          note: 'Have crampons and a rope. New to the Écrins.',
          logs: [
            { name: 'La Meije', kind: 'peak', detail: 'Walked under the face · 2023' }
          ]
        }
      ]
    },
    {
      id: 'demo-chiara',
      name: 'Chiara V.',
      initials: 'CV',
      level: 'Alpine PD',
      entries: [
        {
          objective: 'Mont Blanc',
          dates: 'first week of August',
          note: 'Goûter or Grands Mulets, either is fine.',
          logs: [
            { name: 'Gran Paradiso', kind: 'peak', detail: '4061 m · 2022' }
          ]
        },
        {
          objective: 'Dom',
          dates: 'July',
          note: 'Would like a day with an early start.',
          logs: []
        }
      ]
    },
    {
      id: 'demo-omar',
      name: 'Omar S.',
      initials: 'OS',
      level: 'Trail days and fast hiking',
      entries: [
        {
          objective: 'GR20',
          dates: 'September',
          note: 'North to south, with a light pack.',
          logs: [
            { name: 'GR5', kind: 'hike', detail: 'Lake Geneva to Modane · 2021' }
          ]
        }
      ]
    }
  ];

  function fold(value) {
    return String(value || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function nameKey(value) {
    return fold(String(value || '').replace(/\([^)]*\)/g, ' '));
  }

  function slug(value) {
    return fold(value).replace(/ /g, '-').slice(0, 80);
  }

  function isUuid(value) {
    return typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  function clean(value, max) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
  }

  function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    if (Math.abs(a.length - b.length) > 2) return 9;
    var prev = [];
    var i;
    var j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i];
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function scoreText(query, text) {
    var q = fold(query);
    var n = fold(text);
    if (!q || !n) return 0;
    if (n === q) return 1000;
    if (n.indexOf(q) === 0) return 800;
    var words = n.split(' ');
    var i;
    for (i = 0; i < words.length; i++) {
      if (words[i].indexOf(q) === 0) return 700;
    }
    if (q.length < 3) return 0;
    if (n.indexOf(q) >= 0) return 600;
    var allowance = q.length >= 6 ? 2 : 1;
    if (Math.abs(q.length - n.length) <= allowance && editDistance(q, n) <= allowance) return 520;
    var compact = n.replace(/ /g, '');
    if (Math.abs(q.length - compact.length) <= allowance && editDistance(q, compact) <= allowance) return 500;
    for (i = 0; i < words.length; i++) {
      if (Math.abs(q.length - words[i].length) <= allowance && editDistance(q, words[i]) <= allowance) return 480;
    }
    return 0;
  }

  function scoreObjective(query, objective) {
    var best = scoreText(query, objective && objective.name);
    (objective && objective.aliases || []).forEach(function (alias) {
      var score = scoreText(query, alias);
      if (score > best) best = score;
    });
    return best;
  }

  function searchObjectives(catalog, query, limit) {
    var q = fold(query);
    if (!q) return [];
    var cap = limit || 8;
    var scored = [];
    (catalog || []).forEach(function (objective) {
      var score = scoreObjective(q, objective);
      if (score > 0) scored.push({ objective: objective, score: score });
    });
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.objective.name).localeCompare(String(b.objective.name));
    });
    return scored.slice(0, cap).map(function (row) { return row.objective; });
  }

  function aliasesFor(name) {
    return (FAMOUS_ALIASES[fold(name)] || []).slice();
  }

  function buildCatalog(input) {
    var source = input || {};
    var byFold = {};
    var list = [];

    function add(objective) {
      var key = fold(objective.name);
      if (!key || byFold[key]) return;
      byFold[key] = objective;
      list.push(objective);
    }

    (source.peaks || []).forEach(function (peak) {
      if (!peak || !peak.name || !peak.id) return;
      add({
        id: 'collection:' + peak.id,
        name: peak.name,
        kind: 'peak',
        elevation: typeof peak.elevation === 'number' ? peak.elevation : null,
        grade: peak.grade || '',
        range: peak.subrange || source.region || 'Alps',
        aliases: [],
        source: 'collection'
      });
    });

    (source.famous || []).forEach(function (place) {
      if (!place || !place.name) return;
      add({
        id: 'famous:' + slug(place.name),
        name: place.name,
        kind: place.kind === 'peak' || place.kind === 'route' ? place.kind : 'hike',
        elevation: typeof place.elevation === 'number' ? place.elevation : null,
        grade: '',
        range: place.area || '',
        note: place.note || '',
        aliases: aliasesFor(place.name),
        source: 'famous'
      });
    });

    function addItem(item, rangeLabel) {
      if (!item || !item.name || !isUuid(String(item.id || ''))) return;
      if (byFold[fold(item.name)]) return;
      var soft = nameKey(item.name);
      var hits = list.filter(function (objective) { return nameKey(objective.name) === soft; });
      if (hits.length === 1) {
        var extra = String(item.name).match(/\(([^)]+)\)/);
        if (extra && hits[0].aliases.indexOf(extra[1]) < 0) hits[0].aliases.push(extra[1]);
        return;
      }
      add({
        id: 'local:' + String(item.id).toLowerCase(),
        name: item.name,
        kind: item.kind === 'route' || item.kind === 'hike' ? item.kind : 'peak',
        elevation: typeof item.elevation === 'number' ? item.elevation : null,
        grade: item.grade || '',
        distance: typeof item.distance === 'number' ? item.distance : null,
        activity: item.activity || '',
        range: item.kind === 'route' && item.crag ? item.crag : rangeLabel,
        aliases: [],
        source: rangeLabel
      });
    }

    (source.logs || []).forEach(function (item) { addItem(item, 'Done'); });
    (source.backlog || []).forEach(function (item) { addItem(item, 'Planned'); });
    return list;
  }

  function resolveObjective(catalog, item) {
    if (!item || !item.name) return null;
    var exact = fold(item.name);
    var soft = nameKey(item.name);
    var exactHit = null;
    var softHits = [];
    (catalog || []).forEach(function (objective) {
      if (fold(objective.name) === exact) exactHit = objective;
      if (nameKey(objective.name) === soft) softHits.push(objective);
    });
    if (exactHit) return exactHit;
    if (softHits.length === 1) return softHits[0];
    var personal = buildCatalog({ backlog: [item] });
    return personal[0] || null;
  }

  function detailLine(objective) {
    if (!objective) return '';
    if (objective.kind === 'route') return objective.grade || objective.activity || 'Route';
    if (objective.kind === 'hike') {
      if (typeof objective.distance === 'number') return objective.distance + ' km';
      if (typeof objective.elevation === 'number') return objective.elevation + ' m gain';
      return objective.note || 'Hike';
    }
    var parts = [];
    if (typeof objective.elevation === 'number') parts.push(objective.elevation + ' m');
    if (objective.grade) parts.push(objective.grade);
    return parts.join(' · ') || 'Peak';
  }

  function kindLabel(kind) {
    if (kind === 'route') return 'Route';
    if (kind === 'hike') return 'Hike';
    return 'Peak';
  }

  function contextNow(context) {
    var ctx = context || {};
    return {
      now: typeof ctx.now === 'string' && ctx.now ? ctx.now : new Date().toISOString(),
      mint: typeof ctx.mint === 'function' ? ctx.mint : function () {
        return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
      }
    };
  }

  function validObjectiveId(value) {
    return typeof value === 'string' &&
      /^(collection:[a-z0-9-]{1,48}|famous:[a-z0-9-]{1,80}|local:[0-9a-f-]{36})$/.test(value);
  }

  function attachedIds(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    value.forEach(function (id) {
      var text = typeof id === 'string' ? id.trim().toLowerCase() : '';
      if (!isUuid(text) || out.indexOf(text) >= 0) return;
      out.push(text);
    });
    return out.slice(0, 12);
  }

  function normalizeMembership(raw, context, mode) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var name = clean(raw.objectiveName || raw.objective, 200);
    if (!name) return null;
    var ctx = contextNow(context);
    var id = isUuid(String(raw.id || '')) ? String(raw.id).toLowerCase() : '';
    if (mode === 'create' || !id) id = String(ctx.mint()).toLowerCase();
    var created = clean(raw.createdAt, 40);
    var updated = clean(raw.updatedAt, 40);
    if (mode === 'create' || !created) created = ctx.now;
    if (mode === 'create' || mode === 'update' || !updated) updated = ctx.now;
    return {
      id: id,
      objectiveId: validObjectiveId(raw.objectiveId) ? raw.objectiveId : '',
      objectiveName: name,
      dates: clean(raw.dates, 120),
      note: clean(raw.note != null ? raw.note : raw.looking, 400),
      attachedIds: attachedIds(raw.attachedIds),
      createdAt: created,
      updatedAt: updated
    };
  }

  function sameObjective(a, b) {
    if (a.objectiveId && b.objectiveId && a.objectiveId === b.objectiveId) return true;
    return fold(a.objectiveName) === fold(b.objectiveName);
  }

  function migrateMemberships(items, context) {
    var list = [];
    (Array.isArray(items) ? items : []).forEach(function (raw) {
      var next = normalizeMembership(raw, context, 'keep');
      if (!next) return;
      var index = -1;
      list.forEach(function (item, i) {
        if (sameObjective(item, next)) index = i;
      });
      if (index >= 0) list[index] = next;
      else list.push(next);
    });
    return list;
  }

  function membershipsFromPosts(posts, context) {
    return migrateMemberships((posts || []).map(function (post) {
      if (!post) return null;
      return {
        objectiveName: post.objective,
        objectiveId: '',
        dates: post.dates && post.dates !== 'Flexible' ? post.dates : '',
        note: post.looking || '',
        attachedIds: post.attachedIds || [],
        createdAt: post.createdAt,
        updatedAt: post.updatedAt
      };
    }), context);
  }

  function upsertMembership(items, fields, context) {
    var list = migrateMemberships(items, context).slice();
    var draft = {
      objectiveId: fields.objectiveId || '',
      objectiveName: fields.objectiveName || '',
      dates: fields.dates || '',
      note: fields.note || '',
      attachedIds: fields.attachedIds || []
    };
    var index = -1;
    list.forEach(function (item, i) {
      if (sameObjective(item, draft)) index = i;
    });
    if (index >= 0) {
      draft.id = list[index].id;
      draft.createdAt = list[index].createdAt;
      list[index] = normalizeMembership(draft, context, 'update');
    } else {
      list.push(normalizeMembership(draft, context, 'create'));
    }
    return list.filter(Boolean);
  }

  function removeMembership(items, objective) {
    var target = objective || {};
    return (items || []).filter(function (item) {
      return !sameObjective(item, {
        objectiveId: target.id || target.objectiveId || '',
        objectiveName: target.name || target.objectiveName || ''
      });
    });
  }

  function membershipFor(objective, items) {
    var found = null;
    (items || []).forEach(function (item) {
      if (sameObjective(item, {
        objectiveId: objective && objective.id,
        objectiveName: objective && objective.name
      })) found = item;
    });
    return found;
  }

  function demoQueue(objective) {
    var want = fold(objective && objective.name);
    if (!want) return [];
    var people = [];
    DEMOS.forEach(function (person) {
      person.entries.forEach(function (entry) {
        if (fold(entry.objective) !== want) return;
        people.push({
          id: person.id,
          demo: true,
          name: person.name,
          initials: person.initials,
          level: person.level,
          dates: entry.dates,
          note: entry.note,
          logs: (entry.logs || []).map(function (log) {
            return { name: log.name, kind: log.kind, detail: log.detail };
          })
        });
      });
    });
    return people;
  }

  return {
    DEMOS: DEMOS,
    fold: fold,
    nameKey: nameKey,
    scoreObjective: scoreObjective,
    searchObjectives: searchObjectives,
    buildCatalog: buildCatalog,
    resolveObjective: resolveObjective,
    detailLine: detailLine,
    kindLabel: kindLabel,
    normalizeMembership: normalizeMembership,
    migrateMemberships: migrateMemberships,
    membershipsFromPosts: membershipsFromPosts,
    upsertMembership: upsertMembership,
    removeMembership: removeMembership,
    membershipFor: membershipFor,
    demoQueue: demoQueue
  };
});
