// SummitLog — log, map areas, and optional local display name. Text is rendered as text.
var Lgc = window.SummitLogLogic;
var Store = window.SummitLogStorage;
var Over = window.SummitLogOverpass;

var logs = [];
var backlog = [];
var partnerPosts = [];
var currentUser = '';
var map;
var markers = [];
var areaLayers = [];
var osmMarkers = [];
var editingId = null;
var editingList = 'log';
var postingItemId = '';
var deferredInstall = null;

var areas = [
  { name: 'Mont Blanc Massif', type: 'Mountain range', lat: 45.8326, lng: 6.8652, radius: 18000 },
  { name: 'Matterhorn area', type: 'Mountain range', lat: 45.9763, lng: 7.6586, radius: 12000 },
  { name: 'Fontainebleau', type: 'Bouldering', lat: 48.404, lng: 2.7, radius: 15000 },
  { name: 'Alps (central)', type: 'Mountain range', lat: 46.5, lng: 9.5, radius: 80000 }
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
function saveBacklog() { backlog = Store.saveBacklog(backlog); }
function savePosts() { partnerPosts = Store.savePosts(partnerPosts); }

function refreshAccountButton() {
  var button = document.getElementById('logout-btn');
  document.getElementById('user-display').textContent = currentUser || '';
  if (!button) return;
  button.textContent = currentUser ? 'Log out' : 'Sign in';
}

logs = Store.loadLogs();
backlog = Store.loadBacklog();
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
  renderBacklog();
  renderPosts();
  renderFamous();
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

document.getElementById('profile-btn').addEventListener('click', function () {
  selectTab('profile');
});

document.getElementById('connections').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('button[data-connect]') : null;
  if (!button) return;
  alert(button.getAttribute('data-connect') + ' is coming soon and requires an account.');
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
  if (name !== 'log' && name !== 'backlog' && form) form.classList.add('hidden');
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

// ---- Items ----
function kindLabel(kind) {
  if (kind === 'route') return 'Route';
  if (kind === 'hike') return 'Hike';
  return 'Peak';
}

function itemSummary(item) {
  if (item.kind === 'route') {
    var bits = [item.activity || 'route'];
    if (item.grade) bits.push(item.grade);
    if (item.crag) bits.push(item.crag);
    return bits.join(' · ');
  }
  if (item.kind === 'hike') {
    var hike = [];
    if (item.distance != null) hike.push(item.distance + ' km');
    if (item.elevation != null) hike.push(item.elevation + ' m gain');
    if (item.track) hike.push(item.track);
    return hike.join(' · ') || 'Hike';
  }
  var peak = [];
  if (item.elevation != null) peak.push(item.elevation + ' m');
  if (item.date) peak.push(item.date);
  return peak.join(' · ') || 'Peak';
}

function renderItemCard(item, listName) {
  var notes = item.notes ? el('p', { class: 'entry-notes', text: item.notes }) : null;
  var actions = [
    el('button', { class: 'secondary', type: 'button', 'data-action': 'edit', 'data-id': item.id, 'data-list': listName, text: 'Edit' }),
    el('button', { class: 'danger', type: 'button', 'data-action': 'delete', 'data-id': item.id, 'data-list': listName, text: 'Delete' })
  ];
  if (listName === 'backlog') {
    actions.unshift(el('button', { class: 'primary', type: 'button', 'data-action': 'done', 'data-id': item.id, text: 'Done' }));
    actions.push(el('button', { class: 'secondary', type: 'button', 'data-action': 'partner', 'data-id': item.id, text: 'Find a partner' }));
  }
  return el('div', { class: 'card' },
    el('h3', { text: item.name }),
    el('span', { class: 'badge', text: kindLabel(item.kind) }),
    el('p', { class: 'entry-meta', text: itemSummary(item) }),
    notes,
    el('div', { class: 'log-actions' }, actions)
  );
}

function renderResume() {
  var resume = document.getElementById('resume-summary');
  if (!logs.length) {
    resume.replaceChildren(el('p', { text: 'No activity logged yet.' }));
    return;
  }
  var items = logs.slice(-5).reverse().map(function (log) {
    return el('li', { text: log.name + ' — ' + kindLabel(log.kind) });
  });
  resume.replaceChildren(
    el('p', { text: 'Recent activity:' }),
    el('ul', { class: 'resume-list' }, items)
  );
}

function renderLogs() {
  var list = document.getElementById('log-list');
  if (!logs.length) list.replaceChildren(el('p', { class: 'muted', text: 'No entries yet.' }));
  else list.replaceChildren.apply(list, logs.slice().reverse().map(function (item) { return renderItemCard(item, 'log'); }));

  var stats = Lgc.computeStats(logs);
  document.getElementById('peak-count').textContent = String(stats.peaks);
  document.getElementById('route-count').textContent = String(stats.routes);
  document.getElementById('hike-count').textContent = String(stats.hikes);
  renderResume();
  syncAreas();
  updateMapMarkers();
}

function renderBacklog() {
  var list = document.getElementById('backlog-list');
  if (!list) return;
  if (!backlog.length) list.replaceChildren(el('p', { class: 'muted', text: 'Nothing waiting. Add a peak, route, or hike you want to do.' }));
  else list.replaceChildren.apply(list, backlog.slice().reverse().map(function (item) { return renderItemCard(item, 'backlog'); }));
  updateMapMarkers();
}

function buttonFromEvent(event) {
  var target = event.target instanceof Element ? event.target : event.target.parentElement;
  if (!target) return null;
  var button = target.closest('button[data-action]');
  if (!button || !event.currentTarget.contains(button)) return null;
  return button;
}

function onItemClick(event) {
  var button = buttonFromEvent(event);
  if (!button) return;
  var id = button.getAttribute('data-id');
  var listName = button.getAttribute('data-list') || 'log';
  var action = button.getAttribute('data-action');
  if (action === 'edit') editItem(id, listName);
  if (action === 'delete') deleteItem(id, listName);
  if (action === 'done') completeBacklogItem(id);
  if (action === 'partner') startPartnerFrom(id);
}

document.getElementById('log-list').addEventListener('click', onItemClick);
document.getElementById('backlog-list').addEventListener('click', onItemClick);

// ---- Form handling ----
var form = document.getElementById('add-form');

function fillActivities(selected) {
  var select = document.getElementById('activity');
  if (select.options.length) {
    select.value = selected || select.value || 'sport';
    return;
  }
  Lgc.ACTIVITIES.forEach(function (activity) {
    var option = document.createElement('option');
    option.value = activity.id;
    option.textContent = activity.label;
    select.appendChild(option);
  });
  select.value = selected || 'sport';
}

function syncKindFields() {
  var kind = document.getElementById('item-kind').value;
  document.getElementById('route-fields').classList.toggle('hidden', kind !== 'route');
  document.getElementById('hike-fields').classList.toggle('hidden', kind !== 'hike');
  document.getElementById('peak-fields').classList.toggle('hidden', kind === 'route');
  document.getElementById('peak-links').classList.toggle('hidden', kind === 'peak');
  document.getElementById('elevation').placeholder = kind === 'hike' ? 'Elevation gain (m)' : 'Summit elevation (m)';
  document.getElementById('grade').placeholder = Lgc.gradeHint(document.getElementById('activity').value);
}

function renderPeakLinks(selected) {
  var box = document.getElementById('peak-links');
  var chosen = selected || [];
  var peaks = logs.concat(backlog).filter(function (item) { return item.kind === 'peak' && item.id !== editingId; });
  if (!peaks.length) {
    box.replaceChildren(el('p', { class: 'muted', text: 'Link peaks after you have added them.' }));
    return;
  }
  box.replaceChildren.apply(box, [el('p', { class: 'muted', text: 'Peaks this also ticks off' })].concat(peaks.map(function (peak) {
    var input = el('input', { type: 'checkbox', value: peak.id });
    input.checked = chosen.indexOf(peak.id) >= 0;
    return el('label', { class: 'check-row' }, input, el('span', { text: peak.name }));
  })));
}

function selectedPeakIds() {
  var box = document.getElementById('peak-links');
  return Array.prototype.map.call(box.querySelectorAll('input:checked'), function (input) { return input.value; });
}

function resetEntryForm(listName) {
  editingId = null;
  editingList = listName || 'log';
  document.getElementById('form-title').textContent = editingList === 'backlog' ? 'Add to backlog' : 'Add to log';
  document.getElementById('item-kind').value = 'peak';
  document.getElementById('name').value = '';
  document.getElementById('grade').value = '';
  document.getElementById('crag').value = '';
  document.getElementById('elevation').value = '';
  document.getElementById('distance').value = '';
  document.getElementById('track').value = '';
  document.getElementById('notes').value = '';
  document.getElementById('lat').value = '';
  document.getElementById('lng').value = '';
  document.getElementById('date').value = editingList === 'log' ? Lgc.todayISO() : '';
  fillActivities('sport');
  syncKindFields();
  renderPeakLinks([]);
}

function openEntryForm(listName) {
  if (!form.classList.contains('hidden') && !editingId && editingList === listName) {
    form.classList.add('hidden');
    return;
  }
  resetEntryForm(listName);
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth' });
}

document.getElementById('item-kind').addEventListener('change', syncKindFields);
document.getElementById('activity').addEventListener('change', syncKindFields);
document.getElementById('add-btn').addEventListener('click', function () { openEntryForm('log'); });
document.getElementById('add-backlog-btn').addEventListener('click', function () { openEntryForm('backlog'); });

document.getElementById('save-btn').addEventListener('click', function () {
  var kind = document.getElementById('item-kind').value;
  var coords = Lgc.readCoordPair(document.getElementById('lat').value, document.getElementById('lng').value);
  if (coords.error) return alert(coords.error);
  var elevation = Lgc.readElevation(document.getElementById('elevation').value);
  if (kind !== 'route' && elevation.error) return alert(elevation.error);
  var list = editingList === 'backlog' ? backlog : logs;
  var previous = editingId ? list.find(function (item) { return item.id === editingId; }) : null;
  var fields = {
    kind: kind,
    name: document.getElementById('name').value,
    activity: document.getElementById('activity').value,
    grade: document.getElementById('grade').value,
    crag: document.getElementById('crag').value,
    date: document.getElementById('date').value,
    elevation: kind === 'route' ? (previous ? previous.elevation : null) : elevation.value,
    distance: document.getElementById('distance').value,
    track: document.getElementById('track').value,
    peakIds: selectedPeakIds(),
    notes: document.getElementById('notes').value,
    lat: coords.lat,
    lng: coords.lng
  };
  var entry = previous ? Lgc.updateLog(previous, fields) : Lgc.createLog(fields);
  if (!entry) return alert('Name is required');
  if (previous) {
    var index = list.findIndex(function (item) { return item.id === editingId; });
    if (index >= 0) list[index] = entry;
  } else if (editingList === 'backlog') backlog.push(entry);
  else logs.push(entry);
  saveLogs();
  saveBacklog();
  form.classList.add('hidden');
  editingId = null;
  renderLogs();
  renderBacklog();
});

function editItem(id, listName) {
  var list = listName === 'backlog' ? backlog : logs;
  var item = list.find(function (entry) { return entry.id === id; });
  if (!item) return;
  editingId = item.id;
  editingList = listName;
  document.getElementById('form-title').textContent = 'Edit';
  document.getElementById('item-kind').value = item.kind;
  document.getElementById('name').value = item.name;
  fillActivities(item.activity || 'sport');
  document.getElementById('grade').value = item.grade || '';
  document.getElementById('crag').value = item.crag || '';
  document.getElementById('elevation').value = Lgc.formatNumberInput(item.elevation);
  document.getElementById('distance').value = Lgc.formatNumberInput(item.distance);
  document.getElementById('track').value = item.track || '';
  document.getElementById('date').value = item.date || '';
  document.getElementById('notes').value = item.notes || '';
  document.getElementById('lat').value = Lgc.formatNumberInput(item.lat);
  document.getElementById('lng').value = Lgc.formatNumberInput(item.lng);
  syncKindFields();
  renderPeakLinks(item.peakIds || []);
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth' });
}

function deleteItem(id, listName) {
  if (!confirm('Delete this entry?')) return;
  if (listName === 'backlog') {
    backlog = backlog.filter(function (item) { return item.id !== id; });
    saveBacklog();
  } else {
    logs = logs.filter(function (item) { return item.id !== id; });
    saveLogs();
  }
  renderLogs();
  renderBacklog();
}

function completeBacklogItem(id) {
  var item = backlog.find(function (entry) { return entry.id === id; });
  if (!item) return;
  var result = Lgc.completeItem(item, logs, backlog);
  logs = result.logs;
  backlog = result.backlog;
  saveLogs();
  saveBacklog();
  renderLogs();
  renderBacklog();
  selectTab('log');
}

// ---- Map ----
function setMapNote(text) {
  var note = document.getElementById('map-note');
  if (note) note.textContent = text;
}

function alreadyHave(name) {
  var key = String(name || '').trim().toLowerCase();
  return logs.concat(backlog).some(function (item) { return item.name.toLowerCase() === key; });
}

function addCatalogItem(place) {
  if (alreadyHave(place.name)) {
    alert(place.name + ' is already in your log or backlog.');
    return;
  }
  var entry = Lgc.createLog({
    kind: place.kind || 'peak',
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    elevation: place.elevation,
    notes: place.note || ''
  });
  if (!entry) return;
  backlog.push(entry);
  saveBacklog();
  renderBacklog();
  setMapNote(place.name + ' added to your backlog.');
}

function renderFamous() {
  var list = document.getElementById('famous-list');
  if (!list) return;
  list.replaceChildren.apply(list, Lgc.FAMOUS.map(function (place) {
    return el('div', { class: 'suggestion' },
      el('strong', { text: place.name }),
      el('span', { class: 'badge', text: kindLabel(place.kind) }),
      el('p', { text: place.note }),
      el('button', {
        class: 'secondary',
        type: 'button',
        'data-famous': place.name,
        text: 'Add to backlog'
      })
    );
  }));
}

function famousByName(name) {
  var found = null;
  Lgc.FAMOUS.forEach(function (place) { if (place.name === name) found = place; });
  return found;
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

function markerPopup(item) {
  return el('div', null,
    el('strong', { text: item.name }),
    el('br'),
    document.createTextNode(kindLabel(item.kind) + (item.date ? ' · ' + item.date : ''))
  );
}

function placePopup(place) {
  var button = el('button', { type: 'button', text: 'Add to backlog' });
  button.addEventListener('click', function () { addCatalogItem(place); });
  return el('div', null,
    el('strong', { text: place.name }),
    el('br'),
    document.createTextNode(place.note || 'OpenStreetMap'),
    el('br'),
    button
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

function addCircle(item, color, popup) {
  if (!Lgc.hasCoords(item)) return;
  var marker = L.circleMarker([item.lat, item.lng], {
    radius: 8,
    color: color,
    fillColor: color,
    fillOpacity: 0.88,
    weight: 2
  }).addTo(map);
  marker.bindPopup(popup || markerPopup(item));
  markers.push(marker);
}

function updateMapMarkers() {
  if (!map) return;
  markers.forEach(function (marker) { map.removeLayer(marker); });
  markers = [];
  logs.forEach(function (item) { addCircle(item, '#3b82f6'); });
  backlog.forEach(function (item) { addCircle(item, '#f59e0b'); });
  if (document.getElementById('osm-layer').checked) {
    Lgc.FAMOUS.forEach(function (place) { addCircle(place, '#a78bfa', placePopup(place)); });
    osmMarkers.forEach(function (place) { addCircle(place, '#a78bfa', placePopup(place)); });
  }
}

function loadPeaksInView() {
  if (!map || typeof Over === 'undefined') return;
  if (!navigator.onLine) {
    setMapNote('Offline. Famous routes stay available. Peaks in this view need a connection.');
    return;
  }
  var gate = Over.canFetch(map.getZoom(), Date.now());
  if (!gate.ok) {
    setMapNote(gate.reason);
    return;
  }
  var bounds = map.getBounds();
  var box = { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() };
  var key = Over.bboxKey(box);
  var cached = Store.readCache('peaks', key);
  if (cached) {
    osmMarkers = cached;
    document.getElementById('osm-layer').checked = true;
    updateMapMarkers();
    setMapNote('Showing saved OpenStreetMap peaks for this area.');
    return;
  }
  Over.noteRequest(Date.now());
  setMapNote('Asking OpenStreetMap…');
  fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'data=' + encodeURIComponent(Over.buildQuery(box))
  }).then(function (response) {
    if (!response.ok) throw new Error('Overpass ' + response.status);
    return response.json();
  }).then(function (data) {
    osmMarkers = Over.parseElements(data);
    Store.writeCache('peaks', key, osmMarkers);
    document.getElementById('osm-layer').checked = true;
    updateMapMarkers();
    setMapNote(osmMarkers.length ? osmMarkers.length + ' peaks from OpenStreetMap.' : 'No named peaks in this view.');
  }).catch(function () {
    setMapNote('OpenStreetMap did not answer. Famous routes are still listed below.');
  });
}

// ---- Partner posts ----
function renderPostCard(post) {
  return el('div', { class: 'card' },
    el('h3', { text: post.objective }),
    el('p', { class: 'post-meta', text: post.dates }),
    el('p', { class: 'post-looking', text: 'Looking for: ' + (post.looking || '') }),
    el('p', { class: 'post-shared', text: 'Shared context: ' + (post.shared || 'No log entries attached') }),
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

function renderContextChoices() {
  var box = document.getElementById('post-context');
  if (!logs.length) {
    box.replaceChildren(el('p', { class: 'muted', text: 'No log entries to attach. Nothing is shared until you tick one.' }));
    return;
  }
  var rows = logs.slice().reverse().map(function (item) {
    var input = el('input', { type: 'checkbox', value: item.id });
    return el('label', { class: 'check-row' }, input, el('span', { text: item.name + ' · ' + kindLabel(item.kind) }));
  });
  box.replaceChildren.apply(box, [el('p', { class: 'muted', text: 'Attach log entries. None are included until you tick them.' })].concat(rows));
}

function openPostForm(objective, itemId) {
  postingItemId = itemId || '';
  document.getElementById('post-objective').value = objective || '';
  document.getElementById('post-dates').value = '';
  document.getElementById('post-looking').value = '';
  renderContextChoices();
  document.getElementById('post-form').classList.remove('hidden');
}

function startPartnerFrom(id) {
  var item = backlog.find(function (entry) { return entry.id === id; });
  if (!item) return;
  selectTab('partners');
  openPostForm(item.name, item.id);
}

document.getElementById('post-btn').addEventListener('click', function () {
  var formOpen = !document.getElementById('post-form').classList.contains('hidden');
  if (formOpen) {
    document.getElementById('post-form').classList.add('hidden');
    return;
  }
  openPostForm('', '');
});

document.getElementById('save-post-btn').addEventListener('click', function () {
  var attached = Array.prototype.map.call(
    document.querySelectorAll('#post-context input:checked'),
    function (input) { return input.value; }
  );
  var names = attached.map(function (id) {
    var item = logs.find(function (entry) { return entry.id === id; });
    return item ? item.name + ' (' + kindLabel(item.kind) + ')' : '';
  }).filter(Boolean);
  var post = Lgc.createPost({
    objective: document.getElementById('post-objective').value,
    dates: document.getElementById('post-dates').value,
    looking: document.getElementById('post-looking').value,
    itemId: postingItemId,
    attachedIds: attached,
    shared: names.length ? 'Context: ' + names.join(', ') : ''
  });
  if (!post) return alert('Objective required');
  partnerPosts.push(post);
  savePosts();
  document.getElementById('post-form').classList.add('hidden');
  postingItemId = '';
  renderPosts();
});

function deletePost(id) {
  partnerPosts = partnerPosts.filter(function (post) { return post.id !== id; });
  savePosts();
  renderPosts();
}

// ---- Export / Import ----
document.getElementById('export-btn').addEventListener('click', function () {
  var data = { logs: logs, backlog: backlog, partnerPosts: partnerPosts, exported: new Date().toISOString() };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var link = document.createElement('a');
  var url = URL.createObjectURL(blob);
  link.href = url;
  link.download = 'summitlog-export.json';
  link.click();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
});

document.getElementById('famous-list').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('button[data-famous]') : null;
  if (!button) return;
  var place = famousByName(button.getAttribute('data-famous'));
  if (place) addCatalogItem(place);
});

document.getElementById('osm-layer').addEventListener('change', updateMapMarkers);
document.getElementById('load-peaks-btn').addEventListener('click', loadPeaksInView);

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
