// SummitLog — log, map areas, and optional local display name. Text is rendered as text.
var Lgc = window.SummitLogLogic;
var Store = window.SummitLogStorage;

var logs = [];
var partnerPosts = [];
var currentUser = '';
var map;
var markers = [];
var areaLayers = [];
var editingId = null;
var deferredInstall = null;

var areas = [
  { name: 'Mont Blanc Massif', type: 'Mountain range', lat: 45.8326, lng: 6.8652, radius: 18000 },
  { name: 'Matterhorn area', type: 'Mountain range', lat: 45.9763, lng: 7.6586, radius: 12000 },
  { name: 'Fontainebleau', type: 'Bouldering', lat: 48.404, lng: 2.7, radius: 15000 },
  { name: 'Alps (central)', type: 'Mountain range', lat: 46.5, lng: 9.5, radius: 80000 }
];

var suggestions = [
  { name: 'Aiguille du Midi', type: 'Alpine', elev: 3842, reason: 'Popular high-altitude start' },
  { name: 'Gran Paradiso', type: 'Alpine', elev: 4061, reason: 'Classic 4000er, often quieter' },
  { name: 'Piz Bernina', type: 'Alpine', elev: 4049, reason: 'Technical options nearby' },
  { name: 'Local sport crag', type: 'Sport', elev: 0, reason: 'Matches recent climbing logs' }
];

function el(tag, props) {
  var node = document.createElement(tag);
  var children = Array.prototype.slice.call(arguments, 2);
  if (props) {
    Object.keys(props).forEach(function (key) {
      var value = props[key];
      if (value == null || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else node.setAttribute(key, String(value));
    });
  }
  children.forEach(function (child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (nested) {
        if (nested) node.appendChild(nested);
      });
      return;
    }
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

function saveLogs() { logs = Store.saveLogs(logs); }
function savePosts() { partnerPosts = Store.savePosts(partnerPosts); }

function refreshAccountButton() {
  var button = document.getElementById('logout-btn');
  document.getElementById('user-display').textContent = currentUser || '';
  if (!button) return;
  button.textContent = currentUser ? 'Log out' : 'Sign in';
}

logs = Store.loadLogs();
partnerPosts = Store.loadPosts();
currentUser = Store.getDisplayName();

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {
    // file:// and some private modes cannot install a worker. The page still runs.
  });
}

function updateOfflineBanner() {
  var banner = document.getElementById('offline-banner');
  if (!banner) return;
  banner.classList.toggle('hidden', navigator.onLine);
}

function redrawTiles() {
  if (!map) return;
  map.eachLayer(function (layer) {
    if (typeof layer.redraw === 'function' && typeof layer.getTileUrl === 'function') layer.redraw();
  });
}

// ---- Auth ----
function setScreen(mode) {
  var root = document.documentElement;
  root.classList.remove('boot-app', 'show-intro', 'show-login');
  root.classList.add(mode === 'app' ? 'boot-app' : mode === 'login' ? 'show-login' : 'show-intro');
  document.getElementById('intro-screen').classList.toggle('hidden', mode !== 'intro');
  document.getElementById('login-screen').classList.toggle('hidden', mode !== 'login');
  document.getElementById('app').classList.toggle('hidden', mode !== 'app');
}

function showApp() {
  setScreen('app');
  refreshAccountButton();
  updateOfflineBanner();
  initMap();
  renderLogs();
  renderPosts();
  updateSuggestions();
}

function showLogin() {
  setScreen('login');
}

function showIntro(replay) {
  setScreen('intro');
  var back = document.getElementById('intro-back');
  if (back) back.classList.toggle('hidden', !replay);
  ensureIntroArt();
}

document.getElementById('start-logging').addEventListener('click', function () {
  Store.dismissIntro();
  showApp();
  selectTab('log');
});

document.getElementById('intro-back').addEventListener('click', function () {
  showApp();
});

document.getElementById('google-login').addEventListener('click', function () {
  alert('Google login coming soon.\n\nFor now, use any username and password below.');
});

document.getElementById('github-login').addEventListener('click', function () {
  alert('GitHub login coming soon.\n\nFor now, use any username and password below.');
});

document.getElementById('login-btn').addEventListener('click', function () {
  var username = document.getElementById('login-username').value.trim().slice(0, 80);
  // Demo only: the password is not checked and is not stored. The name is a label.
  if (!username) {
    alert('Please enter a username');
    return;
  }
  currentUser = Store.setDisplayName(username);
  showApp();
});

document.getElementById('login-back').addEventListener('click', function () {
  showApp();
});

document.getElementById('login-password').addEventListener('keydown', function (event) {
  if (event.key === 'Enter') document.getElementById('login-btn').click();
});

document.getElementById('logout-btn').addEventListener('click', function () {
  if (!currentUser) {
    showLogin();
    return;
  }
  currentUser = '';
  Store.clearDisplayName();
  refreshAccountButton();
});

// ---- Tabs ----
function selectTab(name) {
  document.querySelectorAll('nav button').forEach(function (item) {
    item.classList.toggle('active', item.dataset.tab === name);
  });
  document.querySelectorAll('.tab').forEach(function (section) {
    section.classList.toggle('hidden', section.id !== name);
  });
  if (name === 'map' && map) setTimeout(function () { map.invalidateSize(); }, 100);
}

document.querySelectorAll('nav button').forEach(function (btn) {
  btn.addEventListener('click', function () { selectTab(btn.dataset.tab); });
});

// ---- Intro cards ----
var introArtLoaded = false;

function ensureIntroArt() {
  if (introArtLoaded) return;
  var slot = document.getElementById('intro-art');
  if (!slot) return;
  var src = slot.getAttribute('data-src') || 'illustrations/mountain.svg';
  fetch(src).then(function (response) {
    if (!response.ok) throw new Error('missing art');
    return response.text();
  }).then(function (text) {
    var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    var svg = doc.querySelector('svg');
    if (!svg || doc.querySelector('parsererror')) return;
    svg.setAttribute('aria-hidden', 'true');
    slot.replaceChildren(document.importNode(svg, true));
    introArtLoaded = true;
  }).catch(function () {
    slot.replaceChildren(el('p', { class: 'muted', text: 'Mountain' }));
  });
}

function introSlides() {
  return Array.prototype.slice.call(document.querySelectorAll('.intro-slide'));
}

function updateIntroDots(index) {
  document.querySelectorAll('.intro-dot').forEach(function (dot, i) {
    var on = i === index;
    dot.classList.toggle('active', on);
    dot.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function activeIntroIndex() {
  var scroller = document.getElementById('intro-cards');
  var slides = introSlides();
  var best = 0;
  var bestDist = Infinity;
  slides.forEach(function (slide, i) {
    var dist = Math.abs(slide.offsetLeft - scroller.scrollLeft);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

function setIntroSlide(index) {
  var scroller = document.getElementById('intro-cards');
  var slides = introSlides();
  if (!slides.length) return;
  var next = (index + slides.length) % slides.length;
  scroller.scrollTo({ left: slides[next].offsetLeft, behavior: 'smooth' });
  updateIntroDots(next);
}

document.getElementById('intro-prev').addEventListener('click', function () {
  setIntroSlide(activeIntroIndex() - 1);
});

document.getElementById('intro-next').addEventListener('click', function () {
  setIntroSlide(activeIntroIndex() + 1);
});

document.getElementById('intro-cards').addEventListener('click', function (event) {
  var slide = event.target.closest ? event.target.closest('.intro-slide') : null;
  if (!slide) return;
  setIntroSlide(introSlides().indexOf(slide));
});

document.getElementById('intro-cards').addEventListener('keydown', function (event) {
  if (event.key === 'ArrowRight') setIntroSlide(activeIntroIndex() + 1);
  if (event.key === 'ArrowLeft') setIntroSlide(activeIntroIndex() - 1);
});

document.querySelectorAll('.intro-dot').forEach(function (dot) {
  dot.addEventListener('click', function () {
    setIntroSlide(Number(dot.getAttribute('data-slide')));
  });
});

document.getElementById('intro-cards').addEventListener('scroll', function () {
  updateIntroDots(activeIntroIndex());
});

document.getElementById('replay-intro').addEventListener('click', function () {
  showIntro(true);
});

// ---- Render logs ----
function renderLogCard(log) {
  var notes = log.notes ? el('p', { class: 'entry-notes', text: log.notes }) : null;
  var elevation = log.elevation == null ? 0 : log.elevation;
  return el('div', { class: 'card' },
    el('h3', { text: log.name }),
    el('span', { class: 'badge', text: log.type }),
    el('p', { class: 'entry-meta', text: (log.date || 'No date') + ' · ' + elevation + ' m' }),
    notes,
    el('div', { class: 'log-actions' },
      el('button', { class: 'secondary', type: 'button', 'data-action': 'edit', 'data-id': log.id, text: 'Edit' }),
      el('button', { class: 'danger', type: 'button', 'data-action': 'delete', 'data-id': log.id, text: 'Delete' })
    )
  );
}

function renderResume() {
  var resume = document.getElementById('resume-summary');
  if (!logs.length) {
    resume.replaceChildren(el('p', { text: 'No activity logged yet.' }));
    return;
  }
  var items = logs.slice(-5).reverse().map(function (log) {
    return el('li', { text: log.name + ' — ' + log.type });
  });
  resume.replaceChildren(
    el('p', { text: 'Recent activity:' }),
    el('ul', { class: 'resume-list' }, items)
  );
}

function renderLogs() {
  var list = document.getElementById('log-list');
  if (!logs.length) list.replaceChildren(el('p', { class: 'muted', text: 'No entries yet.' }));
  else list.replaceChildren.apply(list, logs.slice().reverse().map(renderLogCard));

  var stats = Lgc.computeStats(logs);
  document.getElementById('peak-count').textContent = String(stats.peaks);
  document.getElementById('elev-total').textContent = String(stats.elevation);
  document.getElementById('trip-count').textContent = String(stats.trips);
  renderResume();
  syncAreas();
  updateMapMarkers();
}

function buttonFromEvent(event) {
  var target = event.target instanceof Element ? event.target : event.target.parentElement;
  if (!target) return null;
  var button = target.closest('button[data-action]');
  if (!button || !event.currentTarget.contains(button)) return null;
  return button;
}

document.getElementById('log-list').addEventListener('click', function (event) {
  var button = buttonFromEvent(event);
  if (!button) return;
  var id = button.getAttribute('data-id');
  if (button.getAttribute('data-action') === 'edit') editLog(id);
  if (button.getAttribute('data-action') === 'delete') deleteLog(id);
});

// ---- Form handling ----
var form = document.getElementById('add-form');

function selectType(value) {
  var select = document.getElementById('type');
  Array.prototype.forEach.call(select.querySelectorAll('option[data-custom]'), function (opt) {
    opt.remove();
  });
  var known = Array.prototype.some.call(select.options, function (opt) { return opt.value === value; });
  if (value && !known) {
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    opt.setAttribute('data-custom', '1');
    select.appendChild(opt);
  }
  select.value = value && (known || value) ? value : select.options[0].value;
}

function resetEntryForm() {
  editingId = null;
  document.getElementById('form-title').textContent = 'New entry';
  document.getElementById('name').value = '';
  document.getElementById('notes').value = '';
  document.getElementById('elevation').value = '';
  document.getElementById('lat').value = '';
  document.getElementById('lng').value = '';
  document.getElementById('date').value = Lgc.todayISO();
  selectType(Lgc.ACTIVITY_TYPES[0]);
}

document.getElementById('add-btn').addEventListener('click', function () {
  if (!form.classList.contains('hidden') && !editingId) {
    form.classList.add('hidden');
    return;
  }
  resetEntryForm();
  form.classList.remove('hidden');
});

document.getElementById('save-btn').addEventListener('click', function () {
  var coords = Lgc.readCoordPair(
    document.getElementById('lat').value,
    document.getElementById('lng').value
  );
  if (coords.error) return alert(coords.error);
  var elevation = Lgc.readElevation(document.getElementById('elevation').value);
  if (elevation.error) return alert(elevation.error);

  var fields = {
    name: document.getElementById('name').value,
    type: document.getElementById('type').value,
    date: document.getElementById('date').value,
    elevation: elevation.value,
    notes: document.getElementById('notes').value,
    lat: coords.lat,
    lng: coords.lng
  };
  var entry;
  if (editingId) {
    var previous = logs.find(function (log) { return log.id === editingId; });
    entry = previous ? Lgc.updateLog(previous, fields) : Lgc.createLog(fields);
  } else {
    entry = Lgc.createLog(fields);
  }
  if (!entry) return alert('Name is required');

  if (editingId) {
    var idx = logs.findIndex(function (log) { return log.id === editingId; });
    if (idx >= 0) logs[idx] = entry;
    else logs.push(entry);
  } else {
    logs.push(entry);
  }

  saveLogs();
  form.classList.add('hidden');
  editingId = null;
  renderLogs();
});

function editLog(id) {
  var log = logs.find(function (item) { return item.id === id; });
  if (!log) return;
  editingId = log.id;
  document.getElementById('form-title').textContent = 'Edit entry';
  document.getElementById('name').value = log.name;
  selectType(log.type);
  document.getElementById('date').value = log.date || '';
  document.getElementById('elevation').value = Lgc.formatNumberInput(log.elevation);
  document.getElementById('notes').value = log.notes || '';
  document.getElementById('lat').value = Lgc.formatNumberInput(log.lat);
  document.getElementById('lng').value = Lgc.formatNumberInput(log.lng);
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth' });
}

function deleteLog(id) {
  if (!confirm('Delete this entry?')) return;
  logs = logs.filter(function (log) { return log.id !== id; });
  saveLogs();
  renderLogs();
}

// ---- Map ----
function updateSuggestions() {
  var list = document.getElementById('suggestions-list');
  if (!list) return;
  list.replaceChildren.apply(list, suggestions.map(function (item) {
    var detail = item.reason;
    if (typeof item.elev === 'number' && item.elev > 0) detail = item.elev + ' m · ' + item.reason;
    return el('div', { class: 'suggestion' },
      el('strong', { text: item.name }),
      el('span', { class: 'badge', text: item.type }),
      el('p', { text: detail })
    );
  }));
}

function showMapFallback() {
  var container = document.getElementById('map-container');
  if (!container || container.dataset.fallback === '1') return;
  container.dataset.fallback = '1';
  container.appendChild(el('p', {
    class: 'map-fallback',
    text: 'The map did not load. Your log still works. Open this page once while online so the map can be saved for offline use.'
  }));
}

function areaPopup(area, done) {
  var children = [
    el('strong', { text: (done ? '✓ ' : '') + area.name }),
    el('br'),
    document.createTextNode(area.type)
  ];
  if (done) {
    children.push(el('br'));
    children.push(el('small', { text: 'You’ve logged something here' }));
  }
  return el('div', null, children);
}

function markerPopup(log) {
  return el('div', null,
    el('strong', { text: log.name }),
    el('br'),
    document.createTextNode(log.type || ''),
    el('br'),
    document.createTextNode(log.date || '')
  );
}

function syncAreas() {
  if (!map || typeof L === 'undefined') return;
  if (!areaLayers.length) {
    areas.forEach(function (area) {
      var circle = L.circle([area.lat, area.lng], { radius: area.radius, weight: 2 }).addTo(map);
      areaLayers.push({ area: area, circle: circle });
    });
  }
  areaLayers.forEach(function (layer) {
    var done = logs.some(function (log) { return Lgc.loggedInArea(log, layer.area); });
    var color = done ? '#22c55e' : '#3b82f6';
    layer.circle.setStyle({ color: color, fillColor: color, fillOpacity: 0.15, weight: 2 });
    layer.circle.bindPopup(areaPopup(layer.area, done));
  });
}

function configureMarkerIcons() {
  if (typeof L === 'undefined' || !L.Icon || !L.Icon.Default) return;
  var base = 'https://unpkg.com/leaflet@1.9.4/dist/images/';
  L.Icon.Default.mergeOptions({
    iconUrl: base + 'marker-icon.png',
    iconRetinaUrl: base + 'marker-icon-2x.png',
    shadowUrl: base + 'marker-shadow.png'
  });
}

function initMap() {
  if (typeof L === 'undefined') {
    showMapFallback();
    return;
  }
  try {
    if (!map) {
      configureMarkerIcons();
      map = L.map('map-container').setView([46.5, 8.5], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        errorTileUrl: 'icons/tile-offline.svg'
      }).addTo(map);
      syncAreas();
    }
    updateMapMarkers();
    setTimeout(function () { if (map) map.invalidateSize(); }, 100);
  } catch (err) {
    showMapFallback();
  }
}

function updateMapMarkers() {
  if (!map) return;
  markers.forEach(function (marker) { map.removeLayer(marker); });
  markers = [];
  logs.forEach(function (log) {
    if (!Lgc.hasCoords(log)) return;
    var marker = L.marker([log.lat, log.lng]).addTo(map);
    marker.bindPopup(markerPopup(log));
    markers.push(marker);
  });
}

// ---- Partner posts ----
function renderPostCard(post) {
  return el('div', { class: 'card' },
    el('h3', { text: post.objective }),
    el('p', { class: 'post-meta', text: post.dates }),
    el('p', { class: 'post-looking', text: 'Looking for: ' + (post.looking || '') }),
    el('p', { class: 'post-shared', text: 'Shared context: ' + (post.shared || 'No log summary attached') }),
    el('button', {
      class: 'danger',
      type: 'button',
      'data-action': 'delete',
      'data-id': post.id,
      text: 'Remove'
    })
  );
}

function renderPosts() {
  var container = document.getElementById('partner-posts');
  if (!partnerPosts.length) {
    container.replaceChildren(el('p', { class: 'muted', text: 'No partner posts yet.' }));
    return;
  }
  container.replaceChildren.apply(container, partnerPosts.slice().reverse().map(renderPostCard));
}

document.getElementById('partner-posts').addEventListener('click', function (event) {
  var button = buttonFromEvent(event);
  if (!button || button.getAttribute('data-action') !== 'delete') return;
  deletePost(button.getAttribute('data-id'));
});

document.getElementById('post-btn').addEventListener('click', function () {
  document.getElementById('post-form').classList.toggle('hidden');
});

document.getElementById('save-post-btn').addEventListener('click', function () {
  var recentNames = logs.slice(-3).map(function (log) { return log.name; }).filter(Boolean);
  var post = Lgc.createPost({
    objective: document.getElementById('post-objective').value,
    dates: document.getElementById('post-dates').value,
    looking: document.getElementById('post-looking').value,
    shared: recentNames.length ? 'Recent: ' + recentNames.join(', ') : 'Recent: No recent logs'
  });
  if (!post) return alert('Objective required');
  partnerPosts.push(post);
  savePosts();
  document.getElementById('post-form').classList.add('hidden');
  document.getElementById('post-objective').value = '';
  document.getElementById('post-dates').value = '';
  document.getElementById('post-looking').value = '';
  renderPosts();
});

function deletePost(id) {
  partnerPosts = partnerPosts.filter(function (post) { return post.id !== id; });
  savePosts();
  renderPosts();
}

// ---- Export / Import ----
document.getElementById('export-btn').addEventListener('click', function () {
  var data = { logs: logs, partnerPosts: partnerPosts, exported: new Date().toISOString() };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var link = document.createElement('a');
  var url = URL.createObjectURL(blob);
  link.href = url;
  link.download = 'summitlog-export.json';
  link.click();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
});

document.getElementById('import-btn').addEventListener('click', function () {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', function (event) {
  var file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    alert('That file is too large to import.');
    return;
  }
  var reader = new FileReader();
  reader.onerror = function () { alert('Could not read that file.'); };
  reader.onload = function () {
    var data;
    try {
      data = JSON.parse(String(reader.result));
    } catch (err) {
      alert('That file is not valid JSON.');
      return;
    }
    var result;
    try {
      result = Lgc.prepareImport(data);
    } catch (err) {
      alert(err.message || 'That file could not be imported.');
      return;
    }
    var replacing = (result.replaceLogs && logs.length) || (result.replacePosts && partnerPosts.length);
    if (replacing && !confirm('Replace the data saved in this browser with this file?')) return;
    if (result.replaceLogs) {
      logs = result.logs;
      saveLogs();
    }
    if (result.replacePosts) {
      partnerPosts = result.partnerPosts;
      savePosts();
    }
    renderLogs();
    renderPosts();
    alert(Lgc.summarizeImport(result));
  };
  reader.readAsText(file);
});

// ---- Install ----
window.addEventListener('beforeinstallprompt', function (event) {
  event.preventDefault();
  deferredInstall = event;
  var button = document.getElementById('install-btn');
  if (button) button.classList.remove('hidden');
});

document.getElementById('install-btn').addEventListener('click', function () {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  deferredInstall.userChoice.finally(function () {
    deferredInstall = null;
    document.getElementById('install-btn').classList.add('hidden');
  });
});

window.addEventListener('online', function () {
  updateOfflineBanner();
  redrawTiles();
});
window.addEventListener('offline', updateOfflineBanner);

// ---- Init ----
registerServiceWorker();

document.addEventListener('DOMContentLoaded', function () {
  if (Store.isIntroDismissed()) showApp();
  else showIntro(false);
});
