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

  function logFields(raw) {
    if (!isPlainObject(raw)) return null;
    var name = cleanText(raw.name, LIMITS.name);
    if (!name) return null;
    var coords = pairCoords(raw.lat, raw.lng);
    return {
      id: raw.id,
      name: name,
      type: normalizeType(raw.type),
      date: parseDate(typeof raw.date === 'string' ? raw.date : ''),
      elevation: parseElevation(raw.elevation),
      notes: cleanText(raw.notes, LIMITS.notes),
      lat: coords.lat,
      lng: coords.lng,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt
    };
  }

  function postFields(raw) {
    if (!isPlainObject(raw)) return null;
    var objective = cleanText(raw.objective, LIMITS.objective);
    if (!objective) return null;
    return {
      id: raw.id,
      objective: objective,
      dates: cleanText(raw.dates, LIMITS.dates) || 'Flexible',
      looking: cleanText(raw.looking, LIMITS.looking),
      shared: cleanText(raw.shared, LIMITS.shared),
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
    return !!entry && PEAK_TYPES[entry.type] === true;
  }

  function computeStats(logs) {
    var list = Array.isArray(logs) ? logs : [];
    var dates = {};
    var trips = 0;
    var elevation = 0;
    var peaks = 0;
    list.forEach(function (log) {
      if (!log) return;
      if (isPeak(log)) peaks += 1;
      if (Number.isFinite(log.elevation)) elevation += log.elevation;
      if (typeof log.date === 'string' && log.date && !dates[log.date]) {
        dates[log.date] = true;
        trips += 1;
      }
    });
    return { peaks: peaks, elevation: elevation, trips: trips, entries: list.length };
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
    uniqueIds: uniqueIds,
    isPeak: isPeak,
    computeStats: computeStats,
    prepareImport: prepareImport,
    summarizeImport: summarizeImport,
    parseStoredArray: parseStoredArray,
    todayISO: todayISO
  };
});
