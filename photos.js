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
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var request = tx.objectStore(STORE).getAll();
        request.onsuccess = function () {
          var rows = (request.result || []).filter(function (row) { return row.itemId === itemId; });
          rows.sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
          resolve(rows);
        };
        request.onerror = function () { reject(request.error); };
      });
    }).catch(function () { return []; });
  }

  function add(itemId, blob) {
    if (!itemId || !blob) return Promise.resolve(null);
    var record = {
      id: itemId + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      itemId: itemId,
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

  function getAvatar() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction(STORE, 'readonly').objectStore(STORE).get('profile-avatar');
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error); };
      });
    }).catch(function () { return null; });
  }

  function setAvatar(blob) {
    if (!blob) return Promise.resolve(null);
    var record = { id: 'profile-avatar', itemId: 'profile-avatar', createdAt: new Date().toISOString(), blob: blob };
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = function () { resolve(record); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  return { list: list, add: add, getAvatar: getAvatar, setAvatar: setAvatar };
});
