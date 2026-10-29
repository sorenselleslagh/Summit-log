// Pure SummitLog rules: stats, coordinates, and import checks. No DOM.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SummitLogLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ACTIVITY_TYPES = [
    'Hiking / Peak bagging',
    'Alpine / Mountaineering',
    'Sport / Trad climbing',
    'Ice / Mixed',
    'Ski touring'
  ];

  // Summits and ski tours count as peaks. Crag sessions do not.
  var PEAK_TYPES = {
    'Hiking / Peak bagging': true,
    'Alpine / Mountaineering': true,
    'Ski touring': true
  };

  var LIMITS = {
    name: 200,
    notes: 4000,
    type: 80,
    objective: 200,
    dates: 120,
    looking: 2000,
    shared: 1000,
    id: 64,
    maxLogs: 5000,
    maxPosts: 2000,
    maxElevation: 20000
  };

  // Legacy shape still used by older localStorage data: numeric ids and no timestamps.
  var SAMPLE_LOGS = [
    { id: 1, name: 'Mont Blanc', type: 'Alpine / Mountaineering', date: '2025-08-12', elevation: 3808, notes: 'Via Goûter route. Clear weather, crowded upper section.', lat: 45.8326, lng: 6.8652 },
    { id: 2, name: 'Matterhorn (Hörnli)', type: 'Alpine / Mountaineering', date: '2025-07-03', elevation: 4478, notes: 'Hörnli ridge. Early start, good conditions.', lat: 45.9763, lng: 7.6586 },
    { id: 3, name: 'Local sport session', type: 'Sport / Trad climbing', date: '2026-10-15', elevation: 0, notes: '6b flash, 6c redpoint attempt.', lat: 46.0, lng: 7.5 }
  ];

  var EARTH_RADIUS_M = 6378137;

  function isUuid(value) {
    return typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  function parseTimestamp(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    var ms = Date.parse(value);
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toISOString();
  }

  function mintId() {
    var cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
    var bytes = new Uint8Array(16);
    var i;
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') cryptoObj.getRandomValues(bytes);
    else {
      for (i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = '';
    for (i = 0; i < 16; i++) hex += (bytes[i] + 0x100).toString(16).slice(1);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function identityContext(context) {
    var ctx = context || {};
    return {
      now: typeof ctx.now === 'string' && ctx.now ? ctx.now : new Date().toISOString(),
      mint: typeof ctx.mint === 'function' ? ctx.mint : mintId
    };
  }

  // mode: keep (migrate/import), create, or update.
  function applyIdentity(record, context, mode) {
    var ctx = identityContext(context);
    var copy = Object.assign({}, record);
    if (mode === 'create' || !isUuid(copy.id)) copy.id = ctx.mint();
    else copy.id = String(copy.id).toLowerCase();
    if (mode === 'create') {
      copy.createdAt = ctx.now;
      copy.updatedAt = ctx.now;
    } else if (mode === 'update') {
      copy.createdAt = parseTimestamp(copy.createdAt) || ctx.now;
      copy.updatedAt = ctx.now;
    } else {
      copy.createdAt = parseTimestamp(copy.createdAt) || ctx.now;
      copy.updatedAt = parseTimestamp(copy.updatedAt) || copy.createdAt;
    }
    return copy;
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanText(value, max) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
  }

  function parseDate(value) {
    if (typeof value !== 'string') return '';
    var s = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    var parts = s.split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return s;
  }

  function parseElevation(value) {
    if (value == null || typeof value === 'boolean') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    var n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n) || n < 0 || n > LIMITS.maxElevation) return null;
    return Math.round(n);
  }

  // Zero is a real coordinate. Only blank, null, and non-numeric values are missing.
  function parseCoord(value) {
    if (value == null || typeof value === 'boolean') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    var n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n)) return null;
    return n;
  }

  function readCoordPair(latRaw, lngRaw) {
    var latEmpty = String(latRaw == null ? '' : latRaw).trim() === '';
    var lngEmpty = String(lngRaw == null ? '' : lngRaw).trim() === '';
    if (latEmpty && lngEmpty) return { lat: null, lng: null };
    var lat = parseCoord(latRaw);
    var lng = parseCoord(lngRaw);
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { error: 'Enter both latitude (−90 to 90) and longitude (−180 to 180), or leave both blank. Zero is a valid coordinate.' };
    }
    return { lat: lat, lng: lng };
  }

  function readElevation(raw) {
    if (String(raw == null ? '' : raw).trim() === '') return { value: null };
    var value = parseElevation(raw);
    if (value == null) {
      return { error: 'Elevation gain must be a number from 0 to 20000 metres, or left blank.' };
    }
    return { value: value };
  }

  function formatNumberInput(value) {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  }

  function hasCoords(entry) {
    return !!entry && Number.isFinite(entry.lat) && Number.isFinite(entry.lng);
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    var rad = Math.PI / 180;
    var p1 = lat1 * rad;
    var p2 = lat2 * rad;
    var dLat = (lat2 - lat1) * rad;
    var dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    return EARTH_RADIUS_M * c;
  }

  function loggedInArea(log, area) {
    if (!hasCoords(log) || !area) return false;
    return distanceMeters(log.lat, log.lng, area.lat, area.lng) < area.radius;
  }

  function normalizeType(value) {
    var text = cleanText(value, LIMITS.type);
    if (!text) return ACTIVITY_TYPES[0];
    return text;
  }

  function pairCoords(latRaw, lngRaw) {
    var lat = parseCoord(latRaw);
    var lng = parseCoord(lngRaw);
    if (lat == null || lng == null) return { lat: null, lng: null };
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { lat: null, lng: null };
    return { lat: lat, lng: lng };
  }

  var KINDS = ['peak', 'route', 'hike'];

  var ACTIVITIES = [
    { id: 'sport', label: 'Sport', gradeHint: 'French grade, e.g. 6b' },
    { id: 'trad', label: 'Trad', gradeHint: 'Grade, e.g. 6a or HVS' },
    { id: 'bouldering', label: 'Bouldering', gradeHint: 'Font grade, e.g. 6B+' },
    { id: 'alpine', label: 'Alpine', gradeHint: 'Alpine grade, e.g. PD, AD+' },
    { id: 'ice', label: 'Ice', gradeHint: 'Ice grade, e.g. WI4' },
    { id: 'mixed', label: 'Mixed', gradeHint: 'Mixed grade, e.g. M6' },
    { id: 'ski', label: 'Ski', gradeHint: 'Optional, e.g. S3' }
  ];

  // Offline catalogue. Overpass can add peaks for the current map view.
  var FAMOUS = [
    { name: 'Tour du Mont Blanc', kind: 'hike', lat: 45.923, lng: 6.869, area: 'Alps', note: 'UTMB loop around Mont Blanc' },
    { name: 'Tour du Mont Rose', kind: 'hike', lat: 45.937, lng: 7.868, area: 'Alps', note: 'Tour of Monte Rosa' },
    { name: 'Haute Randonnée Pyrénéenne', kind: 'hike', lat: 42.7, lng: 0.65, area: 'Pyrenees', note: 'HRP, high route across the Pyrenees' },
    { name: 'GR5', kind: 'hike', lat: 46.2, lng: 6.9, area: 'Alps', note: 'Long GR through the western Alps' },
    { name: 'GR20', kind: 'hike', lat: 42.25, lng: 9.05, area: 'Corsica', note: 'High route across Corsica' },
    { name: 'Mont Blanc', kind: 'peak', lat: 45.8326, lng: 6.8652, elevation: 4808, area: 'Alps', note: 'Highest peak in the Alps' },
    { name: 'Matterhorn', kind: 'peak', lat: 45.9763, lng: 7.6586, elevation: 4478, area: 'Alps', note: 'Cervino, Pennine Alps' },
    { name: 'Gran Paradiso', kind: 'peak', lat: 45.518, lng: 7.267, elevation: 4061, area: 'Alps', note: 'Highest peak entirely in Italy' }
  ];

  function inferKind(raw) {
    if (raw.kind === 'peak' || raw.kind === 'route' || raw.kind === 'hike') return raw.kind;
    var type = typeof raw.type === 'string' ? raw.type : '';
    if (/sport|trad|ice|mixed|boulder/i.test(type)) return 'route';
    if (/ski/i.test(type)) return 'hike';
    return 'peak';
  }

  function inferActivity(raw, kind) {
    if (kind !== 'route') return '';
    var known = false;
    ACTIVITIES.forEach(function (item) { if (item.id === raw.activity) known = true; });
    if (known) return raw.activity;
    var type = String(raw.type || '') + ' ' + String(raw.activity || '');
    if (/boulder/i.test(type)) return 'bouldering';
    if (/mixed/i.test(type)) return 'mixed';
    if (/ice/i.test(type)) return 'ice';
    if (/alpine/i.test(type)) return 'alpine';
    if (/ski/i.test(type)) return 'ski';
    if (/trad/i.test(type) && !/sport/i.test(type)) return 'trad';
    return 'sport';
  }

  function gradeHint(activity) {
    var hint = 'Grade';
    ACTIVITIES.forEach(function (item) {
      if (item.id === activity) hint = item.gradeHint;
    });
    return hint;
  }

  function parseDistance(value) {
    if (value == null || typeof value === 'boolean') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    var n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n) || n < 0 || n > 5000) return null;
    return Math.round(n * 10) / 10;
  }

  function cleanCollectionId(value) {
    if (typeof value !== 'string') return '';
    var text = value.trim().toLowerCase();
    return /^[a-z0-9-]{1,48}$/.test(text) ? text : '';
  }

  function parseIdList(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    value.forEach(function (id) {
      if (typeof id !== 'string' && typeof id !== 'number') return;
      var text = String(id).trim().toLowerCase();
      if (!isUuid(text) || out.indexOf(text) >= 0) return;
      out.push(text);
    });
    return out.slice(0, 12);
  }

  function logFields(raw) {
    if (!isPlainObject(raw)) return null;
    var name = cleanText(raw.name, LIMITS.name);
    if (!name) return null;
    var coords = pairCoords(raw.lat, raw.lng);
    var kind = inferKind(raw);
    return {
      id: raw.id,
      kind: kind,
      name: name,
      activity: inferActivity(raw, kind),
      date: parseDate(typeof raw.date === 'string' ? raw.date : ''),
      elevation: parseElevation(raw.elevation),
      distance: kind === 'hike' ? parseDistance(raw.distance) : null,
      grade: kind === 'route' ? cleanText(raw.grade, 40) : '',
      crag: kind === 'route' ? cleanText(raw.crag, 120) : '',
      track: kind === 'hike' ? cleanText(raw.track, 500) : '',
      peakIds: kind === 'peak' ? [] : parseIdList(raw.peakIds),
      notes: cleanText(raw.notes, LIMITS.notes),
      lat: coords.lat,
      lng: coords.lng,
      collectionId: cleanCollectionId(raw.collectionId),
      status: raw.status === 'planned' ? 'planned' : 'done',
      priority: raw.status === 'planned' ? parsePriority(raw.priority) : null,
      season: cleanSeason(raw.season),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt
    };
  }

  var SEASONS = { winter: true, spring: true, summer: true, autumn: true };

  function cleanSeason(value) {
    var text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SEASONS[text] ? text : '';
  }

  function parsePriority(value) {
    if (value == null || value === '') return null;
    var n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
    return Math.round(n);
  }

  function withStatus(raw, status, priority) {
    return Object.assign({}, raw, {
      status: status,
      priority: status === 'planned' ? priority : null,
      season: raw && raw.season || ''
    });
  }

  function postFields(raw) {
    if (!isPlainObject(raw)) return null;
    var objective = cleanText(raw.objective, LIMITS.objective);
    if (!objective) return null;
    var itemId = typeof raw.itemId === 'string' && isUuid(raw.itemId.trim().toLowerCase())
      ? raw.itemId.trim().toLowerCase()
      : '';
    return {
      id: raw.id,
      objective: objective,
      dates: cleanText(raw.dates, LIMITS.dates) || 'Flexible',
      looking: cleanText(raw.looking, LIMITS.looking),
      shared: cleanText(raw.shared, LIMITS.shared),
      itemId: itemId,
      attachedIds: parseIdList(raw.attachedIds),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt
    };
  }

  function normalizeLog(raw, context) {
    var fields = logFields(raw);
    if (!fields) return null;
    return applyIdentity(fields, context, 'keep');
  }

  function normalizePost(raw, context) {
    var fields = postFields(raw);
    if (!fields) return null;
    return applyIdentity(fields, context, 'keep');
  }

  function createLog(fields, context) {
    var base = logFields(Object.assign({}, fields, { id: '', createdAt: '', updatedAt: '' }));
    if (!base) return null;
    return applyIdentity(base, context, 'create');
  }

  function updateLog(previous, fields, context) {
    if (!previous) return createLog(fields, context);
    var base = logFields(Object.assign({}, previous, fields, {
      id: previous.id,
      createdAt: previous.createdAt
    }));
    if (!base) return null;
    return applyIdentity(base, context, 'update');
  }

  function createPost(fields, context) {
    var base = postFields(Object.assign({}, fields, { id: '', createdAt: '', updatedAt: '' }));
    if (!base) return null;
    return applyIdentity(base, context, 'create');
  }

  function uniqueIds(items, context) {
    var ctx = identityContext(context);
    var seen = {};
    return items.map(function (item) {
      var copy = Object.assign({}, item);
      while (!isUuid(copy.id) || seen[copy.id]) copy.id = ctx.mint();
      copy.id = copy.id.toLowerCase();
      seen[copy.id] = true;
      return copy;
    });
  }

  function migrateLogs(items, context) {
    var ctx = identityContext(context);
    var list = Array.isArray(items) ? items : [];
    return uniqueIds(list.map(function (raw) { return normalizeLog(raw, ctx); }).filter(Boolean), ctx);
  }

  function migratePosts(items, context) {
    var ctx = identityContext(context);
    var list = Array.isArray(items) ? items : [];
    return uniqueIds(list.map(function (raw) { return normalizePost(raw, ctx); }).filter(Boolean), ctx);
  }

  function isPeak(entry) {
    return !!entry && entry.kind === 'peak';
  }

  function computeStats(logs) {
    var list = Array.isArray(logs) ? logs : [];
    var peaks = 0;
    var routes = 0;
    var hikes = 0;
    list.forEach(function (log) {
      if (!log) return;
      if (log.kind === 'peak') peaks += 1;
      else if (log.kind === 'route') routes += 1;
      else if (log.kind === 'hike') hikes += 1;
    });
    return { peaks: peaks, routes: routes, hikes: hikes, entries: list.length };
  }

  // Move a backlog item onto the log. Linked backlog peaks are logged too.
  function completeItem(item, logs, backlog, context) {
    var ctx = identityContext(context);
    var done = updateLog(item, { date: item.date || todayISO(), status: 'done', priority: null }, ctx);
    var nextLogs = (logs || []).slice();
    var nextBacklog = (backlog || []).filter(function (entry) { return entry.id !== item.id; });
    nextLogs.push(done);
    (item.peakIds || []).forEach(function (peakId) {
      var peak = null;
      nextBacklog.forEach(function (entry) {
        if (entry.id === peakId && entry.kind === 'peak') peak = entry;
      });
      if (!peak) return;
      nextBacklog = nextBacklog.filter(function (entry) { return entry.id !== peakId; });
      nextLogs.push(updateLog(peak, { date: peak.date || done.date, status: 'done', priority: null }, ctx));
    });
    return { logs: nextLogs, backlog: nextBacklog };
  }

  // One list. Planned items keep the order they were stored in; done items stay done.
  function unifyLists(logs, backlog, context) {
    var ctx = identityContext(context);
    var done = (logs || []).map(function (item) {
      return normalizeLog(withStatus(item, 'done', null), ctx);
    }).filter(Boolean);
    var planned = (backlog || []).map(function (item, index, arr) {
      var priority = parsePriority(item.priority);
      if (priority == null) priority = arr.length - 1 - index;
      return normalizeLog(withStatus(item, 'planned', priority), ctx);
    }).filter(Boolean);
    return uniqueIds(done.concat(planned), ctx);
  }

  function migrateItems(items, context) {
    var ctx = identityContext(context);
    var list = Array.isArray(items) ? items : [];
    return uniqueIds(list.map(function (raw) { return normalizeLog(raw, ctx); }).filter(Boolean), ctx);
  }

  function plannedOrder(items) {
    return (items || []).filter(function (item) { return item && item.status === 'planned'; }).slice().sort(function (a, b) {
      var priority = (a.priority == null ? 100000 : a.priority) - (b.priority == null ? 100000 : b.priority);
      if (priority) return priority;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
  }

  function doneOrder(items) {
    return (items || []).filter(function (item) { return item && item.status !== 'planned'; }).slice().sort(function (a, b) {
      var byDate = String(b.date || '').localeCompare(String(a.date || ''));
      if (byDate) return byDate;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  function markDone(items, id, fields, context) {
    var ctx = identityContext(context);
    var list = (items || []).slice();
    var index = -1;
    list.forEach(function (item, i) { if (item && item.id === id) index = i; });
    if (index < 0) return list;
    var item = list[index];
    var note = fields && Object.prototype.hasOwnProperty.call(fields, 'notes') ? fields.notes : item.notes;
    var done = updateLog(item, {
      status: 'done',
      priority: null,
      date: (fields && fields.date) || item.date || todayISO(),
      notes: note
    }, ctx);
    list[index] = done;
    (item.peakIds || []).forEach(function (peakId) {
      var peakIndex = -1;
      list.forEach(function (entry, i) {
        if (entry && entry.id === peakId && entry.status === 'planned' && entry.kind === 'peak') peakIndex = i;
      });
      if (peakIndex < 0) return;
      list[peakIndex] = updateLog(list[peakIndex], { status: 'done', priority: null, date: done.date }, ctx);
    });
    return list;
  }

  function reorderPlanned(items, orderedIds, context) {
    var ctx = identityContext(context);
    var rank = {};
    (orderedIds || []).forEach(function (id, index) { rank[id] = index; });
    return (items || []).map(function (item) {
      if (!item || !Object.prototype.hasOwnProperty.call(rank, item.id)) return item;
      if (item.priority === rank[item.id]) return item;
      return Object.assign({}, item, { priority: rank[item.id], updatedAt: ctx.now });
    });
  }

  function prepareImport(data, context) {
    if (!isPlainObject(data)) throw new Error('File must be a SummitLog export object.');
    var hasLogs = Object.prototype.hasOwnProperty.call(data, 'logs');
    var hasPosts = Object.prototype.hasOwnProperty.call(data, 'partnerPosts');
    if (!hasLogs && !hasPosts) throw new Error('File has no logs or partner posts.');
    if (hasLogs && !Array.isArray(data.logs)) throw new Error('logs must be an array.');
    if (hasPosts && !Array.isArray(data.partnerPosts)) throw new Error('partnerPosts must be an array.');

    var rawLogs = hasLogs ? data.logs : [];
    var rawPosts = hasPosts ? data.partnerPosts : [];
    if (rawLogs.length > LIMITS.maxLogs || rawPosts.length > LIMITS.maxPosts) {
      throw new Error('File is too large to import.');
    }

    var ctx = identityContext(context);
    var logs = [];
    var skippedLogs = 0;
    rawLogs.forEach(function (raw) {
      var entry = normalizeLog(raw, ctx);
      if (!entry) skippedLogs += 1;
      else logs.push(entry);
    });
    if (hasLogs && rawLogs.length > 0 && logs.length === 0) {
      throw new Error('No valid log entries found in that file.');
    }

    var posts = [];
    var skippedPosts = 0;
    rawPosts.forEach(function (raw) {
      var post = normalizePost(raw, ctx);
      if (!post) skippedPosts += 1;
      else posts.push(post);
    });
    if (hasPosts && rawPosts.length > 0 && posts.length === 0) {
      throw new Error('No valid partner posts found in that file.');
    }

    return {
      logs: uniqueIds(logs, ctx),
      partnerPosts: uniqueIds(posts, ctx),
      replaceLogs: hasLogs,
      replacePosts: hasPosts,
      skippedLogs: skippedLogs,
      skippedPosts: skippedPosts
    };
  }

  function summarizeImport(result) {
    var parts = [];
    if (result.replaceLogs) parts.push(result.logs.length + ' log entries');
    if (result.replacePosts) parts.push(result.partnerPosts.length + ' partner posts');
    var msg = 'Imported ' + parts.join(' and ') + '.';
    var skipped = result.skippedLogs + result.skippedPosts;
    if (skipped) msg += ' Skipped ' + skipped + ' invalid record' + (skipped === 1 ? '' : 's') + '.';
    return msg;
  }

  function parseStoredArray(text) {
    if (text == null || text === '') return { ok: true, items: [] };
    try {
      var parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return { ok: false, items: [] };
      return { ok: true, items: parsed };
    } catch (err) {
      return { ok: false, items: [] };
    }
  }

  function todayISO(date) {
    var d = date || new Date();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    return d.getFullYear() + '-' + m + '-' + day;
  }

  return {
    ACTIVITY_TYPES: ACTIVITY_TYPES,
    PEAK_TYPES: PEAK_TYPES,
    SAMPLE_LOGS: SAMPLE_LOGS,
    KINDS: KINDS,
    ACTIVITIES: ACTIVITIES,
    FAMOUS: FAMOUS,
    LIMITS: LIMITS,
    isUuid: isUuid,
    mintId: mintId,
    parseCoord: parseCoord,
    parseElevation: parseElevation,
    readCoordPair: readCoordPair,
    readElevation: readElevation,
    formatNumberInput: formatNumberInput,
    hasCoords: hasCoords,
    distanceMeters: distanceMeters,
    loggedInArea: loggedInArea,
    normalizeLog: normalizeLog,
    normalizePost: normalizePost,
    createLog: createLog,
    updateLog: updateLog,
    createPost: createPost,
    migrateLogs: migrateLogs,
    migratePosts: migratePosts,
    SCHEMA_VERSION: 2,
    unifyLists: unifyLists,
    migrateItems: migrateItems,
    plannedOrder: plannedOrder,
    doneOrder: doneOrder,
    markDone: markDone,
    reorderPlanned: reorderPlanned,
    uniqueIds: uniqueIds,
    isPeak: isPeak,
    gradeHint: gradeHint,
    computeStats: computeStats,
    completeItem: completeItem,
    prepareImport: prepareImport,
    summarizeImport: summarizeImport,
    parseStoredArray: parseStoredArray,
    todayISO: todayISO
  };
});
