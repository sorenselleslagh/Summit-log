// Local persistence boundary. The UI talks to this repository, not localStorage.
// A later account sync can replace createRepository's storage engine and keep
// the same load/save methods. Records use a UUID id plus createdAt/updatedAt.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.SummitLogStorage = api.createRepository({
      storage: root.localStorage,
      logic: root.SummitLogLogic
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LOG_KEY = 'summitlogs';
  var BACKLOG_KEY = 'summitbacklog';
  var POST_KEY = 'partnerposts';
  var CACHE_KEY = 'summitlog_overpass_cache';
  var USER_KEY = 'summitlog_user';
  // Also read once in index.html before paint. This module is the only writer.
  var INTRO_KEY = 'summitlog_intro_seen';
  var LEVEL_KEY = 'summitlog_level';

  function createRepository(options) {
    var storage = options.storage;
    var logic = options.logic;
    var clock = options.now || function () { return new Date().toISOString(); };
    var mint = options.mint || logic.mintId;
    var warned = false;

    function context() {
      return { now: clock(), mint: mint };
    }

    function fail(message) {
      if (!warned && typeof alert === 'function') {
        alert(message);
        warned = true;
      }
      return false;
    }

    function write(key, value) {
      try {
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch (err) {
        return fail('Could not save on this device. Storage may be full or blocked.');
      }
    }

    function readArray(key) {
      var raw;
      try {
        raw = storage.getItem(key);
      } catch (err) {
        return { state: 'unreadable', items: [] };
      }
      if (raw == null || raw === '') return { state: 'missing', items: [] };
      var parsed = logic.parseStoredArray(raw);
      if (!parsed.ok) return { state: 'corrupt', items: [] };
      return { state: 'ok', items: parsed.items };
    }

    function persistMigration(key, original, migrated) {
      if (JSON.stringify(original) !== JSON.stringify(migrated)) write(key, migrated);
      return migrated;
    }

    function loadLogs() {
      var read = readArray(LOG_KEY);
      if (read.state === 'corrupt' || read.state === 'unreadable') return [];
      if (read.state === 'missing' || read.items.length === 0) {
        var seeded = logic.migrateLogs(logic.SAMPLE_LOGS, context());
        write(LOG_KEY, seeded);
        return seeded;
      }
      return persistMigration(LOG_KEY, read.items, logic.migrateLogs(read.items, context()));
    }

    function saveLogs(items) {
      var cleaned = logic.migrateLogs(items, context());
      write(LOG_KEY, cleaned);
      return cleaned;
    }

    function loadBacklog() {
      var read = readArray(BACKLOG_KEY);
      if (read.state !== 'ok') return [];
      return persistMigration(BACKLOG_KEY, read.items, logic.migrateLogs(read.items, context()));
    }

    function saveBacklog(items) {
      var cleaned = logic.migrateLogs(items, context());
      write(BACKLOG_KEY, cleaned);
      return cleaned;
    }

    function readCache(bucket, key) {
      try {
        var all = JSON.parse(storage.getItem(CACHE_KEY) || '{}');
        var entry = all[bucket] && all[bucket][key];
        return entry ? entry.value : null;
      } catch (err) {
        return null;
      }
    }

    function writeCache(bucket, key, value) {
      var all = {};
      try { all = JSON.parse(storage.getItem(CACHE_KEY) || '{}'); } catch (err) { all = {}; }
      if (!all[bucket] || typeof all[bucket] !== 'object') all[bucket] = {};
      var keys = Object.keys(all[bucket]);
      if (keys.length > 6) delete all[bucket][keys[0]];
      all[bucket][key] = { value: value };
      try { storage.setItem(CACHE_KEY, JSON.stringify(all)); } catch (err) { return false; }
      return true;
    }

    function loadPosts() {
      var read = readArray(POST_KEY);
      if (read.state === 'missing') return [];
      if (read.state !== 'ok') return [];
      return persistMigration(POST_KEY, read.items, logic.migratePosts(read.items, context()));
    }

    function savePosts(items) {
      var cleaned = logic.migratePosts(items, context());
      write(POST_KEY, cleaned);
      return cleaned;
    }

    function getDisplayName() {
      var name;
      try {
        name = storage.getItem(USER_KEY);
      } catch (err) {
        return '';
      }
      if (!name) return '';
      return String(name).trim().slice(0, 80);
    }

    function setDisplayName(name) {
      var clean = String(name || '').trim().slice(0, 80);
      if (!clean) return '';
      try {
        storage.setItem(USER_KEY, clean);
      } catch (err) {
        fail('Could not save the name on this device. Storage may be full or blocked.');
      }
      return clean;
    }

    function clearDisplayName() {
      try {
        storage.removeItem(USER_KEY);
      } catch (err) {
        fail('Could not update the name stored on this device.');
      }
    }

    function getLevel() {
      try {
        var raw = storage.getItem(LEVEL_KEY);
        if (!raw) return null;
        var data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : null;
      } catch (err) {
        return null;
      }
    }

    function setLevel(level) {
      try {
        storage.setItem(LEVEL_KEY, JSON.stringify(level));
        return true;
      } catch (err) {
        fail('Could not save on this device. Storage may be full or blocked.');
        return false;
      }
    }

    function isIntroDismissed() {
      try {
        return storage.getItem(INTRO_KEY) === '1';
      } catch (err) {
        return false;
      }
    }

    function dismissIntro() {
      try {
        storage.setItem(INTRO_KEY, '1');
        return true;
      } catch (err) {
        fail('Could not save on this device. Storage may be full or blocked.');
        return false;
      }
    }

    return {
      loadLogs: loadLogs,
      saveLogs: saveLogs,
      loadBacklog: loadBacklog,
      saveBacklog: saveBacklog,
      readCache: readCache,
      writeCache: writeCache,
      loadPosts: loadPosts,
      savePosts: savePosts,
      getDisplayName: getDisplayName,
      setDisplayName: setDisplayName,
      clearDisplayName: clearDisplayName,
      getLevel: getLevel,
      setLevel: setLevel,
      isIntroDismissed: isIntroDismissed,
      dismissIntro: dismissIntro
    };
  }

  return { createRepository: createRepository };
});
