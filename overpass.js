// Small Overpass helper. Fetches only when the user asks, and only a short peak list.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SummitLogOverpass = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MIN_ZOOM = 10;
  var MIN_GAP_MS = 8000;
  var lastAt = 0;

  function bboxKey(bounds) {
    function round(value) { return Math.round(value * 50) / 50; }
    return [round(bounds.south), round(bounds.west), round(bounds.north), round(bounds.east)].join(',');
  }

  function buildQuery(bounds) {
    var box = [bounds.south, bounds.west, bounds.north, bounds.east].map(function (value) {
      return Number(value).toFixed(4);
    }).join(',');
    return '[out:json][timeout:12];node["natural"="peak"](' + box + ');out tags 25;';
  }

  function canFetch(zoom, now) {
    if (zoom < MIN_ZOOM) return { ok: false, reason: 'Zoom in to load peaks for this area.' };
    if (lastAt && now - lastAt < MIN_GAP_MS) return { ok: false, reason: 'Please wait a moment before asking OpenStreetMap again.' };
    return { ok: true };
  }

  function noteRequest(now) { lastAt = now; }

  function parseElements(data) {
    if (!data || !Array.isArray(data.elements)) return [];
    var peaks = [];
    data.elements.forEach(function (element) {
      if (!element || element.type !== 'node' || !element.tags || !element.tags.name) return;
      if (typeof element.lat !== 'number' || typeof element.lon !== 'number') return;
      var elevation = null;
      if (element.tags.ele != null) {
        var parsed = Number(String(element.tags.ele).replace(/[^\d.]/g, ''));
        if (Number.isFinite(parsed)) elevation = parsed;
      }
      peaks.push({
        name: String(element.tags.name).slice(0, 200),
        kind: 'peak',
        lat: element.lat,
        lng: element.lon,
        elevation: elevation,
        note: 'OpenStreetMap peak',
        source: 'openstreetmap'
      });
    });
    return peaks.slice(0, 25);
  }

  return {
    MIN_ZOOM: MIN_ZOOM,
    bboxKey: bboxKey,
    buildQuery: buildQuery,
    canFetch: canFetch,
    noteRequest: noteRequest,
    parseElements: parseElements
  };
});
