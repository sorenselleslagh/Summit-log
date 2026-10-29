// App-shell cache plus on-demand map tiles. Paths are relative to this file
// so the same worker works at / and under /Summit-log/ on GitHub Pages.
var VERSION = 'v1';
var SHELL_CACHE = 'summitlog-shell-' + VERSION;
var CDN_CACHE = 'summitlog-cdn-' + VERSION;
var TILE_CACHE = 'summitlog-tiles-' + VERSION;

var SHELL = [
  './',
  './index.html',
  './favicon.ico',
  './style.css',
  './app.js',
  './logic.js',
  './storage.js',
  './overpass.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/tile-offline.svg',
  './illustrations/mountain.svg'
];

var CDN = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
];

var OFFLINE_TILE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">',
  '<rect width="256" height="256" fill="#151c2c"/>',
  '<path d="M16 210 L78 118 L118 164 L156 86 L244 210 Z" fill="#3b82f6" fill-opacity="0.45"/>',
  '<path d="M128 92 L156 86 L168 118 Z" fill="#e2e8f0" fill-opacity="0.85"/>',
  '<text x="128" y="132" text-anchor="middle" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="20" font-weight="600">Offline</text>',
  '<text x="128" y="156" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="13">No saved tile</text>',
  '</svg>'
].join('');

function scopeUrl(path) {
  return new URL(path, self.location).href;
}

function isTile(url) {
  return /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname) && /\.png$/i.test(url.pathname);
}

function offlineTileResponse() {
  return new Response(OFFLINE_TILE_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store'
    }
  });
}

async function putIfCacheable(cache, request, response) {
  if (!response || response.redirected) return;
  if (!(response.ok || response.type === 'opaque')) return;
  try {
    await cache.put(request, response.clone());
  } catch (err) {
    // A redirected or opaque body can reject put. The caller still returns it.
  }
}

async function precacheShell() {
  var cache = await caches.open(SHELL_CACHE);
  await Promise.all(SHELL.map(async function (path) {
    var url = scopeUrl(path);
    var response = await fetch(url, { cache: 'reload' });
    if (!response.ok) throw new Error('Missing app file ' + url);
    await cache.put(url, response);
  }));
}

async function precacheCdn() {
  var cache = await caches.open(CDN_CACHE);
  await Promise.all(CDN.map(async function (url) {
    try {
      var response = await fetch(url, { mode: 'cors', cache: 'reload' });
      if (response.ok) await cache.put(url, response);
    } catch (err) {
      // The page can fill this cache the next time it is online.
    }
  }));
}

self.addEventListener('install', function (event) {
  event.waitUntil(Promise.all([precacheShell(), precacheCdn()]).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (event) {
  var keep = {};
  keep[SHELL_CACHE] = true;
  keep[CDN_CACHE] = true;
  keep[TILE_CACHE] = true;
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (key) {
      if (key.indexOf('summitlog-') === 0 && !keep[key]) return caches.delete(key);
      return Promise.resolve();
    }));
  }).then(function () {
    return self.clients.claim();
  }));
});

async function shellResponse(request) {
  var cache = await caches.open(SHELL_CACHE);
  try {
    var response = await fetch(request);
    await putIfCacheable(cache, request, response);
    return response;
  } catch (err) {
    var cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      var index = await cache.match(scopeUrl('./index.html'));
      if (index) return index;
      var root = await cache.match(scopeUrl('./'));
      if (root) return root;
    }
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function cdnResponse(request) {
  var cache = await caches.open(CDN_CACHE);
  try {
    var response = await fetch(request);
    await putIfCacheable(cache, request, response);
    return response;
  } catch (err) {
    var cached = await cache.match(request);
    if (cached) return cached;
    return new Response('', { status: 503 });
  }
}

async function tileResponse(request) {
  var cache = await caches.open(TILE_CACHE);
  try {
    var response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      await putIfCacheable(cache, request, response);
      return response;
    }
  } catch (err) {
    // Fall through to a previously viewed tile or the placeholder.
  }
  var cached = await cache.match(request);
  if (cached) return cached;
  return offlineTileResponse();
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isTile(url)) {
    event.respondWith(tileResponse(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(shellResponse(request));
    return;
  }
  if (url.hostname === 'unpkg.com') {
    event.respondWith(cdnResponse(request));
  }
});
