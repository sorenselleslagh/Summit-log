// Photos stay in IndexedDB, not localStorage. Each image is a JPEG blob
// already downscaled by the page. Records are { id, itemId, createdAt, blob }.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SummitPhotos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DB_NAME = 'summitlog';
  var STORE = 'photos';
  var owner = '';

  function avatarId() {
    return owner ? 'profile-avatar:' + owner : 'profile-avatar';
  }

  function scopedItem(itemId) {
    return owner ? owner + ':' + itemId : itemId;
  }

  function setOwner(userId) {
    var next = userId ? String(userId) : '';
    if (next === owner) return;
    var previous = owner;
    owner = next;
    if (!next || previous) return;
    getRecord('profile-avatar').then(function (row) {
      if (!row || !row.blob) return;
      return getRecord(avatarId()).then(function (existing) {
        if (existing) return null;
        return putRecord({ id: avatarId(), itemId: avatarId(), createdAt: row.createdAt, blob: row.blob });
      });
    }).catch(function () {});
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function list(itemId) {
    var scoped = scopedItem(itemId);
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var request = tx.objectStore(STORE).getAll();
        request.onsuccess = function () {
          var rows = (request.result || []).filter(function (row) {
            return row.itemId === scoped || (!owner && row.itemId === itemId);
          });
          rows.sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
          resolve(rows);
        };
        request.onerror = function () { reject(request.error); };
      });
    }).catch(function () { return []; });
  }

  function add(itemId, blob) {
    if (!itemId || !blob) return Promise.resolve(null);
    var storedId = scopedItem(itemId);
    var record = {
      id: storedId + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      itemId: storedId,
      createdAt: new Date().toISOString(),
      blob: blob
    };
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = function () { resolve(record); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getRecord(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function putRecord(record) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = function () { resolve(record); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getAvatar() {
    return getRecord(avatarId()).catch(function () { return null; });
  }

  function setAvatar(blob) {
    if (!blob) return Promise.resolve(null);
    var id = avatarId();
    return putRecord({ id: id, itemId: id, createdAt: new Date().toISOString(), blob: blob });
  }

  return { list: list, add: add, getAvatar: getAvatar, setAvatar: setAvatar, setOwner: setOwner };
});
