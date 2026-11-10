// SummitLog — log, map areas, and optional local display name. Text is rendered as text.
var Lgc = window.SummitLogLogic;
var Store = window.SummitLogStorage;
var Over = window.SummitLogOverpass;
var Col = window.SummitCollections;
var Partners = window.SummitPartners;
var Photos = window.SummitPhotos;

var FEATURES = { exploreSheet: false };
if (!FEATURES.exploreSheet) document.documentElement.classList.add('explore-sheet-off');

var items = [];
var mineSegment = 'planned';
var mineKinds = {};
var planStages = {};
var logbookView = 'timeline';
var logbookMap = null;
var logbookMarkers = [];
var calendarCursor = new Date();
var calendarTouched = false;
var donePromptId = '';
var activePlanId = '';
var peakPhotos = {};
var userLocation = null;
var sourcedLists = [];
var activeCollectionId = '';
var sheetSnap = 'peek';
var sheetMode = 'home';
var exploreHist = { collection: false, peak: false };
var nearNote = '';
var partnerReturn = 'search';
var partnerPosts = [];
var memberships = [];
var objectiveCatalog = [];
var activeObjective = null;
var activePerson = null;
var joinFormOpen = false;
var suggestionIndex = -1;
var currentUser = '';
var map;
var markers = [];
var areaLayers = [];
var osmMarkers = [];
var editingId = null;
var editingList = 'log';
var collectionData = null;
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

function fill(parent, children) {
  parent.replaceChildren.apply(parent, children.filter(function (child) {
    return child != null && child !== false;
  }));
}

function saveItems() { items = Store.saveItems(items); }
function doneItems() { return items.filter(function (item) { return item.status !== 'planned'; }); }
function plannedItems() { return items.filter(function (item) { return item.status === 'planned'; }); }

var accountButtonBound = false;

function refreshAccountButton() {
  var button = document.getElementById('logout-btn');
  var avatar = document.getElementById('profile-btn');
  var mapAvatar = document.getElementById('map-profile');
  var label = document.getElementById('user-display');
  var accountUser = window.SummitAccount && SummitAccount.user ? SummitAccount.user() : null;
  var name = currentUser || (accountUser && accountUser.displayName) || '';
  if (label) label.textContent = name;
  function paint(node) {
    if (!node) return;
    if (window.SummitChat && SummitChat.paintAvatar) SummitChat.paintAvatar(node, accountUser ? accountUser.id : '', name || 'You');
    else node.textContent = name ? yourInitials() : 'You';
  }
  paint(avatar);
  paint(mapAvatar);
  if (!button) return;
  if (window.SummitAccount && SummitAccount.configured()) {
    button.textContent = SummitAccount.user() ? 'Log out' : 'Sign in';
    return;
  }
  button.textContent = currentUser ? 'Log out' : 'Sign in';
}

items = Store.loadItems();
partnerPosts = Store.loadPosts();
memberships = Store.loadMemberships();
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

function accountSnapshot() {
  return {
    items: items,
    memberships: memberships,
    level: Store.getLevel(),
    displayName: Store.getDisplayName() || currentUser,
    onApply: function (next) {
      items = Store.saveItems(next);
      renderMine();
    },
    listPhotos: function () {
      if (!Photos || !Photos.list) return Promise.resolve([]);
      var done = items.filter(function (item) { return item.status !== 'planned'; }).slice(0, 20);
      return Promise.all(done.map(function (item) {
        return Photos.list(item.id).then(function (rows) {
          return (rows || []).slice(0, 2).map(function (row) {
            return { itemId: item.id, id: row.id, blob: row.blob };
          });
        }, function () { return []; });
      })).then(function (groups) {
        var flat = [];
        groups.forEach(function (group) { group.forEach(function (row) { if (row && row.blob) flat.push(row); }); });
        return flat.slice(0, 20);
      });
    }
  };
}

function showApp() {
  setScreen('app');
  watchChrome();
  refreshAccountButton();
  updateOfflineBanner();
  initMap();
  renderMine();
  selectTab('plan');
  renderFamous();
  rebuildObjectives();
  loadCollections();
  loadPeakPhotos();
  fillLevelForm();
  if (window.SummitAccount) {
    if (!accountButtonBound && SummitAccount.onChange) {
      accountButtonBound = true;
      SummitAccount.onChange(refreshAccountButton);
    }
    SummitAccount.boot(accountSnapshot).then(function () {
      refreshAccountButton();
      if (window.SummitChat) SummitChat.start();
    });
  }
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
  selectTab('plan');
});

document.getElementById('intro-back').addEventListener('click', function () {
  showApp();
});

document.getElementById('google-login').addEventListener('click', function () {
  if (window.SummitAccount && SummitAccount.configured()) {
    var status = document.getElementById('magic-status');
    SummitAccount.signInWithProvider('google').then(function (result) {
      if (status && result && !result.ok) status.textContent = 'Google sign-in is not switched on for this project yet.';
    });
    return;
  }
  alert('Google login coming soon.\n\nFor now, use any username and password below.');
});

document.getElementById('github-login').addEventListener('click', function () {
  if (window.SummitAccount && SummitAccount.configured()) {
    var status = document.getElementById('magic-status');
    SummitAccount.signInWithProvider('apple').then(function (result) {
      if (status && result && !result.ok) status.textContent = 'Apple sign-in is not switched on for this project yet.';
    });
    return;
  }
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
function openChatFromBar() {
  if (window.SummitChat) SummitChat.openInbox();
}
var chatOpen = document.getElementById('chat-open');
if (chatOpen) chatOpen.addEventListener('click', openChatFromBar);
var mapChat = document.getElementById('map-chat');
if (mapChat) mapChat.addEventListener('click', function (event) {
  event.preventDefault();
  openChatFromBar();
});
var mapProfile = document.getElementById('map-profile');
if (mapProfile) mapProfile.addEventListener('click', function () { selectTab('profile'); });

document.getElementById('connections').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('button[data-connect]') : null;
  if (!button) return;
  alert(button.getAttribute('data-connect') + ' is coming soon and requires an account.');
});

document.getElementById('logout-btn').addEventListener('click', function () {
  if (window.SummitAccount && SummitAccount.configured()) {
    if (SummitAccount.user()) SummitAccount.signOut().then(refreshAccountButton);
    else showLogin();
    return;
  }
  if (!currentUser) {
    showLogin();
    return;
  }
  currentUser = '';
  Store.clearDisplayName();
  refreshAccountButton();
});

// ---- Tabs ----
function fitMap() {
  if (!document.documentElement.classList.contains('explore-map')) return;
  sizeExploreMap();
}

function watchChrome() {
  var mainEl = document.querySelector('#app main');
  if (!mainEl || mainEl.dataset.chromeWatch) return;
  mainEl.dataset.chromeWatch = '1';
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () { fitMap(); }).observe(mainEl);
  }
  window.addEventListener('resize', fitMap);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitMap);
}

function selectTab(name) {
  dismissPeakPage();
  if (name !== 'explore') leaveExploreMap();
  if (name !== 'plan' && name !== 'logbook' && form) form.classList.add('hidden');
  document.querySelectorAll('#app > nav button').forEach(function (item) {
    item.classList.toggle('active', item.dataset.tab === name);
  });
  document.querySelectorAll('.tab').forEach(function (section) {
    section.classList.toggle('hidden', section.id !== name);
  });
  var mainEl = document.querySelector('#app main');
  if (mainEl) mainEl.scrollTop = 0;
  if (name === 'explore') enterExploreMap();
  if (name === 'plan') showPlanHome();
  if (name === 'logbook') showLogbookHome();
  if (name === 'partners') showPartnerSearch();
  if (name === 'profile' && window.SummitProfile) SummitProfile.openOwn();
}

function exploreSheetOn() {
  return FEATURES.exploreSheet === true;
}

function enterExploreMap() {
  document.documentElement.classList.toggle('explore-sheet-off', !exploreSheetOn());
  document.documentElement.classList.add('explore-map');
  initMap();
  setMapGestures(true);
  sizeExploreMap();
  renderExploreSheet();
  setTimeout(sizeExploreMap, 80);
}

function leaveExploreMap() {
  document.documentElement.classList.remove('explore-map', 'explore-peak');
  var app = document.getElementById('app');
  if (app) {
    app.style.marginTop = '';
    app.style.height = '';
  }
  setMapGestures(false);
}

document.querySelectorAll('#app > nav button').forEach(function (btn) {
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
function activityLabel(item) {
  if (!item) return '';
  if (item.activityType === 'rock') {
    var names = { sport: 'Sport', trad: 'Trad', multipitch: 'Multipitch', bouldering: 'Bouldering' };
    return 'Rock climbing' + (names[item.discipline] ? ' · ' + names[item.discipline] : '');
  }
  if (item.activityType === 'hiking') return 'Hiking & trekking';
  if (item.activityType === 'mountaineering') return 'Mountaineering';
  return kindLabel(item.kind);
}

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

function seasonLabel(season) {
  if (season === 'winter') return 'Winter';
  if (season === 'spring') return 'Spring';
  if (season === 'summer') return 'Summer';
  if (season === 'autumn') return 'Autumn';
  return '';
}

function prettyDate(iso) {
  if (!iso) return '';
  var parts = String(iso).slice(0, 10).split('-');
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var month = months[Number(parts[1]) - 1];
  if (!month || parts.length < 3) return String(iso).slice(0, 10);
  return Number(parts[2]) + ' ' + month + ' ' + parts[0];
}

function historyLine(item) {
  var added = item.createdAt ? 'Added ' + prettyDate(item.createdAt) : '';
  var when = '';
  if (item.status !== 'planned' && item.date) when = (item.kind === 'peak' ? 'Summited ' : 'Done ') + prettyDate(item.date);
  return [added, when].filter(Boolean).join(' · ');
}

function matchesLogbook(item) {
  var kinds = Object.keys(mineKinds).filter(function (kind) { return mineKinds[kind]; });
  if (kinds.length && kinds.indexOf(item.activityType || 'mountaineering') < 0) return false;
  var query = document.getElementById('logbook-search');
  var text = query ? Partners.fold(query.value) : '';
  if (!text) return true;
  return Partners.fold(item.name).indexOf(text) >= 0 || Partners.nameKey(item.name).indexOf(text) >= 0;
}

function renderItemCard(item) {
  var planned = item.status === 'planned';
  var notes = item.notes ? el('p', { class: 'entry-notes', text: item.notes }) : null;
  var summary = itemSummary(item);
  if (item.date) {
    summary = summary.split(' · ').filter(function (part) { return part !== item.date; }).join(' · ');
  }
  var meta = [summary, seasonLabel(item.season), historyLine(item)].filter(Boolean).join(' · ');
  var actions = [
    el('button', { class: 'secondary', type: 'button', 'data-action': 'edit', 'data-id': item.id, text: 'Edit' }),
    el('button', { class: 'danger', type: 'button', 'data-action': 'delete', 'data-id': item.id, text: 'Delete' })
  ];
  if (planned) {
    actions.unshift(el('button', { class: 'primary', type: 'button', 'data-action': 'open', 'data-id': item.id, text: 'Open' }));
    actions.unshift(el('button', { class: 'secondary icon-btn', type: 'button', 'data-action': 'down', 'data-id': item.id, 'aria-label': 'Move down', text: '↓' }));
    actions.unshift(el('button', { class: 'secondary icon-btn', type: 'button', 'data-action': 'up', 'data-id': item.id, 'aria-label': 'Move up', text: '↑' }));
  } else {
    actions.unshift(el('button', { class: 'secondary', type: 'button', 'data-action': 'memory', 'data-id': item.id, text: 'Memories' }));
  }
  var card = el('div', { class: 'card mine-card', draggable: planned ? 'true' : 'false', 'data-id': item.id },
    el('h3', { text: item.name }),
    el('span', { class: 'badge', text: activityLabel(item) }),
    el('p', { class: 'entry-meta', text: meta }),
    notes,
    el('div', { class: 'log-actions' }, actions)
  );
  if (planned) {
    card.addEventListener('dragstart', function (event) {
      event.dataTransfer.setData('text/plain', item.id);
      event.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragover', function (event) { event.preventDefault(); });
    card.addEventListener('drop', function (event) {
      event.preventDefault();
      reorderPlannedTo(event.dataTransfer.getData('text/plain'), item.id);
    });
  }
  return card;
}

function renderResume() {
  var resume = document.getElementById('resume-summary');
  var recent = Lgc.doneOrder(items).slice(0, 5);
  if (!recent.length) {
    resume.replaceChildren(el('p', { text: 'No activity logged yet.' }));
    return;
  }
  resume.replaceChildren(
    el('p', { text: 'Recent activity:' }),
    el('ul', { class: 'resume-list' }, recent.map(function (log) {
      return el('li', { text: log.name + ' — ' + kindLabel(log.kind) });
    }))
  );
}

function planThumb(item) {
  var peak = collectionPeakByName(item);
  var photo = peak ? photoRecord(peak) : null;
  if (!photo || !photo.thumb) {
    return el('div', { class: 'plan-thumb peak-photo-empty', role: 'img', 'aria-label': 'Illustrated placeholder' });
  }
  var img = el('img', { class: 'plan-thumb', alt: '', loading: 'lazy', src: photo.thumb });
  img.addEventListener('error', function () {
    img.replaceWith(el('div', { class: 'plan-thumb peak-photo-empty', role: 'img', 'aria-label': 'Illustrated placeholder' }));
  });
  return img;
}

function queueCount(item) {
  if (!item || item.visibility !== 'community' || !item.lookingForPartner) return 0;
  var objective = Partners.resolveObjective(objectiveCatalog, item);
  if (!objective || !Partners.demoQueue) return 0;
  return Partners.demoQueue(objective).length;
}

function planStatusLine(item) {
  var stage = Lgc.deriveStage(item);
  var label = stage === 'scheduled' ? 'Scheduled' : stage === 'objective' ? 'Objective' : 'Idea';
  var count = queueCount(item);
  if (item.visibility !== 'community' || !item.lookingForPartner) {
    if (item.visibility === 'private' && stage === 'idea') return 'Personal idea';
    return label;
  }
  if (!count) return 'Looking for a partner';
  return count + (count === 1 ? ' in the queue · ' : ' in the queue · ') + label;
}

function renderPlanCard(item) {
  var when = item.fixedDate ? prettyDate(item.fixedDate) : (item.timeframe || 'Date not set');
  var card = el('article', { class: 'card plan-record', draggable: 'true', 'data-id': item.id },
    planThumb(item),
    el('div', { class: 'plan-record-body' },
      el('h3', { text: item.name }),
      el('p', { class: 'entry-meta', text: activityLabel(item) }),
      el('p', { text: item.routeName || 'Route TBD' }),
      el('p', { class: 'entry-meta', text: when }),
      el('p', { class: 'plan-status', text: planStatusLine(item) })
    ),
    el('div', { class: 'log-actions' },
      el('button', { class: 'secondary icon-btn', type: 'button', 'data-action': 'up', 'data-id': item.id, 'aria-label': 'Move up', text: '↑' }),
      el('button', { class: 'secondary icon-btn', type: 'button', 'data-action': 'down', 'data-id': item.id, 'aria-label': 'Move down', text: '↓' }),
      el('button', { class: 'primary', type: 'button', 'data-action': 'open', 'data-id': item.id, text: 'Open' })
    )
  );
  card.addEventListener('dragstart', function (event) {
    event.dataTransfer.setData('text/plain', item.id);
    event.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragover', function (event) { event.preventDefault(); });
  card.addEventListener('drop', function (event) {
    event.preventDefault();
    reorderPlannedTo(event.dataTransfer.getData('text/plain'), item.id);
  });
  return card;
}

function renderMine() {
  var planList = document.getElementById('plan-list');
  var bookList = document.getElementById('logbook-list');
  if (planList) {
    var stages = Object.keys(planStages).filter(function (stage) { return planStages[stage]; });
    var plans = Lgc.plannedOrder(items).filter(function (item) {
      return !stages.length || stages.indexOf(Lgc.deriveStage(item)) >= 0;
    });
    var emptyPlan = stages.length
      ? 'Nothing in this stage.'
      : 'Nothing planned yet. Add an objective, or bookmark one in Explore.';
    planList.replaceChildren.apply(planList, plans.length
      ? plans.map(renderPlanCard)
      : [el('p', { class: 'muted', text: emptyPlan })]);
  }
  if (bookList) {
    var done = Lgc.doneOrder(items).filter(matchesLogbook);
    var filtered = Object.keys(mineKinds).some(function (kind) { return mineKinds[kind]; });
    var search = document.getElementById('logbook-search');
    var empty = (search && search.value.trim()) || filtered
      ? 'Nothing matches.'
      : 'Nothing in the logbook yet. Mark a plan as done, or log something you already did.';
    bookList.replaceChildren.apply(bookList, done.length
      ? done.map(renderItemCard)
      : [el('p', { class: 'muted', text: empty })]);
    paintLogPhotos(done);
    refreshLogbookView(done);
  }
  var stats = Lgc.computeStats(doneItems());
  var peakCount = document.getElementById('peak-count');
  if (peakCount) peakCount.textContent = String(stats.peaks);
  var routeCount = document.getElementById('route-count');
  if (routeCount) routeCount.textContent = String(stats.routes);
  var hikeCount = document.getElementById('hike-count');
  if (hikeCount) hikeCount.textContent = String(stats.hikes);
  renderResume();
  syncAreas();
  updateMapMarkers();
  renderCollections();
  renderExplore();
}

function setMineSegment(name) {
  donePromptId = '';
  var prompt = document.getElementById('done-prompt');
  if (prompt) prompt.classList.add('hidden');
  selectTab(name === 'done' ? 'logbook' : 'plan');
  renderMine();
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
  var action = button.getAttribute('data-action');
  if (action === 'edit') editItem(id);
  if (action === 'delete') deleteItem(id);
  if (action === 'done') openDonePrompt(id);
  if (action === 'open') showPlanDetail(id);
  if (action === 'memory') showMemory(id);
  if (action === 'partner') startPartnerFrom(id);
  if (action === 'up') movePlanned(id, -1);
  if (action === 'down') movePlanned(id, 1);
}

document.getElementById('plan-list').addEventListener('click', onItemClick);
document.getElementById('logbook-list').addEventListener('click', onItemClick);
document.getElementById('logbook-search').addEventListener('input', renderMine);
document.getElementById('plan-stages').addEventListener('click', function (event) {
  var chip = event.target.closest ? event.target.closest('[data-stage]') : null;
  if (!chip) return;
  var stage = chip.getAttribute('data-stage');
  planStages[stage] = !planStages[stage];
  chip.setAttribute('aria-pressed', planStages[stage] ? 'true' : 'false');
  chip.classList.toggle('active', !!planStages[stage]);
  renderMine();
});
document.getElementById('form-more').addEventListener('click', function () {
  form.classList.remove('form-brief');
  document.getElementById('form-more').classList.add('hidden');
});
document.querySelectorAll('.chip').forEach(function (chip) {
  chip.addEventListener('click', function () {
    var kind = chip.getAttribute('data-kind');
    if (!kind) return;
    mineKinds[kind] = !mineKinds[kind];
    chip.setAttribute('aria-pressed', mineKinds[kind] ? 'true' : 'false');
    chip.classList.toggle('active', !!mineKinds[kind]);
    renderMine();
  });
});

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
  var peaks = items.filter(function (item) { return item.kind === 'peak' && item.id !== editingId; });
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

function syncStatusFields() {
  var planned = editingList === 'planned';
  document.getElementById('date').classList.toggle('hidden', planned);
  document.getElementById('season-fields').classList.toggle('hidden', !planned);
}

function resetEntryForm(listName) {
  editingId = null;
  editingList = listName === 'done' ? 'done' : 'planned';
  document.getElementById('form-title').textContent = editingList === 'planned' ? 'Add an objective' : 'Log an ascent';
  form.classList.toggle('form-brief', editingList === 'planned');
  document.getElementById('form-more').classList.toggle('hidden', editingList !== 'planned');
  document.getElementById('item-kind').value = 'peak';
  document.getElementById('name').value = '';
  document.getElementById('grade').value = '';
  document.getElementById('crag').value = '';
  document.getElementById('elevation').value = '';
  document.getElementById('distance').value = '';
  document.getElementById('track').value = '';
  var stages = document.getElementById('hike-stages');
  if (stages) stages.value = '';
  document.getElementById('notes').value = '';
  document.getElementById('lat').value = '';
  document.getElementById('lng').value = '';
  document.getElementById('date').value = editingList === 'done' ? Lgc.todayISO() : '';
  document.getElementById('season').value = '';
  fillActivities('sport');
  syncKindFields();
  syncStatusFields();
  renderPeakLinks([]);
}

function openEntryForm(listName) {
  if (!form.classList.contains('hidden') && !editingId && editingList === listName) {
    form.classList.add('hidden');
    return;
  }
  resetEntryForm(listName);
  form.classList.remove('hidden');
  form.classList.toggle('form-brief', listName !== 'done' && !editingId);
  form.classList.toggle('form-pick', listName === 'done' && !editingId);
  document.getElementById('activity-type-picker').classList.toggle('hidden', listName !== 'done' || !!editingId);
  form.scrollIntoView({ behavior: 'smooth' });
}

function stagesFromInput() {
  var box = document.getElementById('hike-stages');
  if (!box || !box.value.trim()) return [];
  return box.value.split('\n').map(function (line) {
    return { name: line.trim() };
  }).filter(function (stage) { return stage.name; });
}

function renderNameSuggestions() {
  var input = document.getElementById('name');
  var list = document.getElementById('name-suggestions');
  if (!input || !list) return;
  var query = input.value.trim();
  if (!collectionData || query.length < 2) {
    list.replaceChildren();
    return;
  }
  var folded = Partners.fold(query);
  var matches = collectionData.peaks.filter(function (peak) {
    return Partners.fold(peak.name).indexOf(folded) >= 0 || Col.normName(peak.name).indexOf(folded) >= 0;
  }).slice(0, 6);
  list.replaceChildren.apply(list, matches.map(function (peak) {
    return el('li', null, el('button', { type: 'button', 'data-peak-id': peak.id },
      el('span', { class: 'suggestion-name', text: peak.name }),
      el('span', { class: 'suggestion-meta', text: peak.elevation + ' m · ' + (peak.subrange || '') + ' · ' + Col.countryLabel(peak) })
    ));
  }));
}

document.getElementById('name').addEventListener('input', renderNameSuggestions);
document.getElementById('name-suggestions').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('[data-peak-id]') : null;
  if (!button || !collectionData) return;
  var peak = null;
  collectionData.peaks.forEach(function (item) {
    if (item.id === button.getAttribute('data-peak-id')) peak = item;
  });
  if (!peak) return;
  document.getElementById('name').value = peak.name;
  document.getElementById('item-kind').value = 'peak';
  document.getElementById('elevation').value = peak.elevation;
  document.getElementById('lat').value = peak.lat;
  document.getElementById('lng').value = peak.lng;
  document.getElementById('name-suggestions').replaceChildren();
  syncKindFields();
});

document.getElementById('activity-type-picker').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('[data-activity-type]') : null;
  if (!button) return;
  var type = button.getAttribute('data-activity-type');
  document.getElementById('item-kind').value = type === 'rock' ? 'route' : type === 'hiking' ? 'hike' : 'peak';
  if (type === 'rock') document.getElementById('activity').value = 'sport';
  form.classList.remove('form-pick');
  document.getElementById('activity-type-picker').classList.add('hidden');
  syncKindFields();
});

document.getElementById('item-kind').addEventListener('change', syncKindFields);
document.getElementById('activity').addEventListener('change', syncKindFields);
document.getElementById('add-planned-btn').addEventListener('click', function () {
  selectTab('plan');
  openEntryForm('planned');
});
document.getElementById('add-done-btn').addEventListener('click', function () {
  selectTab('logbook');
  openEntryForm('done');
});

document.getElementById('save-btn').addEventListener('click', function () {
  var kind = document.getElementById('item-kind').value;
  var coords = Lgc.readCoordPair(document.getElementById('lat').value, document.getElementById('lng').value);
  if (coords.error) return alert(coords.error);
  var elevation = Lgc.readElevation(document.getElementById('elevation').value);
  if (kind !== 'route' && elevation.error) return alert(elevation.error);
  var previous = editingId ? items.find(function (item) { return item.id === editingId; }) : null;
  var planned = (previous ? previous.status : editingList) === 'planned';
  var fields = {
    kind: kind,
    name: document.getElementById('name').value,
    activity: document.getElementById('activity').value,
    grade: document.getElementById('grade').value,
    crag: document.getElementById('crag').value,
    date: planned ? '' : document.getElementById('date').value,
    elevation: kind === 'route' ? (previous ? previous.elevation : null) : elevation.value,
    distance: document.getElementById('distance').value,
    track: document.getElementById('track').value,
    peakIds: selectedPeakIds(),
    notes: document.getElementById('notes').value,
    lat: coords.lat,
    lng: coords.lng,
    activityType: kind === 'route' ? 'rock' : kind === 'hike' ? 'hiking' : 'mountaineering',
    discipline: kind === 'route' ? document.getElementById('activity').value : '',
    stages: stagesFromInput(),
    status: planned ? 'planned' : 'done',
    season: planned ? document.getElementById('season').value : '',
    priority: previous ? previous.priority : 0
  };
  if (!previous && planned) {
    items = items.map(function (item) {
      if (item.status !== 'planned') return item;
      return Object.assign({}, item, { priority: (item.priority || 0) + 1 });
    });
  }
  var entry = previous ? Lgc.updateLog(previous, fields) : Lgc.createLog(fields);
  if (!entry) return alert('Name is required');
  if (previous) {
    var index = items.findIndex(function (item) { return item.id === editingId; });
    if (index >= 0) items[index] = entry;
  } else items.push(entry);
  saveItems();
  form.classList.add('hidden');
  editingId = null;
  renderMine();
});

function editItem(id) {
  var item = items.find(function (entry) { return entry.id === id; });
  if (!item) return;
  editingId = item.id;
  editingList = item.status === 'planned' ? 'planned' : 'done';
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
  document.getElementById('season').value = item.season || '';
  document.getElementById('notes').value = item.notes || '';
  document.getElementById('lat').value = Lgc.formatNumberInput(item.lat);
  document.getElementById('lng').value = Lgc.formatNumberInput(item.lng);
  syncKindFields();
  syncStatusFields();
  renderPeakLinks(item.peakIds || []);
  form.classList.remove('hidden', 'form-brief', 'form-pick');
  document.getElementById('form-more').classList.add('hidden');
  form.scrollIntoView({ behavior: 'smooth' });
}

function deleteItem(id) {
  if (!confirm('Delete this entry?')) return;
  items = items.filter(function (item) { return item.id !== id; });
  saveItems();
  renderMine();
}

function openDonePrompt(id) {
  var item = items.find(function (entry) { return entry.id === id && entry.status === 'planned'; });
  if (!item) return;
  donePromptId = id;
  activePlanId = id;
  document.getElementById('plan-home').classList.add('hidden');
  document.getElementById('plan-detail').classList.add('hidden');
  document.getElementById('partner-flow').classList.add('hidden');
  document.getElementById('done-prompt-name').textContent = item.name + (item.peakIds && item.peakIds.length ? '. Linked peaks are marked done with the same date.' : '');
  document.getElementById('done-date').value = item.date || Lgc.todayISO();
  document.getElementById('done-note').value = '';
  document.getElementById('done-photo').value = '';
  ['done-route', 'done-partners', 'done-weather', 'done-snow', 'done-temp', 'done-duration', 'done-distance', 'done-gain'].forEach(function (fieldId) {
    var field = document.getElementById(fieldId);
    if (field) field.value = '';
  });
  document.getElementById('done-prompt').classList.remove('hidden');
  var mainEl = document.querySelector('#app main');
  if (mainEl) mainEl.scrollTop = 0;
}

function movePlanned(id, delta) {
  var visible = Lgc.plannedOrder(items);
  var index = -1;
  visible.forEach(function (item, i) { if (item.id === id) index = i; });
  var next = index + delta;
  if (index < 0 || next < 0 || next >= visible.length) return;
  var order = Lgc.plannedOrder(items).map(function (item) { return item.id; });
  var from = order.indexOf(id);
  var to = order.indexOf(visible[next].id);
  if (from < 0 || to < 0) return;
  order.splice(from, 1);
  order.splice(to, 0, id);
  items = Lgc.reorderPlanned(items, order);
  saveItems();
  renderMine();
}

function reorderPlannedTo(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  var order = Lgc.plannedOrder(items).map(function (item) { return item.id; });
  var from = order.indexOf(fromId);
  var to = order.indexOf(toId);
  if (from < 0 || to < 0) return;
  order.splice(from, 1);
  order.splice(to, 0, fromId);
  items = Lgc.reorderPlanned(items, order);
  saveItems();
  renderMine();
}

document.getElementById('done-cancel').addEventListener('click', function () {
  var id = donePromptId;
  donePromptId = '';
  document.getElementById('done-prompt').classList.add('hidden');
  if (id) showPlanDetail(id);
  else showPlanHome();
});

document.getElementById('done-save').addEventListener('click', function () {
  if (!donePromptId) return;
  var id = donePromptId;
  var files = Array.prototype.slice.call(document.getElementById('done-photo').files || []);
  items = Lgc.markDone(items, id, {
    date: document.getElementById('done-date').value,
    notes: document.getElementById('done-note').value,
    routeTaken: document.getElementById('done-route').value,
    partnersWith: document.getElementById('done-partners').value,
    conditions: {
      weather: document.getElementById('done-weather').value,
      snow: document.getElementById('done-snow').value,
      temp: document.getElementById('done-temp').value
    },
    duration: document.getElementById('done-duration').value,
    distance: document.getElementById('done-distance').value,
    elevationGain: document.getElementById('done-gain').value
  });
  saveItems();
  donePromptId = '';
  document.getElementById('done-prompt').classList.add('hidden');
  var saved = files.map(function (file) {
    return downscaleFile(file).then(function (blob) { return Photos.add(id, blob); }).catch(function () { return null; });
  });
  Promise.all(saved).then(function () {
    renderMine();
    selectTab('logbook');
    showMemory(id);
  });
});

// ---- Map ----
function setMapNote(text) {
  var note = document.getElementById('map-note');
  if (note) note.textContent = text;
}

function alreadyPlanned(name) {
  var key = String(name || '').trim().toLowerCase();
  return plannedItems().some(function (item) { return item.name.toLowerCase() === key; });
}

function alreadyLogged(name) {
  var key = String(name || '').trim().toLowerCase();
  return doneItems().some(function (item) { return item.name.toLowerCase() === key; });
}

function addCatalogItem(place) {
  if (alreadyPlanned(place.name)) return null;
  items = items.map(function (item) {
    if (item.status !== 'planned') return item;
    return Object.assign({}, item, { priority: (item.priority || 0) + 1 });
  });
  var entry = Lgc.createLog({
    kind: place.kind || 'peak',
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    elevation: place.elevation,
    notes: place.note || '',
    collectionId: place.collectionId || '',
    status: 'planned',
    priority: 0
  });
  if (!entry) return;
  items.push(entry);
  saveItems();
  renderMine();
  return entry;
}

var toastUndoId = '';
var peakPagePeak = null;
var peakPageStack = [];

function showToast(message, actions) {
  var toast = document.getElementById('plan-toast');
  if (!toast) return;
  var buttons = (actions || []).map(function (action) {
    var button = el('button', { type: 'button', text: action.label });
    button.addEventListener('click', function () {
      hideToast();
      action.run();
    });
    return button;
  });
  toast.replaceChildren(el('p', { text: message }), el('div', { class: 'plan-toast-actions' }, buttons));
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(hideToast, 4200);
}

function hideToast() {
  var toast = document.getElementById('plan-toast');
  if (toast) toast.classList.add('hidden');
}

function undoPlan(id) {
  if (!id) return;
  items = items.filter(function (item) { return item.id !== id; });
  saveItems();
  renderMine();
  if (peakPagePeak) renderPeakPage(peakPagePeak);
  showToast('Removed from your plan', []);
}

function confirmPlan(place, options) {
  options = options || {};
  if (alreadyPlanned(place.name)) {
    showToast(place.name + ' is already in your plan', [{
      label: 'View plan',
      run: function () { openPlanByName(place.name); }
    }]);
    return null;
  }
  if (!options.again && alreadyLogged(place.name)) {
    showToast('You have logged ' + place.name, [{
      label: 'Plan it again',
      run: function () { confirmPlan(place, { again: true, extra: options.extra }); }
    }]);
    return null;
  }
  var entry = addCatalogItem(place);
  if (!entry) return null;
  if (options.extra) entry = patchItem(entry.id, options.extra) || entry;
  toastUndoId = entry.id;
  showToast(place.name + ' added to your plan', [
    { label: 'View plan', run: function () { openPlanByName(place.name); } },
    { label: 'Undo', run: function () { undoPlan(toastUndoId); } }
  ]);
  if (peakPagePeak && Col.normName(peakPagePeak.name) === Col.normName(place.name)) renderPeakPage(peakPagePeak);
  renderExplore();
  return entry;
}

function placeForPeak(peak) {
  return {
    name: peak.name,
    kind: 'peak',
    lat: peak.lat,
    lng: peak.lng,
    elevation: peak.elevation,
    note: '',
    collectionId: collectionData ? collectionData.id : ''
  };
}

function openQuickPlan(place) {
  var sheet = document.getElementById('plan-quick');
  if (!sheet) {
    confirmPlan(place, { again: true });
    return;
  }
  document.getElementById('plan-quick-name').textContent = place.name;
  document.getElementById('plan-quick-stage').value = 'idea';
  document.getElementById('plan-quick-time').value = '';
  sheet.classList.remove('hidden');
  sheet._place = place;
}

function finishQuickPlan(useFields) {
  var sheet = document.getElementById('plan-quick');
  var place = sheet && sheet._place;
  if (sheet) sheet.classList.add('hidden');
  if (!place) return;
  var extra = {};
  if (useFields) {
    extra.stage = document.getElementById('plan-quick-stage').value;
    extra.stageManual = true;
    extra.timeframe = document.getElementById('plan-quick-time').value;
    extra.planDates = extra.timeframe;
  }
  confirmPlan(place, { again: true, extra: extra });
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
        text: 'Add to plan'
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
  var button = el('button', { type: 'button', text: 'Add to plan' });
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
  if (!map) return;
  areaLayers.forEach(function (layer) {
    if (layer.circle) map.removeLayer(layer.circle);
  });
  areaLayers = [];
  if (map.closePopup) map.closePopup();
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

var mapExpanded = false;
var mapHistoryPushed = false;
var sheetHistoryPushed = false;
var mapHistoryLock = false;
var suppressMapClick = false;
var mapAnimating = false;
var MAP_MS = 380;
var MAP_EASE = 'cubic-bezier(0.22, 1.18, 0.36, 1)';

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function mapBox() {
  return document.getElementById('map-scaler');
}

function embeddedMapHeight() {
  var mainEl = document.querySelector('#app main');
  if (!mainEl) return 320;
  var padTop = parseFloat(getComputedStyle(mainEl).paddingTop) || 0;
  return Math.max(180, Math.floor(mainEl.clientHeight - padTop) - 2);
}

function showSpacer(height) {
  var spacer = document.getElementById('map-spacer');
  if (!spacer) return;
  spacer.style.height = height + 'px';
  spacer.hidden = false;
}

function hideSpacer() {
  var spacer = document.getElementById('map-spacer');
  if (!spacer) return;
  spacer.hidden = true;
  spacer.style.height = '';
}

function clearMotion(container) {
  container.style.transition = '';
  container.style.transform = '';
  container.style.transformOrigin = '';
  container.style.borderRadius = '';
  container.style.willChange = '';
  container.style.opacity = '';
}

function settleTiles() {
  var root = document.documentElement;
  root.classList.add('map-resizing');
  sizeFullMap();
  if (map) {
    map.invalidateSize({ animate: false, pan: false });
    if (map._keptCenter) map.setView(map._keptCenter, map._keptZoom, { animate: false });
  }
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { root.classList.remove('map-resizing'); });
  });
}

function playTransform(container, next, done) {
  mapAnimating = true;
  var finished = false;
  function finish(event) {
    if (finished) return;
    if (event && event.target !== container) return;
    if (event && event.propertyName !== 'transform') return;
    finished = true;
    container.removeEventListener('transitionend', finish);
    done();
  }
  container.addEventListener('transitionend', finish);
  setTimeout(function () { finish(); }, MAP_MS + 80);
  var computed = getComputedStyle(container).transform;
  container.style.transformOrigin = '0 0';
  container.style.willChange = 'transform';
  container.style.transition = 'none';
  if (computed && computed !== 'none') container.style.transform = computed;
  container.getBoundingClientRect();
  container.style.transition = 'transform ' + MAP_MS + 'ms ' + MAP_EASE + ', border-radius ' + MAP_MS + 'ms ' + MAP_EASE;
  container.style.transform = next;
}

function viewRect() {
  var view = window.visualViewport;
  if (!view) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  return { left: view.offsetLeft, top: view.offsetTop, width: view.width, height: view.height };
}

function growTransform(rect) {
  var view = viewRect();
  var scaleX = view.width / Math.max(1, rect.width);
  var scaleY = view.height / Math.max(1, rect.height);
  return 'translate(' + (view.left - rect.left) + 'px,' + (view.top - rect.top) + 'px) scale(' + scaleX + ',' + scaleY + ')';
}

function shrinkTransform(rect) {
  var view = viewRect();
  var scaleX = rect.width / Math.max(1, view.width);
  var scaleY = rect.height / Math.max(1, view.height);
  return 'translate(' + (rect.left - view.left) + 'px,' + (rect.top - view.top) + 'px) scale(' + scaleX + ',' + scaleY + ')';
}

function showMapStatus(text) {
  var status = document.getElementById('map-status');
  if (!status) return;
  status.textContent = text;
  status.classList.remove('hidden');
  setTimeout(function () { status.classList.add('hidden'); }, 3200);
}

function mapSheetOpen() {
  var root = document.documentElement;
  return root.classList.contains('map-show-peak') || root.classList.contains('map-show-layers') || root.classList.contains('map-show-collections');
}

function showMapSheet(name, fromPop) {
  var root = document.documentElement;
  var wasOpen = mapSheetOpen();
  ['layers', 'collections', 'peak'].forEach(function (sheet) {
    root.classList.toggle('map-show-' + sheet, sheet === name);
  });
  if (!name) {
    root.classList.remove('map-sheet-tall');
    var detail = document.getElementById('peak-detail');
    if (detail && root.classList.contains('map-expanded')) detail.classList.add('hidden');
    clearSheetMotion();
    if (!fromPop && sheetHistoryPushed) {
      sheetHistoryPushed = false;
      try { history.back(); } catch (err) { sheetHistoryPushed = false; }
      return;
    }
    sheetHistoryPushed = false;
    return;
  }
  if (!wasOpen && !sheetHistoryPushed && root.classList.contains('map-expanded')) {
    try {
      history.pushState({ summitlogMap: true, summitlogSheet: true }, '');
      sheetHistoryPushed = true;
    } catch (err) {
      sheetHistoryPushed = false;
    }
  }
}

function requestCloseSheet() {
  if (document.documentElement.classList.contains('explore-map') && sheetMode === 'peak') {
    closeExplorePeak(false);
    return;
  }
  if (mapSheetOpen()) {
    showMapSheet('', false);
    return;
  }
  var detail = document.getElementById('peak-detail');
  if (detail && !document.documentElement.classList.contains('explore-map')) detail.classList.add('hidden');
}

function clearSheetMotion() {
  var detail = document.getElementById('peak-detail');
  if (!detail) return;
  detail.style.transition = '';
  detail.style.transform = '';
}

function sheetMotionOff() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setMapGestures(enabled) {
  if (!map) return;
  var names = ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom', 'boxZoom', 'keyboard'];
  names.forEach(function (name) {
    if (!map[name]) return;
    if (enabled) map[name].enable();
    else map[name].disable();
  });
}

function pushMapHistory() {
  try {
    history.pushState({ summitlogMap: true }, '');
    mapHistoryPushed = true;
  } catch (err) {
    mapHistoryPushed = false;
  }
}

function popMapHistory(fromPop) {
  if (!fromPop && mapHistoryPushed) {
    mapHistoryPushed = false;
    history.back();
  } else {
    mapHistoryPushed = false;
  }
}

function coverMap(container, height) {
  showSpacer(height);
  document.documentElement.classList.add('map-cover');
  document.getElementById('map-container').style.height = '';
  clearMotion(container);
  sizeFullMap();
}

function sizeFullMap() {
  var vv = window.visualViewport;
  var root = document.documentElement;
  if (!vv) return;
  root.style.setProperty('--vv-top', vv.offsetTop + 'px');
  root.style.setProperty('--vv-left', vv.offsetLeft + 'px');
  root.style.setProperty('--vv-width', vv.width + 'px');
  root.style.setProperty('--vv-height', vv.height + 'px');
  if (root.classList.contains('explore-map')) {
    var app = document.getElementById('app');
    if (app) {
      app.style.marginTop = vv.offsetTop + 'px';
      app.style.height = vv.height + 'px';
    }
    if (map) map.invalidateSize({ animate: false, pan: false });
    return;
  }
  if (root.classList.contains('map-cover') && map) map.invalidateSize({ animate: false, pan: false });
}

function sizeExploreMap() {
  sizeFullMap();
  applySheetSnap(false);
}

function bindViewport() {
  if (!window.visualViewport || window.visualViewport.__summitBound) return;
  window.visualViewport.__summitBound = true;
  window.visualViewport.addEventListener('resize', sizeFullMap);
  window.visualViewport.addEventListener('scroll', sizeFullMap);
}

function expandMap() {
  if (mapExpanded || mapAnimating) return;
  var container = mapBox();
  if (!container) return;
  var first = container.getBoundingClientRect();
  var root = document.documentElement;
  mapExpanded = true;
  if (map) {
    map._keptCenter = map.getCenter();
    map._keptZoom = map.getZoom();
  }
  root.classList.add('map-expanded');
  pushMapHistory();
  if (prefersReducedMotion()) {
    coverMap(container, first.height);
    root.classList.add('map-settled');
    container.style.opacity = '0';
    container.getBoundingClientRect();
    container.style.transition = 'opacity 180ms linear';
    container.style.opacity = '1';
    setTimeout(function () {
      container.style.transition = '';
      container.style.opacity = '';
      settleTiles();
      setMapGestures(true);
    }, 190);
    return;
  }
  container.style.borderRadius = '0px';
  playTransform(container, growTransform(first), function () {
    if (!mapExpanded) return;
    coverMap(container, first.height);
    root.classList.add('map-settled');
    mapAnimating = false;
    settleTiles();
    setMapGestures(true);
  });
}

function collapseMap(fromPop) {
  if (mapHistoryLock) return;
  if (!mapExpanded && !mapAnimating) return;
  var container = mapBox();
  var root = document.documentElement;
  var covered = root.classList.contains('map-cover');
  var steps = 0;
  if (!fromPop && sheetHistoryPushed) steps += 1;
  if (!fromPop && mapHistoryPushed) steps += 1;
  sheetHistoryPushed = false;
  mapExpanded = false;
  root.classList.remove('map-settled', 'map-show-layers', 'map-show-collections', 'map-show-peak', 'map-sheet-tall');
  clearSheetMotion();
  setMapGestures(false);
  if (fromPop) {
    mapHistoryPushed = false;
  } else if (steps) {
    mapHistoryPushed = false;
    mapHistoryLock = true;
    try { history.go(-steps); } catch (err) { mapHistoryLock = false; }
  }
  if (!container) return;
  if (prefersReducedMotion()) {
    root.classList.remove('map-expanded', 'map-cover');
    clearMotion(container);
    hideSpacer();
    mapAnimating = false;
    fitMap();
    settleTiles();
    return;
  }
  if (!covered) {
    root.classList.remove('map-expanded');
    container.style.borderRadius = '';
    playTransform(container, 'translate(0px, 0px) scale(1, 1)', function () {
      clearMotion(container);
      mapAnimating = false;
    });
    return;
  }
  root.classList.remove('map-expanded');
  var spacer = document.getElementById('map-spacer');
  var target = spacer ? spacer.getBoundingClientRect() : container.getBoundingClientRect();
  container.style.borderRadius = '12px';
  playTransform(container, shrinkTransform(target), function () {
    root.classList.remove('map-cover');
    clearMotion(container);
    hideSpacer();
    mapAnimating = false;
    fitMap();
    settleTiles();
  });
}

function bindMapHandle() {
  var handle = document.getElementById('map-handle');
  if (!handle) return;
  var swipe = null;
  handle.addEventListener('pointerdown', function (event) {
    if (!mapExpanded || mapAnimating || !document.documentElement.classList.contains('map-settled')) return;
    swipe = { id: event.pointerId, y: event.clientY, lastY: event.clientY, lastT: Date.now(), dy: 0, vy: 0 };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', function (event) {
    if (!swipe || event.pointerId !== swipe.id) return;
    var now = Date.now();
    swipe.vy = (event.clientY - swipe.lastY) / Math.max(1, now - swipe.lastT);
    swipe.lastY = event.clientY;
    swipe.lastT = now;
    swipe.dy = Math.max(0, event.clientY - swipe.y);
    var container = mapBox();
    container.style.transition = 'none';
    container.style.transform = 'translateY(' + swipe.dy + 'px)';
  });
  function endSwipe(event) {
    if (!swipe || event.pointerId !== swipe.id) return;
    var dy = swipe.dy;
    var vy = swipe.vy;
    swipe = null;
    if (dy > 96 || vy > 0.65) {
      collapseMap(false);
      return;
    }
    var container = mapBox();
    container.style.transition = 'transform 280ms ' + MAP_EASE;
    container.style.transform = 'translateY(0px)';
    container.addEventListener('transitionend', function clear(ev) {
      if (ev.propertyName !== 'transform') return;
      container.removeEventListener('transitionend', clear);
      container.style.transition = '';
      container.style.transform = '';
    });
  }
  handle.addEventListener('pointerup', endSwipe);
  handle.addEventListener('pointercancel', endSwipe);
}

function initMap() {
  if (typeof L === 'undefined') {
    showMapFallback();
    return;
  }
  try {
    if (!map) {
      configureMarkerIcons();
      map = L.map('map-container', {
        zoomControl: false,
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false
      }).setView([46.5, 8.5], 6);
      L.control.zoom({ position: 'topright' }).addTo(map);
      mutedTiles().addTo(map);
      map.on('locationerror', function () {
        showMapStatus('Location is unavailable on this device.');
      });
      map.on('zoomend moveend', function () { updateMapMarkers(); });
      map.on('click', function () {
        if (suppressMapClick) {
          suppressMapClick = false;
          return;
        }
        if (sheetMode === 'peak' || mapSheetOpen()) requestCloseSheet();
      });
      var mapTap = null;
      var mapEl = document.getElementById('map-container');
      mapEl.addEventListener('pointerdown', function (event) {
        if (event.target.closest && event.target.closest('.leaflet-control, .leaflet-marker-icon, .photo-pin, .pin-dot, .pin-cluster')) return;
        mapTap = { id: event.pointerId, x: event.clientX, y: event.clientY, t: Date.now() };
      });
      mapEl.addEventListener('pointerup', function (event) {
        if (!mapTap || event.pointerId !== mapTap.id) return;
        var dx = event.clientX - mapTap.x;
        var dy = event.clientY - mapTap.y;
        mapTap = null;
        if (dx * dx + dy * dy > 64) return;
        if (sheetMode === 'peak' || mapSheetOpen()) requestCloseSheet();
      });
      mapEl.addEventListener('pointercancel', function () { mapTap = null; });
      syncAreas();
    }
    updateMapMarkers();
    setTimeout(function () { if (map) map.invalidateSize(); }, 100);
  } catch (err) {
    showMapFallback();
  }
}

function mutedTiles() {
  return L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap, &copy; OpenTopoMap (CC-BY-SA)',
    subdomains: 'abc',
    maxZoom: 17,
    errorTileUrl: 'icons/tile-offline.svg'
  });
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

var mapFilter = 'all';
var mapQuery = '';

function featureMatchesQuery(name) {
  if (!mapQuery) return true;
  var folded = Partners.fold(mapQuery);
  return Partners.fold(name).indexOf(folded) >= 0 || Col.normName(name).indexOf(folded) >= 0;
}

function mapFeatures() {
  var list = [];
  var active = activeCollectionRecord();
  var showPeaks = mapFilter === 'all' || mapFilter === '4000' || mapFilter === 'planned' || mapFilter === 'done';
  var showTreks = mapFilter === 'all' || mapFilter === 'treks';
  if (active && active.kind === 'treks') {
    showPeaks = false;
    showTreks = true;
  } else if (active && active.peaks) {
    showTreks = false;
    active.peaks.forEach(function (peak) {
      if (!featureMatchesQuery(peak.name)) return;
      var planned = alreadyPlanned(peak.name);
      var done = Col.isSummited(peak, doneItems());
      if (mapFilter === 'planned' && !planned) return;
      if (mapFilter === 'done' && !done) return;
      list.push({ type: 'peak', name: peak.name, lat: peak.lat, lng: peak.lng, peak: peak, planned: planned, done: done });
    });
    return list.filter(function (feature) { return Number.isFinite(feature.lat) && Number.isFinite(feature.lng); });
  }
  if (showPeaks && collectionData) {
    var pool = mapFilter === '4000' ? collectionData.peaks : dedupedMapPeaks();
    pool.forEach(function (peak) {
      if (!featureMatchesQuery(peak.name)) return;
      var planned = alreadyPlanned(peak.name);
      var done = Col.isSummited(peak, doneItems());
      if (mapFilter === 'planned' && !planned) return;
      if (mapFilter === 'done' && !done) return;
      list.push({ type: 'peak', name: peak.name, lat: peak.lat, lng: peak.lng, peak: peak, planned: planned, done: done });
    });
  }
  if (showPeaks && mapFilter !== '4000') {
    plannedItems().concat(doneItems()).forEach(function (item) {
      if (!Lgc.hasCoords(item) || collectionPeakByName(item)) return;
      if (!featureMatchesQuery(item.name)) return;
      var planned = item.status === 'planned';
      if (mapFilter === 'planned' && !planned) return;
      if (mapFilter === 'done' && planned) return;
      list.push({ type: 'item', name: item.name, lat: item.lat, lng: item.lng, item: item, planned: planned, done: !planned });
    });
  }
  if (showTreks) {
    Lgc.FAMOUS.forEach(function (place) {
      if (place.kind !== 'hike' || !featureMatchesQuery(place.name)) return;
      list.push({ type: 'trek', name: place.name, lat: place.lat, lng: place.lng, place: place });
    });
  }
  if (showPeaks && document.getElementById('osm-layer') && document.getElementById('osm-layer').checked) {
    osmMarkers.forEach(function (place) {
      if (!featureMatchesQuery(place.name)) return;
      list.push({ type: 'osm', name: place.name, lat: place.lat, lng: place.lng, place: place });
    });
  }
  return list.filter(function (feature) { return Number.isFinite(feature.lat) && Number.isFinite(feature.lng); });
}

function featuresInView(features) {
  if (!map) return features;
  var bounds = map.getBounds();
  return features.filter(function (feature) {
    return bounds.contains([feature.lat, feature.lng]);
  });
}

function safePhotoUrl(url) {
  return typeof url === 'string' && /^https:\/\/(thumb|upload)\.wikimedia\.org\//.test(url) ? url : '';
}

function markerClass(feature) {
  if (feature.type === 'trek') return ' is-trek';
  if (feature.done) return ' is-done';
  if (feature.planned) return ' is-planned';
  return '';
}

function photoFace(feature) {
  var photo = feature.peak ? photoRecord(feature.peak) : (feature.type === 'trek' ? peakPhotos['place:' + feature.name] : null);
  var src = safePhotoUrl(photo && photo.thumb);
  if (!src) return '<span class="pin-face"></span>';
  return '<span class="pin-face" style="background-image:url(\'' + src.replace(/'/g, '') + '\')"></span>';
}

function openFeature(feature) {
  if (feature.type === 'peak') showPeakDetail(feature.peak);
  else if (feature.type === 'trek') showTrailSheet(feature.place);
  else if (feature.item) showMemoryOrPlan(feature.item);
  else if (feature.place) showTrailSheet(feature.place);
}

function showMemoryOrPlan(item) {
  if (item.status === 'planned') {
    selectTab('plan');
    showPlanDetail(item.id);
    return;
  }
  selectTab('logbook');
  showMemory(item.id);
}

var liveMarkers = {};
var appliedQuery = '';
var appliedFilter = 'all';

function addDivMarker(lat, lng, icon, onClick, key, animateIn) {
  var marker = L.marker([lat, lng], { icon: icon, keyboard: false });
  marker.on('click', function (event) {
    suppressMapClick = true;
    if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
    onClick();
  });
  marker.addTo(map);
  liveMarkers[key] = marker;
  markers.push(marker);
  syncMarkerState(marker, icon && icon.options && icon.options.className);
  var node = marker.getElement();
  if (node && animateIn && !prefersReducedMotion()) {
    node.classList.add('pin-enter');
    requestAnimationFrame(function () { node.classList.add('pin-in'); });
  }
  return marker;
}

function retireMarker(key, animateOut) {
  var marker = liveMarkers[key];
  if (!marker) return;
  delete liveMarkers[key];
  var node = marker.getElement();
  if (node && animateOut && !prefersReducedMotion()) {
    node.classList.add('pin-leave');
    setTimeout(function () {
      if (map && marker) map.removeLayer(marker);
    }, 220);
    return;
  }
  if (map) map.removeLayer(marker);
}

function updateMapSummary(count, noun) {
  var summary = document.getElementById('map-summary');
  if (!summary) return;
  var label = count === 1 ? noun.replace(/s$/, '') : noun;
  summary.textContent = count + ' ' + label + ' in view';
}

function featureKey(feature) {
  if (feature.peak && feature.peak.id) return 'peak:' + feature.peak.id;
  return feature.type + ':' + feature.name;
}

function markerSpecs() {
  var features = mapFeatures();
  var visible = featuresInView(features);
  var peakCount = visible.filter(function (feature) { return feature.type !== 'trek'; }).length;
  var trailCount = visible.filter(function (feature) { return feature.type === 'trek'; }).length;
  if (mapFilter === 'treks') updateMapSummary(trailCount, 'trails');
  else updateMapSummary(peakCount, 'peaks');
  var zoom = map.getZoom();
  var source = zoom <= 6 ? (visible.length ? visible : features) : visible;
  var specs = [];
  if (zoom <= 6) {
    var cell = zoom <= 5 ? 1.4 : 0.7;
    var groups = {};
    source.forEach(function (feature) {
      var bucket = Math.floor(feature.lat / cell) + ':' + Math.floor(feature.lng / cell);
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(feature);
    });
    Object.keys(groups).forEach(function (bucket) {
      var group = groups[bucket];
      var lat = 0;
      var lng = 0;
      group.forEach(function (feature) { lat += feature.lat; lng += feature.lng; });
      lat /= group.length;
      lng /= group.length;
      if (group.length === 1) {
        specs.push(dotSpec(group[0], lat, lng, 'dot:' + featureKey(group[0])));
        return;
      }
      var clusterPeaks = group.filter(function (feature) { return feature.type !== 'trek'; });
      var clusterDone = clusterPeaks.length > 0 && clusterPeaks.every(function (feature) { return feature.done; });
      specs.push({
        key: 'cluster:' + bucket + ':' + group.length,
        lat: lat,
        lng: lng,
        icon: L.divIcon({
          className: 'pin-cluster' + (clusterDone ? ' is-done' : ''),
          html: '<span>' + group.length + '</span>',
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        }),
        onClick: function () {
          var bounds = L.latLngBounds(group.map(function (feature) { return [feature.lat, feature.lng]; }));
          map.fitBounds(bounds.pad(0.4), { maxZoom: zoom + 3 });
        }
      });
    });
    return specs;
  }
  source.forEach(function (feature) {
    if (zoom < 8 || feature.type === 'osm') {
      specs.push(dotSpec(feature, feature.lat, feature.lng, 'dot:' + featureKey(feature)));
      return;
    }
    specs.push({
      key: 'photo:' + featureKey(feature),
      lat: feature.lat,
      lng: feature.lng,
      icon: L.divIcon({
        className: 'photo-pin' + markerClass(feature),
        html: photoFace(feature),
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      }),
      onClick: function () { openFeature(feature); }
    });
  });
  return specs;
}

function dotSpec(feature, lat, lng, key) {
  return {
    key: key,
    lat: lat,
    lng: lng,
    icon: L.divIcon({
      className: 'pin-dot' + markerClass(feature),
      html: '<span></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    }),
    onClick: function () { openFeature(feature); }
  };
}

function syncMarkerState(marker, className) {
  var node = marker && marker.getElement ? marker.getElement() : marker;
  if (!node) return;
  var names = String(className || '').split(/\s+/);
  var done = names.indexOf('is-done') >= 0;
  ['is-done', 'is-planned', 'is-trek'].forEach(function (name) {
    node.classList.toggle(name, names.indexOf(name) >= 0);
  });
  node.classList.remove('pin-leave');
  if (marker && marker.setZIndexOffset) marker.setZIndexOffset(done ? 800 : 0);
}

function updateMapMarkers() {
  if (!map) return;
  var animate = mapQuery !== appliedQuery || mapFilter !== appliedFilter;
  appliedQuery = mapQuery;
  appliedFilter = mapFilter;
  var specs = markerSpecs();
  var wanted = {};
  specs.forEach(function (spec) { wanted[spec.key] = spec; });
  Object.keys(liveMarkers).forEach(function (key) {
    if (!wanted[key]) retireMarker(key, animate);
  });
  specs.forEach(function (spec) {
    var existing = liveMarkers[spec.key];
    if (existing) {
      existing.setLatLng([spec.lat, spec.lng]);
      syncMarkerState(existing, spec.icon && spec.icon.options && spec.icon.options.className);
      return;
    }
    addDivMarker(spec.lat, spec.lng, spec.icon, spec.onClick, spec.key, animate);
  });
  markers = Object.keys(liveMarkers).map(function (key) { return liveMarkers[key]; });
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

// ---- Partner queues ----
var AVATAR_COLORS = ['#1e3a5f', '#3f2d12', '#1f3d32', '#3b1d3a', '#243044', '#3a2a1b'];

function rebuildObjectives() {
  objectiveCatalog = Partners.buildCatalog({
    peaks: dedupedMapPeaks(),
    famous: Lgc.FAMOUS,
    logs: doneItems(),
    backlog: plannedItems(),
    region: collectionData ? collectionData.region : 'Alps'
  });
}

function refreshActiveObjective() {
  if (!activeObjective) {
    renderSuggestions();
    return;
  }
  var next = null;
  var want = Partners.fold(activeObjective.name);
  objectiveCatalog.forEach(function (objective) {
    if (Partners.fold(objective.name) === want) next = objective;
  });
  if (next) activeObjective = next;
  renderSuggestions();
  if (!document.getElementById('objective-page').classList.contains('hidden')) renderObjective();
}

function avatarNode(initials, key) {
  var index = 0;
  String(key || '').split('').forEach(function (ch) { index += ch.charCodeAt(0); });
  return el('span', {
    class: 'avatar',
    'aria-hidden': 'true',
    style: 'background:' + AVATAR_COLORS[index % AVATAR_COLORS.length],
    text: initials || '?'
  });
}

function showPartnerSearch() {
  activePerson = null;
  joinFormOpen = false;
  partnerReturn = 'search';
  showPartnerFlow();
  document.getElementById('partner-home').classList.remove('hidden');
  var find = document.getElementById('partner-find');
  if (find) find.classList.remove('hidden');
  document.getElementById('objective-page').classList.add('hidden');
  document.getElementById('partner-profile').classList.add('hidden');
  var panel = document.getElementById('messages-panel');
  var chat = document.getElementById('chat-screen');
  var shared = document.getElementById('shared-plan-view');
  if (panel) panel.classList.remove('hidden');
  if (chat) chat.classList.add('hidden');
  if (shared) shared.classList.add('hidden');
  if (window.SummitChat) {
    if (window.SummitAccount && SummitAccount.user()) SummitChat.refresh();
    else SummitChat.renderInbox();
  }
  renderSuggestions();
}

function showObjective(objective) {
  if (!objective) return;
  activeObjective = objective;
  activePerson = null;
  joinFormOpen = false;
  showPartnerFlow();
  document.getElementById('partner-home').classList.add('hidden');
  document.getElementById('objective-page').classList.remove('hidden');
  document.getElementById('partner-profile').classList.add('hidden');
  var panel = document.getElementById('messages-panel');
  if (panel) panel.classList.add('hidden');
  renderObjective();
  var mainEl = document.querySelector('#app main');
  if (mainEl) mainEl.scrollTop = 0;
}

function renderSuggestions() {
  var input = document.getElementById('objective-query');
  var list = document.getElementById('objective-suggestions');
  if (!input || !list) return;
  var matches = Partners.searchObjectives(objectiveCatalog, input.value, 8);
  suggestionIndex = matches.length ? 0 : -1;
  input.setAttribute('aria-expanded', matches.length ? 'true' : 'false');
  if (!matches.length) {
    list.replaceChildren();
    return;
  }
  list.replaceChildren.apply(list, matches.map(function (objective, index) {
    var button = el('button', {
      type: 'button',
      role: 'option',
      id: 'objective-option-' + index,
      'data-objective': objective.id,
      'aria-selected': index === 0 ? 'true' : 'false'
    },
      el('span', { class: 'suggestion-top' },
        el('span', { class: 'suggestion-name', text: objective.name }),
        el('span', { class: 'badge', text: Partners.kindLabel(objective.kind) })
      ),
      el('span', { class: 'suggestion-meta' },
        el('span', { text: Partners.detailLine(objective) }),
        el('span', { text: objective.range || '' })
      )
    );
    return el('li', null, button);
  }));
}

function openSuggestion(id) {
  var found = null;
  objectiveCatalog.forEach(function (objective) {
    if (objective.id === id) found = objective;
  });
  if (found) showObjective(found);
}

function yourLevelText() {
  var saved = Store.getLevel();
  var level = Col.estimateLevel(doneItems(), collectionData ? collectionData.peaks : [], saved);
  var bits = [];
  if (level.grade) bits.push(level.grade);
  if (level.elevation != null) bits.push(level.elevation + ' m');
  if (level.glacier === true) bits.push('glacier');
  return bits.length ? 'From your log: ' + bits.join(' · ') : '';
}

function yourInitials() {
  var name = (currentUser || '').trim();
  if (!name) return 'You';
  var parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function sharedLogLine(log) {
  return log.name + ' · ' + Partners.kindLabel(log.kind) + (log.detail ? ' · ' + log.detail : '');
}

function yourSharedLogs(membership) {
  return (membership.attachedIds || []).map(function (id) {
    var item = null;
    doneItems().forEach(function (entry) { if (entry.id === id) item = entry; });
    if (!item) return null;
    return { name: item.name, kind: item.kind, detail: itemSummary(item) };
  }).filter(Boolean);
}

function personCard(person) {
  var shared = person.logs && person.logs.length
    ? person.logs.map(function (log) { return log.name; }).join(', ')
    : '';
  var button = el('button', { class: 'queue-person', type: 'button', 'data-person': person.id },
    avatarNode(person.initials, person.id),
    el('span', { class: 'queue-copy' },
      el('span', { class: 'suggestion-top' },
        el('span', { class: 'suggestion-name', text: person.name }),
        el('span', {
          class: person.demo ? 'badge demo-badge' : (person.account ? 'badge account-badge' : 'badge device-badge'),
          text: person.demo ? 'Demo' : (person.account ? 'Signed in' : 'Only on this device')
        })
      ),
      person.level ? el('span', { class: 'queue-level', text: person.level }) : null,
      person.dates ? el('span', { class: 'queue-dates', text: person.dates }) : null,
      person.note ? el('span', { class: 'queue-note', text: person.note }) : null,
      el('span', { class: 'queue-shared', text: shared ? 'Shared logs: ' + shared : 'No logs shared' })
    )
  );
  return button;
}

function personRow(person, onCard) {
  var card = personCard(person);
  if (onCard) card.addEventListener('click', function (event) {
    if (event.target && event.target.closest && event.target.closest('.partner-actions')) return;
    onCard();
  });
  var extra = window.SummitChat && SummitChat.actionsForPerson ? SummitChat.actionsForPerson(person) : null;
  if (!extra) return card;
  return el('div', { class: 'queue-row' }, card, extra);
}

function accountHint() {
  return el('p', {
    class: 'account-hint',
    text: 'Sign in to be visible to others. Joining a queue for real requires an account. Your place is saved on this device for now.'
  });
}

function renderJoinPanel(membership) {
  var panel = document.getElementById('join-panel');
  if (membership && !joinFormOpen) {
    panel.replaceChildren(
      el('div', { class: 'join-actions' },
        el('button', { class: 'secondary', type: 'button', id: 'edit-queue', text: 'Edit your place' }),
        el('button', { class: 'danger', type: 'button', id: 'leave-queue', text: 'Leave the queue' })
      ),
      accountHint()
    );
    return;
  }
  if (!joinFormOpen) {
    panel.replaceChildren(
      el('button', { class: 'primary btn-block', type: 'button', id: 'join-queue', text: 'Join the queue' }),
      accountHint()
    );
    return;
  }
  var selected = {};
  (membership && membership.attachedIds || []).forEach(function (id) { selected[id] = true; });
  var choices = doneItems().length
    ? doneItems().slice().reverse().map(function (item) {
      var input = el('input', { type: 'checkbox', value: item.id });
      input.checked = !!selected[item.id];
      return el('label', { class: 'check-row' }, input, el('span', { text: item.name + ' · ' + kindLabel(item.kind) }));
    })
    : [el('p', { class: 'muted', text: 'No log entries to attach. Nothing is shared until you tick one.' })];
  var dates = el('input', {
    type: 'text',
    id: 'join-dates',
    maxlength: '120',
    placeholder: 'Preferred dates or period (optional)',
    'aria-label': 'Preferred dates or period'
  });
  dates.value = membership ? membership.dates : '';
  var note = el('textarea', {
    id: 'join-note',
    rows: '2',
    maxlength: '400',
    placeholder: 'Short note (optional)',
    'aria-label': 'Short note'
  });
  note.value = membership ? membership.note : '';
  panel.replaceChildren(
    el('h3', { text: membership ? 'Edit your place' : 'Join the queue' }),
    dates,
    note,
    el('div', { id: 'join-logs' },
      el('p', { class: 'muted', text: 'Choose logs to share. None are included until you tick them.' }),
      choices
    ),
    el('div', { class: 'join-actions' },
      el('button', { class: 'primary', type: 'button', id: 'join-save', text: membership ? 'Save' : 'Join the queue' }),
      el('button', { class: 'secondary', type: 'button', id: 'join-cancel', text: 'Cancel' })
    ),
    accountHint()
  );
}

function queuePeopleFor(objective) {
  if (!objective) return [];
  var people = [];
  var membership = Partners.membershipFor(objective, memberships);
  if (membership) {
    people.push({
      id: 'you',
      demo: false,
      name: currentUser || 'You',
      initials: yourInitials(),
      level: yourLevelText(),
      dates: membership.dates,
      note: membership.note,
      logs: yourSharedLogs(membership)
    });
  }
  Partners.demoQueue(objective).forEach(function (person) { people.push(person); });
  if (window.SummitChat && SummitChat.peopleFor) {
    SummitChat.peopleFor(objective).forEach(function (person) { people.push(person); });
  }
  return people;
}

function renderObjective() {
  if (!activeObjective) return;
  var head = document.getElementById('objective-head');
  head.replaceChildren(
    el('h2', { text: activeObjective.name }),
    el('p', { class: 'objective-meta' },
      el('span', { class: 'badge', text: Partners.kindLabel(activeObjective.kind) }),
      el('span', { text: Partners.detailLine(activeObjective) }),
      activeObjective.range ? el('span', { text: activeObjective.range }) : null
    )
  );
  var people = queuePeopleFor(activeObjective);
  var membership = Partners.membershipFor(activeObjective, memberships);
  var list = document.getElementById('queue-list');
  if (!people.length) {
    list.replaceChildren(el('p', { class: 'muted', text: 'No one is in this queue yet.' }));
  } else {
    list.replaceChildren.apply(list, people.map(function (person) { return personRow(person); }));
  }
  renderJoinPanel(membership);
  if (window.SummitChat && SummitChat.prefetchQueue) {
    SummitChat.prefetchQueue(activeObjective, function () {
      if (joinFormOpen) return;
      if (document.getElementById('objective-page').classList.contains('hidden')) return;
      renderObjective();
    });
  }
}

function showPerson(person) {
  if (!person) return;
  activePerson = person;
  document.getElementById('objective-page').classList.add('hidden');
  document.getElementById('partner-profile').classList.remove('hidden');
  var panel = document.getElementById('messages-panel');
  if (panel) panel.classList.add('hidden');
  var logsBox = person.logs && person.logs.length
    ? person.logs.map(function (log) {
      return el('div', { class: 'card shared-log' },
        el('h3', { text: log.name }),
        el('p', { class: 'entry-meta', text: Partners.kindLabel(log.kind) + (log.detail ? ' · ' + log.detail : '') })
      );
    })
    : [el('p', { class: 'muted', text: person.demo ? 'No logs shared.' : 'You have not attached any logs.' })];
  fill(document.getElementById('partner-profile-body'), [
    el('div', { class: 'profile-head' },
      avatarNode(person.initials, person.id),
      el('div', null,
        el('h2', { text: person.name }),
        el('span', {
          class: person.demo ? 'badge demo-badge' : (person.account ? 'badge account-badge' : 'badge device-badge'),
          text: person.demo ? 'Demo' : (person.account ? 'Signed in' : 'Only on this device')
        })
      )
    ),
    el('p', {
      class: 'muted',
      text: person.account
        ? 'Signed-in climber. A chat opens only after they accept a partner request. Private notes are not shown.'
        : (person.demo
          ? 'Sample profile. Not a real person. Only the logs chosen for this objective are shown.'
          : 'This place is on your device. Other people cannot see it until you have an account.')
    }),
    person.level ? el('p', { text: person.level }) : null,
    person.dates ? el('p', { class: 'queue-dates', text: person.dates }) : null,
    person.note ? el('p', { class: 'queue-note', text: person.note }) : null,
    el('h3', { text: person.demo ? 'Logs they chose to share' : 'Logs you chose to share' }),
    el('div', { class: 'shared-logs' }, logsBox),
    window.SummitChat && SummitChat.actionsForPerson ? SummitChat.actionsForPerson(person) : null,
    person.account && window.SummitProfile ? (function () {
      var view = el('button', { class: 'secondary', type: 'button', text: 'View profile' });
      view.addEventListener('click', function () {
        selectTab('profile');
        SummitProfile.openOther(person);
      });
      return view;
    })() : null,
    person.demo || person.account ? null : accountHint()
  ]);
  var mainEl = document.querySelector('#app main');
  if (mainEl) mainEl.scrollTop = 0;
}

function personFromQueue(id) {
  if (window.SummitChat && SummitChat.personById) {
    var remote = SummitChat.personById(id);
    if (remote) return remote;
  }
  if (id === 'you') {
    var membership = Partners.membershipFor(activeObjective, memberships);
    if (!membership) return null;
    return {
      id: 'you',
      demo: false,
      name: currentUser || 'You',
      initials: yourInitials(),
      level: yourLevelText(),
      dates: membership.dates,
      note: membership.note,
      logs: yourSharedLogs(membership)
    };
  }
  var found = null;
  Partners.demoQueue(activeObjective).forEach(function (person) {
    if (person.id === id) found = person;
  });
  return found;
}

function checkedLogIds() {
  return Array.prototype.map.call(
    document.querySelectorAll('#join-logs input:checked'),
    function (input) { return input.value; }
  );
}

function saveQueuePlace() {
  if (!activeObjective) return;
  memberships = Store.saveMemberships(Partners.upsertMembership(memberships, {
    objectiveId: activeObjective.id,
    objectiveName: activeObjective.name,
    dates: document.getElementById('join-dates').value,
    note: document.getElementById('join-note').value,
    attachedIds: checkedLogIds()
  }, { now: new Date().toISOString(), mint: Lgc.mintId }));
  joinFormOpen = false;
  renderObjective();
  if (window.SummitAccount && SummitAccount.configured() && SummitAccount.user() && activeObjective) {
    var joinedPlan = null;
    plannedItems().forEach(function (entry) {
      if (Partners.fold(entry.name) === Partners.fold(activeObjective.name)) joinedPlan = entry;
    });
    if (joinedPlan && (joinedPlan.visibility !== 'community' || joinedPlan.lookingForPartner !== true)) {
      var published = patchItem(joinedPlan.id, { visibility: 'community', lookingForPartner: true });
      if (published) joinedPlan = published;
    }
    SummitAccount.publishMembership(activeObjective, Partners.membershipFor(activeObjective, memberships), joinedPlan);
  }
  var mainEl = document.querySelector('#app main');
  if (mainEl) mainEl.scrollTop = 0;
}

function startPartnerFrom(id) {
  var item = plannedItems().find(function (entry) { return entry.id === id; });
  if (!item) return;
  rebuildObjectives();
  var objective = Partners.resolveObjective(objectiveCatalog, item);
  if (!objective) return;
  activePlanId = id;
  selectTab('partners');
  partnerReturn = 'plan';
  showObjective(objective);
}

document.getElementById('objective-query').addEventListener('input', function () {
  suggestionIndex = -1;
  renderSuggestions();
});

document.getElementById('objective-query').addEventListener('keydown', function (event) {
  var options = document.querySelectorAll('#objective-suggestions [role="option"]');
  if (event.key === 'ArrowDown' && options.length) {
    event.preventDefault();
    suggestionIndex = Math.min(options.length - 1, suggestionIndex + 1);
  } else if (event.key === 'ArrowUp' && options.length) {
    event.preventDefault();
    suggestionIndex = Math.max(0, suggestionIndex - 1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    var pick = options[suggestionIndex] || options[0];
    if (pick) openSuggestion(pick.getAttribute('data-objective'));
    return;
  } else if (event.key === 'Escape') {
    document.getElementById('objective-suggestions').replaceChildren();
    event.target.setAttribute('aria-expanded', 'false');
    return;
  } else return;
  Array.prototype.forEach.call(options, function (option, index) {
    option.setAttribute('aria-selected', index === suggestionIndex ? 'true' : 'false');
  });
  if (options[suggestionIndex]) event.target.setAttribute('aria-activedescendant', options[suggestionIndex].id);
});

document.getElementById('objective-suggestions').addEventListener('mousedown', function (event) {
  event.preventDefault();
});

document.getElementById('objective-suggestions').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('[data-objective]') : null;
  if (!button) return;
  openSuggestion(button.getAttribute('data-objective'));
});

document.getElementById('objective-back').addEventListener('click', function () {
  if (partnerReturn === 'plan' && activePlanId) {
    var id = activePlanId;
    selectTab('plan');
    showPlanDetail(id);
    return;
  }
  showPartnerSearch();
});

document.getElementById('partner-home-back').addEventListener('click', function () {
  if (activePlanId) showPlanDetail(activePlanId);
  else showPlanHome();
});

document.getElementById('partner-profile-back').addEventListener('click', function () {
  if (activeObjective) showObjective(activeObjective);
  else showPartnerSearch();
});

document.getElementById('queue-list').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('[data-person]') : null;
  if (!button) return;
  showPerson(personFromQueue(button.getAttribute('data-person')));
});

document.getElementById('join-panel').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('button') : null;
  if (!button || !event.currentTarget.contains(button)) return;
  var id = button.id;
  if (id === 'join-queue' || id === 'edit-queue') {
    joinFormOpen = true;
    renderObjective();
  } else if (id === 'join-cancel') {
    joinFormOpen = false;
    renderObjective();
  } else if (id === 'join-save') {
    saveQueuePlace();
  } else if (id === 'leave-queue') {
    memberships = Store.saveMemberships(Partners.removeMembership(memberships, activeObjective));
    joinFormOpen = false;
    renderObjective();
  }
});

// ---- Export / Import ----
document.getElementById('export-btn').addEventListener('click', function () {
  var data = {
    schema: 4,
    items: items,
    logs: doneItems(),
    backlog: plannedItems(),
    partnerPosts: partnerPosts,
    queues: memberships,
    exported: new Date().toISOString()
  };
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

bindMapHandle();
bindSheetDismiss();
bindExploreSheet();
document.getElementById('map-locate').addEventListener('click', function () {
  if (map) map.locate({ setView: true, maxZoom: 12 });
});
document.getElementById('map-layers-btn').addEventListener('click', function () {
  if (document.documentElement.classList.contains('map-show-layers')) showMapSheet('');
  else showMapSheet('layers');
});
document.getElementById('collections-close').addEventListener('click', requestCloseSheet);
document.getElementById('layers-close').addEventListener('click', requestCloseSheet);
window.addEventListener('popstate', function (event) {
  if (mapHistoryLock) {
    mapHistoryLock = false;
    return;
  }
  var state = event.state || {};
  if (exploreHist.peak && !state.explorePeak) {
    closeExplorePeak(true);
    return;
  }
  if (exploreHist.collection && !state.exploreCollection) {
    clearCollection(true);
    return;
  }
  if (sheetHistoryPushed && !state.summitlogSheet) {
    sheetHistoryPushed = false;
    showMapSheet('', true);
    return;
  }
  if (mapExpanded && !state.summitlogMap) collapseMap(true);
});
document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape') return;
  if (sheetMode === 'peak') {
    closeExplorePeak(false);
    return;
  }
  if (activeCollectionId) {
    clearCollection(false);
    return;
  }
  if (mapSheetOpen()) {
    requestCloseSheet();
    return;
  }
  if (mapExpanded) collapseMap(false);
});

function collectionPeakByName(item) {
  if (!collectionData || !item) return null;
  var want = Col.normName(item.name);
  var found = null;
  collectionData.peaks.forEach(function (peak) {
    if (Col.normName(peak.name) === want) found = peak;
  });
  return found;
}

function loadCollections() {
  if (collectionData) {
    renderCollections();
    renderExploreSheet();
    return;
  }
  Promise.all([
    fetch('data/collections/uiaa-alps-4000.json').then(function (response) {
      if (!response.ok) throw new Error('collections');
      return response.json();
    }),
    fetch('data/collections/sourced-lists.json').then(function (response) {
      if (!response.ok) throw new Error('sourced');
      return response.json();
    })
  ]).then(function (docs) {
    collectionData = docs[0].collections && docs[0].collections[0];
    sourcedLists = (docs[1].collections || []).slice();
    renderCollections();
    renderExploreSheet();
    updateMapMarkers();
    rebuildObjectives();
    refreshActiveObjective();
    renderMine();
  }).catch(function () {
    var box = document.getElementById('collections');
    if (box) box.textContent = 'The peak list could not be loaded.';
  });
}

function formatProgress(peaks) {
  var count = Col.progress(peaks, doneItems());
  return count.done + '/' + count.total;
}

function renderCollections() {
  var box = document.getElementById('collections');
  if (!box || !collectionData) return;
  var total = Col.progress(collectionData.peaks, doneItems());
  var groups = Col.groupCollection(collectionData);
  var details = el('details', { class: 'collection-block', open: 'open' },
    el('summary', null,
      el('span', { text: collectionData.region + ' · ' + collectionData.name }),
      el('span', { class: 'progress-count', text: total.done + '/' + total.total })
    )
  );
  groups.forEach(function (group) {
    var country = el('details', { class: 'subrange-block' },
      el('summary', null,
        el('span', { text: group.name }),
        el('span', { class: 'progress-count', text: formatProgress(group.peaks) })
      )
    );
    group.subranges.forEach(function (sub) {
      var block = el('details', { class: 'subrange-block' },
        el('summary', null,
          el('span', { text: sub.name }),
          el('span', { class: 'progress-count', text: formatProgress(sub.peaks) })
        )
      );
      sub.peaks.forEach(function (peak) {
        var input = el('input', { type: 'checkbox', 'aria-label': 'Mark ' + peak.name + ' summited' });
        input.checked = Col.isSummited(peak, doneItems());
        input.addEventListener('change', function () {
          if (input.checked) markSummited(peak);
          else clearSummited(peak);
        });
        var button = el('button', { class: 'linkish', type: 'button', text: peak.name });
        button.addEventListener('click', function () { showPeakDetail(peak); });
        block.appendChild(el('div', { class: 'peak-row' },
          input,
          el('div', null,
            button,
            el('p', { class: 'entry-meta', text: peakLine(peak) })
          )
        ));
      });
      country.appendChild(block);
    });
    details.appendChild(country);
  });
  box.replaceChildren(details);
}

function peakLine(peak) {
  return peak.elevation + ' m · ' + Col.countryLabel(peak) + ' · ' + peak.subrange +
    ' · grade ' + (peak.grade || 'unknown');
}

function applyKnownRoute(planId, peak) {
  if (!peak || !peak.normalRoute || !planId) return;
  var updated = patchItem(planId, {
    routeName: peak.normalRoute,
    routeGrade: peak.grade || '',
    routeSource: peak.sourceUrl || '',
    stageManual: false
  });
  if (!updated) return;
  selectTab('plan');
  showPlanDetail(updated.id);
}

function useRouteButton(peak) {
  var button = el('button', { class: 'secondary', type: 'button', text: 'Use this route' });
  button.addEventListener('click', function () {
    var existing = null;
    plannedItems().forEach(function (item) {
      if (item.name.toLowerCase() === peak.name.toLowerCase()) existing = item;
    });
    if (!existing) {
      addCatalogItem({
        name: peak.name,
        kind: 'peak',
        lat: peak.lat,
        lng: peak.lng,
        elevation: peak.elevation,
        note: '',
        collectionId: collectionData ? collectionData.id : ''
      });
      plannedItems().forEach(function (item) {
        if (item.name.toLowerCase() === peak.name.toLowerCase()) existing = item;
      });
    }
    if (existing) applyKnownRoute(existing.id, peak);
  });
  return button;
}

function showPeakDetail(peak) {
  var box = document.getElementById('peak-detail');
  if (!box) return;
  document.documentElement.classList.remove('map-sheet-tall');
  var level = Col.estimateLevel(doneItems(), collectionData.peaks, Store.getLevel());
  var plan = Col.suggestBuildUp(peak, collectionData.peaks, level);
  var summited = el('button', { class: 'primary', type: 'button', text: Col.isSummited(peak, doneItems()) ? 'Summited' : 'Mark summited' });
  summited.addEventListener('click', function () {
    if (Col.isSummited(peak, doneItems())) clearSummited(peak);
    else markSummited(peak);
    showPeakDetail(peak);
  });
  var backlogBtn = el('button', { class: 'primary', type: 'button', text: alreadyPlanned(peak.name) ? 'In your plan' : 'Add to plan' });
  backlogBtn.addEventListener('click', function () {
    if (alreadyPlanned(peak.name)) {
      showToast(peak.name + ' is already in your plan', [{ label: 'View plan', run: function () { openPlanByName(peak.name); } }]);
      return;
    }
    confirmPlan(placeForPeak(peak));
  });
  var steps = plan.steps.map(function (step) {
    var button = el('button', { class: 'linkish', type: 'button', text: step.name });
    button.addEventListener('click', function () { showPeakDetail(step); });
    return el('div', { class: 'build-step' },
      button,
      el('p', { class: 'entry-meta', text: peakLine(step) })
    );
  });
  var progressHost = progressHostFor(peak);
  var progress = progressHost ? Col.progress(progressHost.peaks, doneItems()) : null;
  var grab = el('button', { class: 'sheet-grab', type: 'button', 'aria-label': 'Drag down to close' });
  var partnersBtn = el('button', { class: 'secondary', type: 'button', text: 'Find partners' });
  partnersBtn.addEventListener('click', function () {
    var existing = null;
    plannedItems().forEach(function (item) {
      if (item.name.toLowerCase() === peak.name.toLowerCase()) existing = item;
    });
    if (!existing) {
      confirmPlan(placeForPeak(peak));
      plannedItems().forEach(function (item) {
        if (item.name.toLowerCase() === peak.name.toLowerCase()) existing = item;
      });
    }
    if (existing) startPartnerFrom(existing.id);
  });
  var hero = summitHero(peak);
  hero.classList.add('sheet-open');
  hero.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('a')) return;
    openPeakPage(peak, 'map');
  });
  var sheetTitle = el('button', { class: 'summit-name sheet-title', type: 'button', text: peak.name });
  sheetTitle.addEventListener('click', function () { openPeakPage(peak, 'map'); });
  var copy = [
    sheetTitle,
    el('p', { class: 'sheet-meta' },
      el('span', { text: peak.elevation + ' m' }),
      el('span', { text: peak.subrange || 'Alps' }),
      el('span', { text: Col.countryLabel(peak) })
    ),
    el('p', null,
      el('span', { text: peak.normalRoute ? 'Normal route ' + peak.normalRoute : 'No sourced normal route' }),
      peak.grade ? el('span', { class: 'grade-badge', text: peak.grade }) : null
    ),
    progress ? el('p', { class: 'muted', text: progress.done + ' of ' + progress.total + ' · ' + progressHost.name }) : null,
    el('div', { class: 'log-actions' }, backlogBtn, partnersBtn),
    el('div', { class: 'reference-data' },
      el('p', { class: 'field-label', text: 'Known route' }),
      el('p', { text: peak.normalRoute ? peak.normalRoute + (peak.grade ? ' · ' + peak.grade : '') : 'No sourced route is stored for this summit.' }),
      el('p', { class: 'muted', text: 'The grade, when there is one, belongs to that route. Adding the mountain does not add the route.' }),
      peak.sourceUrl ? el('a', { href: peak.sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: peak.normalRoute ? 'Route source' : 'Source' }) : null,
      peak.normalRoute ? useRouteButton(peak) : null
    ),
    el('div', { class: 'log-actions' }, summited),
    el('h3', { text: 'Build up to this peak' }),
    el('p', { text: plan.note })
  ];
  if (!plan.steps.length) copy.push(el('p', { class: 'muted', text: 'No lower summit in this list fits those fields.' }));
  box.replaceChildren(
    grab,
    sheetCloseButton(),
    hero,
    el.apply(null, ['div', { class: 'detail-copy' }].concat(copy).concat([steps]))
  );
  box.classList.remove('hidden');
  if (document.documentElement.classList.contains('explore-map')) openExplorePeak();
  else if (document.documentElement.classList.contains('map-expanded')) showMapSheet('peak');
  else box.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  if (map) {
    map.setView([peak.lat, peak.lng], Math.max(map.getZoom(), 10), { animate: !prefersReducedMotion() });
  }
}

function sheetCloseButton() {
  return el('button', { class: 'sheet-close', type: 'button', 'aria-label': 'Close', text: '×' });
}

function bindSheetDismiss() {
  var box = document.getElementById('peak-detail');
  if (!box || box.dataset.dismissBound) return;
  box.dataset.dismissBound = '1';
  var swipe = null;
  box.addEventListener('pointerdown', function (event) {
    var root = document.documentElement;
    if (!root.classList.contains('map-show-peak') && !root.classList.contains('explore-peak')) return;
    if (event.target.closest && event.target.closest('.sheet-close, a, input, textarea, select, button:not(.sheet-grab)')) return;
    var onGrab = event.target.closest && event.target.closest('.sheet-grab');
    if (!onGrab && box.scrollTop > 0) return;
    swipe = { id: event.pointerId, y: event.clientY, lastY: event.clientY, lastT: Date.now(), dy: 0, vy: 0, onGrab: !!onGrab };
    box.setPointerCapture(event.pointerId);
  });
  box.addEventListener('pointermove', function (event) {
    if (!swipe || event.pointerId !== swipe.id) return;
    var now = Date.now();
    swipe.vy = (event.clientY - swipe.lastY) / Math.max(1, now - swipe.lastT);
    swipe.lastY = event.clientY;
    swipe.lastT = now;
    swipe.dy = event.clientY - swipe.y;
    if (swipe.dy < 0) return;
    if (sheetMotionOff()) return;
    box.style.transition = 'none';
    box.style.transform = 'translateY(' + swipe.dy + 'px)';
  });
  function endSwipe(event) {
    if (!swipe || event.pointerId !== swipe.id) return;
    var drag = swipe;
    swipe = null;
    if (drag.dy > 88 || drag.vy > 0.55) {
      if (sheetMotionOff()) {
        requestCloseSheet();
        return;
      }
      box.style.transition = 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';
      box.style.transform = 'translateY(120%)';
      var closed = false;
      function finish() {
        if (closed) return;
        closed = true;
        requestCloseSheet();
      }
      box.addEventListener('transitionend', function onEnd(ev) {
        if (ev.propertyName !== 'transform') return;
        box.removeEventListener('transitionend', onEnd);
        finish();
      });
      setTimeout(finish, 280);
      return;
    }
    if (drag.onGrab && Math.abs(drag.dy) < 10) {
      document.documentElement.classList.toggle('map-sheet-tall');
    } else if (drag.dy < -40) {
      document.documentElement.classList.add('map-sheet-tall');
    }
    if (!sheetMotionOff()) box.style.transition = 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';
    box.style.transform = '';
  }
  box.addEventListener('pointerup', endSwipe);
  box.addEventListener('pointercancel', endSwipe);
  box.addEventListener('click', function (event) {
    var close = event.target.closest ? event.target.closest('.sheet-close') : null;
    if (!close || !box.contains(close)) return;
    requestCloseSheet();
  });
}

function summitHero(peak) {
  var photo = photoRecord(peak);
  var frame = el('div', { class: 'summit-hero' });
  var src = safePhotoUrl(photo && photo.thumb);
  if (!src) {
    frame.appendChild(el('div', { class: 'summit-hero-fallback', role: 'img', 'aria-label': 'Illustrated placeholder' }));
    return frame;
  }
  var img = el('img', { alt: '', src: src });
  img.addEventListener('error', function () {
    img.replaceWith(el('div', { class: 'summit-hero-fallback', role: 'img', 'aria-label': 'Illustrated placeholder' }));
  });
  frame.appendChild(img);
  if (photo.page) {
    frame.appendChild(el('a', {
      class: 'photo-credit',
      href: photo.page,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: photo.credit || photo.license || 'Photo',
      text: photo.license || 'Photo'
    }));
  }
  return frame;
}

function showTrailSheet(place) {
  var box = document.getElementById('peak-detail');
  if (!box || !place) return;
  document.documentElement.classList.remove('map-sheet-tall');
  var grab = el('button', { class: 'sheet-grab', type: 'button', 'aria-label': 'Drag down to close' });
  var add = el('button', { class: 'primary', type: 'button', text: alreadyPlanned(place.name) ? 'In your plan' : 'Add to plan' });
  add.addEventListener('click', function () {
    if (alreadyPlanned(place.name)) {
      showToast(place.name + ' is already in your plan', [{ label: 'View plan', run: function () { openPlanByName(place.name); } }]);
      return;
    }
    confirmPlan(place);
  });
  var photo = peakPhotos['place:' + place.name];
  var hero = el('div', { class: 'summit-hero' });
  var src = safePhotoUrl(photo && photo.thumb);
  if (src) {
    var img = el('img', { alt: '', src: src });
    img.addEventListener('error', function () {
      img.replaceWith(el('div', { class: 'summit-hero-fallback', role: 'img', 'aria-label': 'Illustrated placeholder' }));
    });
    hero.appendChild(img);
    if (photo.page) hero.appendChild(el('a', { class: 'photo-credit', href: photo.page, target: '_blank', rel: 'noopener noreferrer', text: photo.license || 'Photo' }));
  } else {
    hero.appendChild(el('div', { class: 'summit-hero-fallback', role: 'img', 'aria-label': 'Illustrated placeholder' }));
  }
  box.replaceChildren(
    grab,
    sheetCloseButton(),
    hero,
    el('div', { class: 'detail-copy' },
      el('h3', { class: 'summit-name', text: place.name }),
      el('p', { class: 'sheet-meta' },
        el('span', { text: place.area || 'Trail' }),
        el('span', { text: place.note || 'Stages vary' })
      ),
      el('div', { class: 'log-actions' }, add)
    )
  );
  box.classList.remove('hidden');
  if (document.documentElement.classList.contains('explore-map')) openExplorePeak();
  else if (document.documentElement.classList.contains('map-expanded')) showMapSheet('peak');
}

function collectionPopup(peak) {
  var details = el('button', { type: 'button', text: 'Details' });
  details.addEventListener('click', function () { showPeakDetail(peak); });
  var add = el('button', { type: 'button', text: 'Add to plan' });
  add.addEventListener('click', function () {
    addCatalogItem({
      name: peak.name,
      kind: 'peak',
      lat: peak.lat,
      lng: peak.lng,
      elevation: peak.elevation,
      note: '',
      collectionId: collectionData ? collectionData.id : ''
    });
  });
  var mark = el('button', { type: 'button', text: Col.isSummited(peak, doneItems()) ? 'Summited' : 'Mark summited' });
  mark.addEventListener('click', function () {
    if (Col.isSummited(peak, doneItems())) clearSummited(peak);
    else markSummited(peak);
  });
  return el('div', null,
    el('strong', { text: peak.name }),
    el('br'),
    document.createTextNode(peakLine(peak)),
    el('br'),
    details, document.createTextNode(' '), add, document.createTextNode(' '), mark
  );
}

function markSummited(peak) {
  var existing = Col.matchingLogPeaks(peak, doneItems())[0];
  if (existing) {
    if (existing.collectionId !== peak.id) {
      var updated = Lgc.updateLog(existing, { collectionId: peak.id, status: 'done' });
      var index = items.findIndex(function (item) { return item.id === existing.id; });
      if (index >= 0) items[index] = updated;
      saveItems();
    }
  } else {
    var planned = Col.matchingLogPeaks(peak, plannedItems())[0];
    if (planned) {
      items = Lgc.markDone(items, planned.id, { date: planned.date || Lgc.todayISO(), notes: planned.notes });
      var plannedIndex = items.findIndex(function (item) { return item.id === planned.id; });
      if (plannedIndex >= 0) items[plannedIndex] = Lgc.updateLog(items[plannedIndex], { collectionId: peak.id });
    } else {
      var created = Lgc.createLog({
        kind: 'peak',
        name: peak.name,
        elevation: peak.elevation,
        lat: peak.lat,
        lng: peak.lng,
        date: Lgc.todayISO(),
        collectionId: peak.id,
        status: 'done'
      });
      if (created) items.push(created);
    }
    saveItems();
  }
  renderMine();
}

function clearSummited(peak) {
  var matches = Col.matchingLogPeaks(peak, doneItems());
  if (!matches.length) return;
  if (!confirm('Remove ' + peak.name + ' from your done list?')) {
    renderCollections();
    return;
  }
  var ids = {};
  matches.forEach(function (item) { ids[item.id] = true; });
  items = items.filter(function (item) { return !ids[item.id]; });
  saveItems();
  renderMine();
  var box = document.getElementById('peak-detail');
  if (box && !box.classList.contains('hidden')) showPeakDetail(peak);
}

function fillLevelForm() {
  var grade = document.getElementById('level-grade');
  if (!grade) return;
  if (!grade.options.length) {
    var empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Not set';
    grade.appendChild(empty);
    Col.GRADE_ORDER.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      grade.appendChild(option);
    });
  }
  var saved = Store.getLevel();
  var level = Col.estimateLevel(doneItems(), collectionData ? collectionData.peaks : [], saved);
  if (saved && saved.useManual) {
    grade.value = saved.grade || '';
    document.getElementById('level-elev').value = saved.elevation == null ? '' : String(saved.elevation);
    document.getElementById('level-glacier').value = saved.glacier === true ? 'yes' : saved.glacier === false ? 'no' : '';
  }
  document.getElementById('level-note').textContent = 'From your log: ' +
    (level.elevation != null ? level.elevation + ' m' : 'elevation unknown') + ', ' +
    (level.grade ? 'grade ' + level.grade : 'grade unknown') + ', ' +
    (level.glacier === true ? 'glacier experience noted' : 'glacier experience unknown') + '.';
}

document.getElementById('level-save').addEventListener('click', function () {
  var elevRaw = document.getElementById('level-elev').value.trim();
  var elevation = elevRaw === '' ? null : Number(elevRaw);
  if (elevRaw !== '' && !Number.isFinite(elevation)) {
    alert('Enter a summit elevation in metres, or leave it blank.');
    return;
  }
  var glacierValue = document.getElementById('level-glacier').value;
  Store.setLevel({
    useManual: true,
    grade: document.getElementById('level-grade').value || null,
    elevation: elevation,
    glacier: glacierValue === 'yes' ? true : glacierValue === 'no' ? false : null
  });
  fillLevelForm();
});

document.getElementById('level-auto').addEventListener('click', function () {
  Store.setLevel({ useManual: false });
  document.getElementById('level-grade').value = '';
  document.getElementById('level-elev').value = '';
  document.getElementById('level-glacier').value = '';
  fillLevelForm();
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

function bookmarkIcon(filled) {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.2L5 21V4.5a1 1 0 0 1 1-1z');
  path.setAttribute('fill', filled ? 'currentColor' : 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

function downscaleFile(file) {
  return new Promise(function (resolve, reject) {
    if (!file || !/^image\//.test(file.type || '')) {
      reject(new Error('photo'));
      return;
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var max = 1400;
      var scale = Math.min(1, max / Math.max(img.width, img.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('photo'));
      }, 'image/jpeg', 0.82);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('photo'));
    };
    img.src = url;
  });
}

function showPlanHome() {
  var home = document.getElementById('plan-home');
  if (!home) return;
  home.classList.remove('hidden');
  document.getElementById('plan-detail').classList.add('hidden');
  document.getElementById('partner-flow').classList.add('hidden');
  document.getElementById('done-prompt').classList.add('hidden');
  donePromptId = '';
}

function showPartnerFlow() {
  document.getElementById('plan-home').classList.add('hidden');
  document.getElementById('plan-detail').classList.add('hidden');
  document.getElementById('done-prompt').classList.add('hidden');
  document.getElementById('partner-flow').classList.remove('hidden');
}

function showLogbookHome() {
  var home = document.getElementById('logbook-home');
  if (!home) return;
  home.classList.remove('hidden');
  document.getElementById('logbook-detail').classList.add('hidden');
}

function patchItem(id, fields) {
  var index = items.findIndex(function (entry) { return entry.id === id; });
  if (index < 0) return null;
  var next = Lgc.updateLog(items[index], fields);
  if (!next) return null;
  items[index] = next;
  saveItems();
  renderMine();
  return next;
}

function openPlanByName(name) {
  var key = String(name || '').trim().toLowerCase();
  var item = null;
  plannedItems().forEach(function (entry) {
    if (entry.name.toLowerCase() === key) item = entry;
  });
  if (!item) return;
  selectTab('plan');
  showPlanDetail(item.id);
}

function checklistNode(item) {
  var list = el('ul', { class: 'check-list' });
  (item.checklist || []).forEach(function (step, index) {
    var input = el('input', { type: 'checkbox', 'aria-label': step.text });
    input.checked = step.done === true;
    input.addEventListener('change', function () {
      var next = (item.checklist || []).map(function (entry, i) {
        if (i !== index) return entry;
        return { id: entry.id, text: entry.text, done: input.checked };
      });
      var updated = patchItem(item.id, { checklist: next });
      if (updated) item.checklist = updated.checklist;
    });
    var remove = el('button', { class: 'secondary icon-btn', type: 'button', 'aria-label': 'Remove step', text: '×' });
    remove.addEventListener('click', function () {
      var next = (item.checklist || []).filter(function (entry) { return entry.id !== step.id; });
      patchItem(item.id, { checklist: next });
      showPlanDetail(item.id);
    });
    list.appendChild(el('li', null,
      el('label', { class: 'check-row' }, input, el('span', { text: step.text })),
      remove
    ));
  });
  var addInput = el('input', {
    type: 'text',
    id: 'check-new',
    maxlength: '200',
    placeholder: 'Add a preparation step',
    'aria-label': 'Preparation step'
  });
  var add = el('button', { class: 'secondary', type: 'button', text: 'Add' });
  function commit() {
    var text = addInput.value.trim();
    if (!text) return;
    var next = (item.checklist || []).concat([{ id: 'step-' + Date.now(), text: text, done: false }]);
    patchItem(item.id, { checklist: next });
    showPlanDetail(item.id);
  }
  add.addEventListener('click', commit);
  addInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  });
  return el('div', null, list, el('div', { class: 'check-add' }, addInput, add));
}

function syncPlanQueue(item) {
  if (!item) return;
  rebuildObjectives();
  var objective = Partners.resolveObjective(objectiveCatalog, item);
  if (!objective) return;
  var existing = null;
  memberships.forEach(function (row) {
    if (row && (row.objectiveId === objective.id || Partners.fold(row.objectiveName) === Partners.fold(objective.name))) existing = row;
  });
  if (item.visibility === 'community' && item.lookingForPartner) {
    memberships = Store.saveMemberships(Partners.upsertMembership(memberships, {
      objectiveId: objective.id,
      objectiveName: objective.name,
      dates: item.fixedDate || item.timeframe || 'Flexible',
      note: item.shareNote || (existing && existing.note) || '',
      attachedIds: existing && existing.attachedIds || []
    }, { now: new Date().toISOString(), mint: Lgc.mintId }));
    if (window.SummitAccount && SummitAccount.user()) SummitAccount.publishItem(item);
    return;
  }
  if (existing) memberships = Store.saveMemberships(Partners.removeMembership(memberships, objective));
  if (window.SummitAccount && SummitAccount.user()) SummitAccount.publishItem(item);
}

function sharePreviewNode(item) {
  var view = Lgc.shareableView(item);
  if (!view) return el('p', { class: 'share-preview', text: 'Nothing is shared. Only you can see this plan.' });
  var lines = [
    view.name,
    kindLabel(view.kind),
    view.routeName || 'Route TBD',
    view.fixedDate ? prettyDate(view.fixedDate) : (view.timeframe || 'Date not set'),
    view.lookingForPartner ? 'Looking for a partner' : ''
  ].filter(Boolean);
  var heading = view.visibility === 'people' ? 'People you choose would see' : 'The community queue would see';
  return el('div', { class: 'share-preview' },
    el('p', { class: 'field-label', text: heading }),
    el('p', { text: lines.join(' · ') }),
    view.shareNote ? el('p', { text: view.shareNote }) : null,
    view.visibility === 'people' ? el('p', { class: 'muted', text: 'Sharing with specific people needs an account, which SummitLog does not have yet. Nothing is sent.' }) : null
  );
}

function planDetailNode(item) {
  var peak = collectionPeakByName(item);
  var back = el('button', { class: 'secondary', type: 'button', text: 'Back' });
  back.addEventListener('click', showPlanHome);
  var stage = el('select', { id: 'plan-stage', 'aria-label': 'Stage' });
  [['idea', 'Idea'], ['objective', 'Objective'], ['scheduled', 'Scheduled']].forEach(function (pair) {
    var option = document.createElement('option');
    option.value = pair[0];
    option.textContent = pair[1];
    stage.appendChild(option);
  });
  stage.value = Lgc.deriveStage(item);
  stage.addEventListener('change', function () {
    var fields = { stage: stage.value, stageManual: true };
    if (stage.value !== 'scheduled') fields.fixedDate = '';
    var updated = patchItem(item.id, fields);
    if (updated) showPlanDetail(updated.id);
  });
  var route = el('input', {
    type: 'text', id: 'plan-route', maxlength: '200', placeholder: 'Route, if you know it',
    'aria-label': 'Route', value: item.routeName || ''
  });
  route.addEventListener('change', function () {
    var known = peak && peak.normalRoute && Col.normName(peak.normalRoute) === Col.normName(route.value);
    var updated = patchItem(item.id, {
      routeName: route.value,
      stageManual: false,
      routeGrade: known ? (peak.grade || '') : '',
      routeSource: known ? (peak.sourceUrl || '') : ''
    });
    if (updated) showPlanDetail(updated.id);
  });
  var timeframe = el('input', {
    type: 'text', id: 'plan-timeframe', maxlength: '120', placeholder: 'Timeframe, such as July',
    'aria-label': 'Timeframe', value: item.timeframe || ''
  });
  timeframe.addEventListener('change', function () {
    var updated = patchItem(item.id, { timeframe: timeframe.value, planDates: timeframe.value, stageManual: false });
    if (updated) showPlanDetail(updated.id);
  });
  var fixed = el('input', { type: 'date', id: 'plan-fixed', 'aria-label': 'Fixed date', value: item.fixedDate || '' });
  fixed.addEventListener('change', function () {
    var updated = patchItem(item.id, { fixedDate: fixed.value, stageManual: false });
    if (updated) showPlanDetail(updated.id);
  });
  var visibility = el('select', { id: 'plan-visibility', 'aria-label': 'Who can see this' });
  [['private', 'Private'], ['people', 'Shared with people'], ['community', 'Community']].forEach(function (pair) {
    var option = document.createElement('option');
    option.value = pair[0];
    option.textContent = pair[1];
    visibility.appendChild(option);
  });
  visibility.value = item.visibility || 'private';
  var looking = el('input', { type: 'checkbox', id: 'plan-looking', 'aria-label': 'Looking for a partner' });
  looking.checked = item.lookingForPartner === true;
  var lookingRow = el('label', { class: 'check-row' }, looking, el('span', { text: 'Looking for a partner' }));
  if (visibility.value !== 'community') lookingRow.classList.add('hidden');
  function saveVisibility() {
    var vis = visibility.value;
    var look = vis === 'community' && looking.checked;
    var updated = patchItem(item.id, { visibility: vis, lookingForPartner: look, stageManual: false });
    if (updated) {
      syncPlanQueue(updated);
      showPlanDetail(updated.id);
    }
  }
  visibility.addEventListener('change', saveVisibility);
  looking.addEventListener('change', function () {
    if (looking.checked) visibility.value = 'community';
    saveVisibility();
  });
  var shareNote = el('textarea', { id: 'plan-share-note', rows: '2', maxlength: '500', placeholder: 'A note you are willing to share', 'aria-label': 'Note you would share' });
  shareNote.value = item.shareNote || '';
  var saveShare = el('button', { class: 'secondary', type: 'button', text: 'Save shared note' });
  saveShare.addEventListener('click', function () {
    var updated = patchItem(item.id, { shareNote: shareNote.value });
    if (updated) {
      syncPlanQueue(updated);
      showPlanDetail(updated.id);
    }
  });
  var season = el('select', { id: 'plan-season', 'aria-label': 'Season' });
  [['', 'Any time'], ['winter', 'Winter'], ['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn']].forEach(function (pair) {
    var option = document.createElement('option');
    option.value = pair[0];
    option.textContent = pair[1];
    season.appendChild(option);
  });
  season.value = item.season || '';
  season.addEventListener('change', function () { patchItem(item.id, { season: season.value }); });
  var notes = el('textarea', { id: 'plan-notes', rows: '4', maxlength: '4000', placeholder: 'Private preparation notes', 'aria-label': 'Private preparation notes' });
  notes.value = item.notes || '';
  var saveNotes = el('button', { class: 'secondary', type: 'button', text: 'Save notes' });
  saveNotes.addEventListener('click', function () {
    patchItem(item.id, { notes: notes.value });
    saveNotes.textContent = 'Saved';
  });
  var research = [el('h3', { text: 'Research' })];
  if (peak) {
    research.push(el('p', { class: 'reference-data', text: 'Reference: ' + peak.elevation + ' m · ' + peak.subrange + ' · ' + Col.countryLabel(peak) + '. Choosing the mountain does not choose a route.' }));
  }
  if (item.routeName) {
    research.push(el('p', { text: 'Your route: ' + item.routeName }));
  }
  if (item.routeGrade || item.routeSource) {
    var sourceBits = el('p', { class: 'reference-data' },
      el('span', { text: 'Grade ' + (item.routeGrade || 'not recorded') + ' belongs to the route you selected.' }),
      item.routeSource ? el('a', { href: item.routeSource, target: '_blank', rel: 'noopener noreferrer', text: ' Source' }) : null
    );
    research.push(sourceBits);
  }
  if (peak && peak.normalRoute) {
    var useRoute = el('button', { class: 'secondary', type: 'button', text: 'Use this route' });
    useRoute.addEventListener('click', function () { applyKnownRoute(item.id, peak); });
    research.push(el('div', { class: 'reference-data' },
      el('p', { class: 'field-label', text: 'Known route' }),
      el('p', { text: peak.normalRoute + (peak.grade ? ' · ' + peak.grade : '') }),
      el('p', { class: 'muted', text: 'This is the sourced normal route. It is not applied until you use it.' }),
      peak.sourceUrl ? el('a', { href: peak.sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: peak.normalRoute ? 'Route source' : 'Source' }) : null,
      useRoute
    ));
  } else if (!item.routeName) {
    research.push(el('p', { class: 'muted', text: 'Route TBD. You can type one, or pick a known route when this mountain has one.' }));
  }
  var partners = el('button', { class: 'secondary', type: 'button', text: 'Find partners' });
  partners.addEventListener('click', function () {
    var updated = patchItem(item.id, { visibility: 'community', lookingForPartner: true, stageManual: false });
    if (updated) syncPlanQueue(updated);
    startPartnerFrom(item.id);
  });
  var partnerBlock = planPartnersNode(item, partners);
  var done = el('button', { class: 'primary plan-done', type: 'button', text: 'Mark as done' });
  done.addEventListener('click', function () { openDonePrompt(item.id); });
  return el('div', { class: 'plan-sheet' },
    back,
    el('h2', { text: item.name }),
    el('p', { class: 'plan-status', text: planStatusLine(item) }),
    el('p', { class: 'entry-meta', text: [activityLabel(item), item.elevation ? item.elevation + ' m' : '', seasonLabel(item.season)].filter(Boolean).join(' · ') }),
    el('label', { class: 'field-label', for: 'plan-stage', text: 'Stage' }),
    stage,
    el('label', { class: 'field-label', for: 'plan-route', text: 'Route' }),
    route,
    el('label', { class: 'field-label', for: 'plan-timeframe', text: 'Timeframe' }),
    timeframe,
    el('label', { class: 'field-label', for: 'plan-fixed', text: 'Fixed date' }),
    fixed,
    el('label', { class: 'field-label', for: 'plan-season', text: 'Season' }),
    season,
    research[0],
    research[1],
    research[2] || false,
    el('h3', { text: 'Who can see this' }),
    el('p', { class: 'muted', text: 'Private is the default. Preparation stays on this device.' }),
    visibility,
    lookingRow,
    shareNote,
    saveShare,
    sharePreviewNode(item),
    el('h3', { text: 'Private preparation' }),
    el('p', { class: 'muted', text: 'These notes are not included when this plan is shared.' }),
    notes,
    saveNotes,
    checklistNode(item),
    partnerBlock,
    done
  );
}

function planPartnersNode(item, findButton) {
  rebuildObjectives();
  var objective = Partners.resolveObjective(objectiveCatalog, item);
  var shared = item.visibility === 'community' && item.lookingForPartner;
  var nodes = [el('h3', { text: 'Partners' })];
  if (!shared) {
    nodes.push(el('p', { class: 'muted', text: 'This plan is not in the community queue. Private notes stay on this device.' }));
  nodes.push(findButton);
  var message = el('button', { class: 'secondary', type: 'button', text: 'Message' });
  message.addEventListener('click', function () {
    if (window.SummitChat) SummitChat.messageAbout(item.name);
  });
  nodes.push(message);
  return el('div', { class: 'plan-partners' }, nodes);
  }
  nodes.push(el('p', { class: 'muted', text: 'Same queue as the Partners tab. Sample people wear a Demo badge. Private notes are not included.' }));
  var people = queuePeopleFor(objective);
  if (!people.length) nodes.push(el('p', { class: 'muted', text: 'No one is in this queue yet.' }));
  else {
    var list = el('div', { class: 'plan-queue' });
    people.forEach(function (person) {
      list.appendChild(personRow(person, function () {
        if (!objective) return;
        activeObjective = objective;
        activePlanId = item.id;
        selectTab('partners');
        partnerReturn = 'plan';
        showPerson(person);
      }));
    });
    nodes.push(list);
  }
  var membership = objective ? Partners.membershipFor(objective, memberships) : null;
  var join = el('button', {
    class: 'secondary',
    type: 'button',
    text: membership ? 'Edit your place' : 'Join the queue'
  });
  join.addEventListener('click', function () {
    if (!objective) return;
    activePlanId = item.id;
    selectTab('partners');
    partnerReturn = 'plan';
    showObjective(objective);
    joinFormOpen = !membership;
    renderObjective();
  });
  nodes.push(join);
  var messageShared = el('button', { class: 'secondary', type: 'button', text: 'Message' });
  messageShared.addEventListener('click', function () {
    if (window.SummitChat) SummitChat.messageAbout(item.name);
  });
  nodes.push(messageShared);
  return el('div', { class: 'plan-partners' }, nodes);
}

function showPlanDetail(id) {
  var item = items.find(function (entry) { return entry.id === id && entry.status === 'planned'; });
  if (!item) {
    showPlanHome();
    return;
  }
  activePlanId = id;
  donePromptId = '';
  document.getElementById('plan-home').classList.add('hidden');
  document.getElementById('partner-flow').classList.add('hidden');
  document.getElementById('done-prompt').classList.add('hidden');
  var box = document.getElementById('plan-detail');
  box.classList.remove('hidden');
  box.replaceChildren(planDetailNode(item));
  var mainEl = document.querySelector('#app main');
  if (mainEl) mainEl.scrollTop = 0;
}

function paintMemoryPhotos(itemId, box) {
  if (!Photos || !box) return;
  Photos.list(itemId).then(function (rows) {
    if (!box.isConnected) return;
    if (!rows.length) {
      box.replaceChildren(el('p', { class: 'muted', text: 'No photos yet.' }));
      return;
    }
    box.replaceChildren.apply(box, rows.map(function (row) {
      var img = el('img', { class: 'memory-photo', alt: 'Photo from this entry' });
      img.src = URL.createObjectURL(row.blob);
      return img;
    }));
  }).catch(function () {});
}

function showMemory(id) {
  var item = items.find(function (entry) { return entry.id === id && entry.status !== 'planned'; });
  if (!item) {
    showLogbookHome();
    return;
  }
  document.getElementById('logbook-home').classList.add('hidden');
  var box = document.getElementById('logbook-detail');
  box.classList.remove('hidden');
  var back = el('button', { class: 'secondary', type: 'button', text: 'Back' });
  back.addEventListener('click', showLogbookHome);
  var photos = el('div', { class: 'memory-photos' });
  var file = el('input', { type: 'file', accept: 'image/*', multiple: 'multiple', 'aria-label': 'Add photos' });
  file.addEventListener('change', function () {
    var files = Array.prototype.slice.call(file.files || []);
    Promise.all(files.map(function (one) {
      return downscaleFile(one).then(function (blob) { return Photos.add(item.id, blob); }).catch(function () { return null; });
    })).then(function () { showMemory(item.id); });
  });
  var progress = el('button', { class: 'secondary', type: 'button', text: 'Alpine 4000ers progress' });
  progress.addEventListener('click', function () {
    selectTab('explore');
    selectBrowseCollection('uiaa-alps-4000');
  });
  var plannedBits = [
    'Planned: ' + (item.routeName || 'Route TBD'),
    item.fixedDate ? prettyDate(item.fixedDate) : (item.timeframe || 'Date not set')
  ];
  var actualBits = [
    'Actual: ' + (item.routeTaken || 'Route not recorded'),
    item.date ? prettyDate(item.date) : 'Date not set'
  ];
  if (item.partnersWith) actualBits.push(item.partnersWith);
  if (item.duration) actualBits.push(item.duration);
  if (item.conditions && (item.conditions.weather || item.conditions.snow || item.conditions.temp)) {
    actualBits.push([item.conditions.weather, item.conditions.snow, item.conditions.temp].filter(Boolean).join(', '));
  }
  box.replaceChildren(el('div', { class: 'plan-sheet' },
    back,
    el('h2', { text: item.name }),
    el('p', { class: 'entry-meta', text: activityLabel(item) }),
    el('h3', { text: 'Planned vs actual' }),
    el('p', { text: plannedBits.join(' · ') }),
    el('p', { text: actualBits.join(' · ') }),
    item.stages && item.stages.length ? el('p', { class: 'entry-meta', text: 'Stages: ' + item.stages.map(function (stage) { return stage.name; }).join(', ') }) : null,
    item.notes ? el('p', { class: 'entry-notes', text: item.notes }) : el('p', { class: 'muted', text: 'No journal written yet.' }),
    el('h3', { text: 'Photos' }),
    photos,
    el('label', { class: 'field-label', text: 'Add a photo' }),
    file,
    progress
  ));
  paintMemoryPhotos(item.id, photos);
  var mainEl = document.querySelector('#app main');
  if (mainEl) mainEl.scrollTop = 0;
}

function paintLogPhotos(done) {
  if (!Photos) return;
  done.forEach(function (item) {
    Photos.list(item.id).then(function (rows) {
      var card = document.querySelector('#logbook-list [data-id="' + item.id + '"]');
      if (!card || !rows.length || card.querySelector('.memory-strip')) return;
      var img = el('img', { class: 'memory-strip', alt: '' });
      img.src = URL.createObjectURL(rows[0].blob);
      card.insertBefore(img, card.firstChild);
    }).catch(function () {});
  });
}

function loadPeakPhotos() {
  fetch('data/peak-photos.json').then(function (response) {
    if (!response.ok) throw new Error('photos');
    return response.json();
  }).then(function (doc) {
    peakPhotos = doc || {};
    renderMine();
  }).catch(function () { peakPhotos = peakPhotos || {}; });
}

function photoRecord(peak) {
  if (!peak || !peak.wikidata) return null;
  return peakPhotos[peak.wikidata] || null;
}

function photoNode(photo, name) {
  if (!photo || !photo.thumb) {
    return el('div', { class: 'peak-photo peak-photo-empty', role: 'img', 'aria-label': 'Illustrated placeholder for ' + name });
  }
  var img = el('img', { class: 'peak-photo', alt: '', loading: 'lazy', decoding: 'async', src: photo.thumb });
  img.addEventListener('error', function () {
    img.replaceWith(el('div', { class: 'peak-photo peak-photo-empty', role: 'img', 'aria-label': 'Illustrated placeholder for ' + name }));
  });
  var credit = el('a', {
    class: 'photo-credit',
    href: photo.page,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: photo.credit || photo.license,
    text: photo.license || 'Photo'
  });
  credit.addEventListener('click', function (event) { event.stopPropagation(); });
  return el('div', { class: 'peak-photo-frame' }, img, credit);
}

function bookmarkButton(name, place) {
  var saved = alreadyPlanned(name);
  var button = el('button', {
    class: saved ? 'bookmark in-plan' : 'bookmark',
    type: 'button',
    'aria-label': saved ? name + ' is in your plan' : 'Add ' + name + ' to plan'
  }, bookmarkIcon(saved));
  button.addEventListener('click', function (event) {
    event.stopPropagation();
    if (alreadyPlanned(name)) {
      showToast(name + ' is already in your plan', [{ label: 'View plan', run: function () { openPlanByName(name); } }]);
    } else confirmPlan(place);
  });
  return button;
}

function peakCard(peak) {
  var place = {
    name: peak.name,
    kind: 'peak',
    lat: peak.lat,
    lng: peak.lng,
    elevation: peak.elevation,
    note: '',
    collectionId: collectionData ? collectionData.id : ''
  };
  var card = el('article', { class: 'peak-card' },
    el('div', { class: 'peak-photo-wrap' }, photoNode(photoRecord(peak), peak.name), bookmarkButton(peak.name, place)),
    el('div', { class: 'peak-card-body' },
      el('h3', { text: peak.name }),
      el('p', { class: 'peak-card-loc', text: (peak.subrange || 'Alps') + ' · ' + Col.countryLabel(peak) }),
      el('p', { class: 'peak-card-elev', text: peak.elevation + ' m' })
    )
  );
  card.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('.bookmark, .photo-credit')) return;
    openPeakPage(peak, 'explore');
  });
  return card;
}

function showTrekDetail(place) {
  var box = document.getElementById('peak-detail');
  if (!box) return;
  var add = el('button', { class: 'primary', type: 'button', text: alreadyPlanned(place.name) ? 'In your plan' : 'Add to plan' });
  add.addEventListener('click', function () {
    if (alreadyPlanned(place.name)) openPlanByName(place.name);
    else {
      addCatalogItem(place);
      showTrekDetail(place);
    }
  });
  box.classList.remove('hidden');
  box.replaceChildren(
    el('h3', { text: place.name }),
    el('p', { text: place.note || '' }),
    el('p', { class: 'muted', text: place.area || '' }),
    add
  );
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function trekCard(place) {
  var card = el('article', { class: 'peak-card' },
    el('div', { class: 'peak-photo-wrap' }, photoNode(peakPhotos['place:' + place.name], place.name), bookmarkButton(place.name, place)),
    el('div', { class: 'peak-card-body' },
      el('h3', { text: place.name }),
      el('p', { class: 'peak-card-loc', text: place.area || '' }),
      el('p', { class: 'peak-card-elev', text: place.note || '' })
    )
  );
  card.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('.bookmark, .photo-credit')) return;
    openTrekPage(place, 'explore');
  });
  return card;
}

function exploreRail(title, meta, cards, id) {
  var head = el('div', { class: 'rail-head' },
    el('h3', { text: title }),
    meta ? el('span', { class: 'progress-count', text: meta }) : null
  );
  if (title === 'Suggested training peaks') {
    var button = el('button', {
      class: 'secondary near-btn',
      type: 'button',
      text: userLocation ? 'Update location' : 'Near you'
    });
    button.addEventListener('click', requestNear);
    head.appendChild(button);
  }
  var section = el('section', { class: 'rail' }, head, el('div', { class: 'rail-scroll' }, cards));
  if (id) section.id = id;
  return section;
}

function kmBetween(from, peak) {
  var dLat = (peak.lat - from.lat) * Math.PI / 180;
  var dLng = (peak.lng - from.lng) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(from.lat * Math.PI / 180) * Math.cos(peak.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function requestNear() {
  if (!navigator.geolocation) {
    nearNote = 'This browser cannot share a location, so nearby peaks stay hidden.';
    renderExploreSheet();
    return;
  }
  navigator.geolocation.getCurrentPosition(function (pos) {
    userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    nearNote = '';
    selectBrowseCollection('near-you');
  }, function () {
    nearNote = 'Location is off, so nearby peaks stay hidden.';
    renderExploreSheet();
  }, { maximumAge: 600000, timeout: 8000 });
}

function dedupedMapPeaks() {
  var seen = {};
  var list = [];
  function add(peak) {
    if (!peak || !Number.isFinite(peak.lat) || !Number.isFinite(peak.lng)) return;
    var key = peak.wikidata || Col.normName(peak.name);
    if (!key || seen[key]) return;
    seen[key] = true;
    list.push(peak);
  }
  if (collectionData) collectionData.peaks.forEach(add);
  sourcedLists.forEach(function (collection) {
    (collection.peaks || []).forEach(add);
  });
  return list;
}

function famousTreks() {
  return Lgc.FAMOUS.filter(function (place) { return place.kind === 'hike'; });
}

function progressHostFor(peak) {
  var active = activeCollectionRecord();
  if (active && active.peaks && active.peaks.some(function (item) { return item.id === peak.id; })) return active;
  if (collectionData && collectionData.peaks.some(function (item) { return item.id === peak.id || item.wikidata === peak.wikidata; })) return collectionData;
  var found = null;
  sourcedLists.forEach(function (collection) {
    if (found || !collection.peaks) return;
    if (collection.peaks.some(function (item) { return item.id === peak.id; })) found = collection;
  });
  return found || collectionData;
}

function collectionProgressText(collection) {
  if (!collection) return '';
  if (collection.kind === 'treks') {
    var treks = famousTreks();
    var done = 0;
    treks.forEach(function (place) {
      if (doneItems().some(function (item) { return Col.normName(item.name) === Col.normName(place.name); })) done += 1;
    });
    return done + '/' + treks.length;
  }
  if (collection.kind === 'near') return nearNote || (userLocation ? 'Around you' : 'Uses your location');
  if (collection.kind === 'next') {
    var steps = nextStepPeaks();
    return steps.length ? steps.length + ' steps' : 'From your log';
  }
  var progress = Col.progress(collection.peaks || [], doneItems());
  return progress.done + '/' + progress.total;
}

function browseCollections() {
  var list = [];
  if (collectionData) list.push(collectionData);
  sourcedLists.forEach(function (collection) { list.push(collection); });
  list.push({ id: 'famous-treks', name: 'Famous treks', kind: 'treks', region: 'Trails' });
  list.push({ id: 'near-you', name: 'Peaks near you', kind: 'near', region: 'Location' });
  list.push({ id: 'next-steps', name: 'Next steps from your logbook', kind: 'next', region: 'Your log' });
  return list;
}

function activeCollectionRecord() {
  if (!activeCollectionId) return null;
  if (activeCollectionId === 'famous-treks') return { id: 'famous-treks', name: 'Famous treks', kind: 'treks', peaks: famousTreks() };
  if (activeCollectionId === 'near-you') return { id: 'near-you', name: 'Peaks near you', kind: 'near', peaks: nearPeaks() };
  if (activeCollectionId === 'next-steps') return { id: 'next-steps', name: 'Next steps from your logbook', kind: 'next', peaks: nextStepPeaks() };
  if (collectionData && collectionData.id === activeCollectionId) return collectionData;
  var found = null;
  sourcedLists.forEach(function (collection) {
    if (collection.id === activeCollectionId) found = collection;
  });
  return found;
}

function nearPeaks() {
  if (!userLocation) return [];
  var pool = dedupedMapPeaks().slice().sort(function (a, b) {
    return kmBetween(userLocation, a) - kmBetween(userLocation, b);
  });
  var close = pool.filter(function (peak) { return kmBetween(userLocation, peak) <= 250; });
  return close.length ? close : pool.slice(0, 8);
}

function nextStepPeaks() {
  if (!collectionData) return [];
  var level = Col.estimateLevel(doneItems(), collectionData.peaks, Store.getLevel());
  var pending = collectionData.peaks.filter(function (peak) { return !Col.isSummited(peak, doneItems()); });
  if (!pending.length) return [];
  pending.sort(function (a, b) {
    var rankA = Col.gradeRank(a.grade);
    var rankB = Col.gradeRank(b.grade);
    if (rankA != null && rankB != null && rankA !== rankB) return rankA - rankB;
    return a.elevation - b.elevation;
  });
  var target = pending[0];
  if (level && (level.grade || typeof level.elevation === 'number')) {
    var above = pending.filter(function (peak) {
      var higherGrade = level.grade && Col.gradeRank(peak.grade) != null && Col.gradeRank(peak.grade) > Col.gradeRank(level.grade);
      var higherElev = typeof level.elevation === 'number' && peak.elevation > level.elevation;
      return higherGrade || higherElev;
    });
    if (above.length) target = above[0];
  }
  var plan = Col.suggestBuildUp(target, collectionData.peaks, level);
  return plan.steps.length ? plan.steps : [target];
}

function snapHeights() {
  var frame = document.getElementById('map-frame');
  var height = frame ? frame.clientHeight : window.innerHeight;
  var peek = 88;
  var full = Math.max(peek + 80, height - 132);
  var half = Math.round(height * 0.46);
  if (half > full - 28) half = Math.round((peek + full) / 2);
  if (half < peek + 40) half = peek + 40;
  return { peek: peek, half: half, full: full };
}

function applySheetSnap(animate) {
  var sheet = document.getElementById('explore-sheet');
  if (!sheet) return;
  if (!exploreSheetOn()) {
    if (sheetMode !== 'peak') {
      document.documentElement.style.setProperty('--sheet-h', '0px');
      return;
    }
    requestAnimationFrame(function () {
      document.documentElement.style.setProperty('--sheet-h', sheet.offsetHeight + 'px');
    });
    return;
  }
  var limits = snapHeights();
  var height = limits[sheetSnap] || limits.peek;
  var motion = animate && !prefersReducedMotion();
  sheet.style.transition = motion ? 'height 280ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
  sheet.style.height = height + 'px';
  document.documentElement.style.setProperty('--sheet-h', height + 'px');
  sheet.classList.toggle('is-peek', sheetSnap === 'peek');
  sheet.classList.toggle('is-half', sheetSnap === 'half');
  sheet.classList.toggle('is-full', sheetSnap === 'full');
}

function fitFeatures(features) {
  if (!map || !features.length) return;
  var bounds = L.latLngBounds(features.map(function (feature) { return [feature.lat, feature.lng]; }));
  map.fitBounds(bounds.pad(0.3), { maxZoom: 8, animate: !prefersReducedMotion() });
}

function selectBrowseCollection(id) {
  if (!exploreSheetOn()) return;
  if (id === 'near-you' && !userLocation) {
    requestNear();
    return;
  }
  activeCollectionId = id;
  sheetMode = 'collection';
  sheetSnap = 'half';
  if (!exploreHist.collection) {
    try {
      history.pushState({ exploreCollection: id }, '');
      exploreHist.collection = true;
    } catch (err) {
      exploreHist.collection = false;
    }
  }
  renderExploreSheet();
  applySheetSnap(true);
  updateMapMarkers();
  var active = activeCollectionRecord();
  if (active && active.kind === 'treks') fitFeatures(famousTreks());
  else if (active && active.peaks) fitFeatures(active.peaks);
}

function clearCollection(fromPop) {
  activeCollectionId = '';
  nearNote = userLocation ? '' : nearNote;
  if (sheetMode !== 'peak') sheetMode = 'home';
  if (!fromPop && exploreHist.collection) {
    exploreHist.collection = false;
    try { history.back(); } catch (err) { exploreHist.collection = false; }
  } else {
    exploreHist.collection = false;
  }
  renderExploreSheet();
  updateMapMarkers();
}

function openExplorePeak() {
  sheetMode = 'peak';
  document.documentElement.classList.add('explore-peak');
  sheetSnap = 'full';
  if (!exploreHist.peak) {
    try {
      history.pushState({ exploreCollection: activeCollectionId || '', explorePeak: true }, '');
      exploreHist.peak = true;
    } catch (err) {
      exploreHist.peak = false;
    }
  }
  applySheetSnap(true);
}

function closeExplorePeak(fromPop) {
  sheetMode = activeCollectionId ? 'collection' : 'home';
  document.documentElement.classList.remove('explore-peak');
  var detail = document.getElementById('peak-detail');
  if (detail) {
    detail.classList.add('hidden');
    clearSheetMotion();
  }
  if (!fromPop && exploreHist.peak) {
    exploreHist.peak = false;
    try { history.back(); } catch (err) { exploreHist.peak = false; }
  } else {
    exploreHist.peak = false;
  }
  renderExploreSheet();
  applySheetSnap(true);
}

function collectionCard(collection) {
  var button = el('button', { class: 'collection-card', type: 'button' },
    el('strong', { text: collection.name }),
    el('span', { text: collectionProgressText(collection) })
  );
  button.addEventListener('click', function () { selectBrowseCollection(collection.id); });
  return button;
}

function renderCollectionPeaks(collection) {
  if (collection.kind === 'near' && nearNote && !collection.peaks.length) {
    return [el('p', { text: nearNote })];
  }
  if (collection.kind === 'next' && !collection.peaks.length) {
    return [el('p', { text: 'Log a summit and the next steps come from the peaks you have already done.' })];
  }
  if (collection.kind === 'treks') {
    return famousTreks().map(function (place) {
      var button = el('button', { class: 'peak-list-row', type: 'button' },
        el('strong', { text: place.name }),
        el('span', { text: place.area || 'Trek' })
      );
      button.addEventListener('click', function () { showTrailSheet(place); });
      return button;
    });
  }
  return (collection.peaks || []).map(function (peak) {
    var meta = peak.elevation + ' m';
    if (peak.grade) meta += ' · ' + peak.grade;
    if (Col.isSummited(peak, doneItems())) meta += ' · done';
    var button = el('button', { class: 'peak-list-row', type: 'button' },
      el('strong', { text: peak.name }),
      el('span', { text: meta })
    );
    button.addEventListener('click', function () { showPeakDetail(peak); });
    return button;
  });
}

function renderExploreSheet() {
  var head = document.getElementById('explore-sheet-head');
  var body = document.getElementById('explore-sheet-body');
  if (!head || !body || !exploreSheetOn()) return;
  if (sheetMode === 'peak') return;
  var active = activeCollectionRecord();
  if (active) {
    var back = el('button', { class: 'sheet-back', type: 'button', 'aria-label': 'All collections', text: '‹' });
    back.addEventListener('click', function () { clearCollection(false); });
    head.replaceChildren(back, el('p', { class: 'sheet-kicker' },
      document.createTextNode(active.name),
      el('small', { text: collectionProgressText(active) })
    ));
    var nodes = renderCollectionPeaks(active);
    body.replaceChildren.apply(body, nodes.length ? nodes : [el('p', { text: 'Nothing in this collection matches.' })]);
    return;
  }
  head.replaceChildren(el('p', { class: 'sheet-kicker', text: 'Find your next peak' }));
  var sourced = browseCollections().filter(function (collection) { return collection.kind !== 'near' && collection.kind !== 'next'; });
  var personal = browseCollections().filter(function (collection) { return collection.kind === 'near' || collection.kind === 'next'; });
  var rows = el('div', { class: 'sheet-rows' },
    el('div', { class: 'collection-row' }, sourced.map(collectionCard)),
    el('div', { class: 'collection-row' }, personal.map(collectionCard))
  );
  var list = el('div', { class: 'sheet-list' });
  browseCollections().forEach(function (collection) { list.appendChild(collectionCard(collection)); });
  if (sheetSnap === 'full') body.replaceChildren(list);
  else body.replaceChildren(rows);
  if (nearNote && !userLocation) body.appendChild(el('p', { class: 'muted', text: nearNote }));
}

function bindExploreSheet() {
  var sheet = document.getElementById('explore-sheet');
  var grab = document.getElementById('explore-grab');
  var head = document.getElementById('explore-sheet-head');
  if (!sheet || !grab || sheet.dataset.bound) return;
  sheet.dataset.bound = '1';
  var drag = null;
  function canDrag(event) {
    if (event.target.closest && event.target.closest('a, input, textarea, select, .sheet-close, .sheet-back, .collection-card, .peak-list-row')) return false;
    return event.target === grab || (head && head.contains(event.target)) || event.target === sheet;
  }
  function start(event) {
    if (!exploreSheetOn()) return;
    if (!document.documentElement.classList.contains('explore-map') || !canDrag(event)) return;
    drag = {
      id: event.pointerId,
      y: event.clientY,
      lastY: event.clientY,
      lastT: Date.now(),
      vy: 0,
      h: sheet.getBoundingClientRect().height
    };
    sheet.setPointerCapture(event.pointerId);
  }
  grab.addEventListener('pointerdown', start);
  head.addEventListener('pointerdown', start);
  sheet.addEventListener('pointermove', function (event) {
    if (!drag || event.pointerId !== drag.id) return;
    var now = Date.now();
    drag.vy = (event.clientY - drag.lastY) / Math.max(1, now - drag.lastT);
    drag.lastY = event.clientY;
    drag.lastT = now;
    if (prefersReducedMotion()) return;
    var limits = snapHeights();
    var next = drag.h - (event.clientY - drag.y);
    next = Math.max(limits.peek - 16, Math.min(limits.full, next));
    sheet.style.transition = 'none';
    sheet.style.height = next + 'px';
    document.documentElement.style.setProperty('--sheet-h', next + 'px');
  });
  function end(event) {
    if (!drag || event.pointerId !== drag.id) return;
    var height = sheet.getBoundingClientRect().height;
    var vy = drag.vy;
    drag = null;
    var limits = snapHeights();
    var names = ['peek', 'half', 'full'];
    var projected = prefersReducedMotion() ? height : height - vy * 160;
    if (sheetMode === 'peak' && (vy > 0.75 || projected < limits.peek + 8)) {
      closeExplorePeak(false);
      return;
    }
    var best = 0;
    var bestDist = Infinity;
    names.forEach(function (name, index) {
      var dist = Math.abs(projected - limits[name]);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    sheetSnap = names[best];
    renderExploreSheet();
    applySheetSnap(true);
  }
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', function (event) { end(event); });
}

function renderExplore() {
  renderExploreSheet();
}

function renderExploreSuggestions() {
  var input = document.getElementById('explore-query');
  var list = document.getElementById('explore-suggestions');
  if (!input || !list) return;
  var query = input.value.trim();
  var matches = query ? Partners.searchObjectives(objectiveCatalog, query, 8) : [];
  input.setAttribute('aria-expanded', matches.length ? 'true' : 'false');
  if (!matches.length) {
    list.replaceChildren();
    return;
  }
  list.replaceChildren.apply(list, matches.map(function (objective, index) {
    var button = el('button', {
      type: 'button',
      role: 'option',
      'data-explore': objective.id,
      'aria-selected': index === 0 ? 'true' : 'false'
    },
      el('span', { class: 'suggestion-name', text: objective.name }),
      el('span', { class: 'badge', text: Partners.kindLabel(objective.kind) })
    );
    return el('li', null, button);
  }));
}

function placeFromObjective(objective) {
  var peak = null;
  if (collectionData) {
    collectionData.peaks.forEach(function (item) {
      if (Col.normName(item.name) === Col.normName(objective.name)) peak = item;
    });
  }
  if (peak) {
    return {
      name: peak.name,
      kind: 'peak',
      lat: peak.lat,
      lng: peak.lng,
      elevation: peak.elevation,
      note: '',
      collectionId: collectionData.id
    };
  }
  var famous = famousByName(objective.name);
  if (famous) return famous;
  return { name: objective.name, kind: objective.kind || 'peak', elevation: objective.elevation, note: objective.note || '' };
}

var peakMini = null;

function dismissPeakPage() {
  peakPageStack = [];
  peakPagePeak = null;
  var page = document.getElementById('peak-page');
  if (page) page.classList.add('hidden');
  if (peakMini) {
    peakMini.remove();
    peakMini = null;
  }
}

function closePeakPage() {
  peakPageStack.pop();
  var top = peakPageStack[peakPageStack.length - 1];
  if (top && top.name) {
    if (top.kind === 'hike' && !top.elevation) renderTrekPage(top);
    else renderPeakPage(top);
    return;
  }
  dismissPeakPage();
}

function openPeakPage(peak, from) {
  if (!peak) return;
  if (from) peakPageStack = [{ from: from }];
  var last = peakPageStack[peakPageStack.length - 1];
  if (!last || last.id !== peak.id) peakPageStack.push(peak);
  renderPeakPage(peak);
}

function openTrekPage(place, from) {
  if (!place) return;
  if (from) peakPageStack = [{ from: from }];
  peakPageStack.push(place);
  renderTrekPage(place);
}

function openPlacePage(place, from) {
  if (!place) return;
  openTrekPage(place, from);
}

function mountMiniMap(peak) {
  var box = document.getElementById('peak-mini');
  if (peakMini) {
    peakMini.remove();
    peakMini = null;
  }
  if (!box || typeof L === 'undefined' || !Number.isFinite(peak.lat) || !Number.isFinite(peak.lng)) return;
  peakMini = L.map(box, {
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    attributionControl: true
  }).setView([peak.lat, peak.lng], 12);
  mutedTiles().addTo(peakMini);
  L.circleMarker([peak.lat, peak.lng], { radius: 7, color: '#1f6b45', fillColor: '#1f6b45', fillOpacity: 0.9 }).addTo(peakMini);
  setTimeout(function () { if (peakMini) peakMini.invalidateSize(); }, 60);
}

function peakStatusLine(peak) {
  if (Col.isSummited(peak, doneItems())) return 'Alpine 4000er · In your logbook';
  if (alreadyPlanned(peak.name)) return 'Alpine 4000er · In your plan';
  return 'Alpine 4000er · Not yet';
}

function renderPeakPage(peak) {
  var page = document.getElementById('peak-page');
  if (!page || !collectionData) return;
  peakPagePeak = peak;
  var planned = alreadyPlanned(peak.name);
  var logged = Col.isSummited(peak, doneItems());
  var level = Col.estimateLevel(doneItems(), collectionData.peaks, Store.getLevel());
  var build = Col.suggestBuildUp(peak, collectionData.peaks, level);
  var back = el('button', { class: 'secondary detail-back', type: 'button', text: 'Back' });
  back.addEventListener('click', closePeakPage);
  var add = el('button', {
    class: 'primary',
    type: 'button',
    text: planned ? 'In your plan' : logged ? 'Plan it again' : 'Add to plan'
  });
  add.addEventListener('click', function () {
    if (alreadyPlanned(peak.name)) {
      showToast(peak.name + ' is already in your plan', [{ label: 'View plan', run: function () { openPlanByName(peak.name); } }]);
      openPlanByName(peak.name);
      return;
    }
    openQuickPlan(placeForPeak(peak));
  });
  var steps = (build.steps || []).map(function (step) {
    var button = el('button', { class: 'linkish', type: 'button', text: step.name });
    button.addEventListener('click', function () { openPeakPage(step); });
    return el('div', { class: 'build-step' }, button, el('p', { class: 'entry-meta', text: peakLine(step) }));
  });
  page.replaceChildren(el('div', { class: 'peak-page-inner' },
    back,
    summitHero(peak),
    el('div', { class: 'detail-copy' },
      el('h2', { class: 'summit-name', text: peak.name }),
      el('p', { class: 'sheet-meta' },
        el('span', { text: peak.elevation + ' m' }),
        el('span', { text: peak.subrange || 'Alps' }),
        el('span', { text: Col.countryLabel(peak) })
      ),
      el('p', { text: peakStatusLine(peak) }),
      logged && !planned ? el('p', { class: 'muted', text: 'You have logged this peak. You can plan it again.' }) : null,
      el('div', { class: 'reference-data' },
        el('p', { class: 'field-label', text: 'Known route' }),
        el('p', null,
          el('span', { text: peak.normalRoute || 'No sourced normal route' }),
          peak.grade ? el('span', { class: 'grade-badge', text: peak.grade }) : null
        ),
        el('p', { class: 'muted', text: 'The grade belongs to this route, not to the mountain by itself.' }),
        peak.sourceUrl ? el('a', { href: peak.sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Route source' }) : null
      ),
      el('div', { id: 'peak-mini', class: 'peak-mini' }),
      el('h3', { text: 'Build up to this peak' }),
      el('p', { text: build.note }),
      steps,
      el('div', { class: 'log-actions' }, add)
    )
  ));
  page.classList.remove('hidden');
  page.scrollTop = 0;
  mountMiniMap(peak);
}

function renderTrekPage(place) {
  var page = document.getElementById('peak-page');
  if (!page) return;
  peakPagePeak = null;
  var planned = alreadyPlanned(place.name);
  var back = el('button', { class: 'secondary detail-back', type: 'button', text: 'Back' });
  back.addEventListener('click', closePeakPage);
  var add = el('button', { class: 'primary', type: 'button', text: planned ? 'In your plan' : 'Add to plan' });
  add.addEventListener('click', function () {
    if (alreadyPlanned(place.name)) {
      showToast(place.name + ' is already in your plan', [{ label: 'View plan', run: function () { openPlanByName(place.name); } }]);
      openPlanByName(place.name);
      return;
    }
    openQuickPlan(place);
  });
  var photo = peakPhotos['place:' + place.name];
  var hero = el('div', { class: 'summit-hero' });
  var src = safePhotoUrl(photo && photo.thumb);
  if (src) {
    var img = el('img', { alt: '', src: src });
    hero.appendChild(img);
    if (photo.page) hero.appendChild(el('a', { class: 'photo-credit', href: photo.page, target: '_blank', rel: 'noopener noreferrer', text: photo.license || 'Photo' }));
  } else {
    hero.appendChild(el('div', { class: 'summit-hero-fallback', role: 'img', 'aria-label': 'Illustrated placeholder' }));
  }
  page.replaceChildren(el('div', { class: 'peak-page-inner' },
    back,
    hero,
    el('div', { class: 'detail-copy' },
      el('h2', { class: 'summit-name', text: place.name }),
      el('p', { class: 'sheet-meta' },
        el('span', { text: place.area || 'Trail' }),
        el('span', { text: place.note || '' })
      ),
      el('div', { class: 'log-actions' }, add)
    )
  ));
  page.classList.remove('hidden');
  page.scrollTop = 0;
}

function addExploreObjective(id) {
  var found = null;
  objectiveCatalog.forEach(function (objective) {
    if (objective.id === id) found = objective;
  });
  if (!found) return;
  var peak = null;
  if (collectionData) {
    collectionData.peaks.forEach(function (item) {
      if (Col.normName(item.name) === Col.normName(found.name)) peak = item;
    });
  }
  if (peak) {
    openPeakPage(peak, 'search');
    return;
  }
  var famous = famousByName(found.name);
  if (famous) {
    openTrekPage(famous, 'search');
    return;
  }
  openPlacePage(placeFromObjective(found), 'search');
}

document.getElementById('plan-quick-add').addEventListener('click', function () { finishQuickPlan(true); });
document.getElementById('plan-quick-skip').addEventListener('click', function () { finishQuickPlan(false); });
document.getElementById('map-chips').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('[data-map-filter]') : null;
  if (!button) return;
  mapFilter = button.getAttribute('data-map-filter');
  if (activeCollectionId) clearCollection(false);
  document.querySelectorAll('#map-chips .map-chip').forEach(function (chip) {
    var on = chip === button;
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  updateMapMarkers();
});
function renderMapSuggestions() {
  var input = document.getElementById('map-query');
  var list = document.getElementById('map-suggestions');
  if (!input || !list) return;
  var matches = mapQuery ? Partners.searchObjectives(objectiveCatalog, mapQuery, 6) : [];
  input.setAttribute('aria-expanded', matches.length ? 'true' : 'false');
  if (!matches.length) {
    list.replaceChildren();
    return;
  }
  list.replaceChildren.apply(list, matches.map(function (objective, index) {
    return el('li', null, el('button', {
      type: 'button',
      role: 'option',
      'data-map-objective': objective.id,
      'aria-selected': index === 0 ? 'true' : 'false'
    },
      el('span', { class: 'suggestion-name', text: objective.name }),
      el('span', { class: 'badge', text: Partners.kindLabel(objective.kind) })
    ));
  }));
}

function setMapSearch(value, fit) {
  var input = document.getElementById('map-query');
  if (input && input.value !== value) input.value = value;
  mapQuery = String(value || '').trim();
  var clear = document.getElementById('map-query-clear');
  if (clear) clear.classList.toggle('hidden', !mapQuery);
  renderMapSuggestions();
  updateMapMarkers();
  if (!fit || !map || mapQuery.length < 2) return;
  var matches = mapFeatures();
  if (!matches.length) return;
  var bounds = L.latLngBounds(matches.map(function (feature) { return [feature.lat, feature.lng]; }));
  map.fitBounds(bounds.pad(0.35), { maxZoom: 9, animate: !prefersReducedMotion() });
}

function chooseMapSuggestion(id) {
  var found = null;
  objectiveCatalog.forEach(function (objective) {
    if (objective.id === id) found = objective;
  });
  if (!found) return;
  var list = document.getElementById('map-suggestions');
  if (list) list.replaceChildren();
  var peak = null;
  if (collectionData) {
    collectionData.peaks.forEach(function (item) {
      if (Col.normName(item.name) === Col.normName(found.name)) peak = item;
    });
  }
  dedupedMapPeaks().forEach(function (item) {
    if (!peak && Col.normName(item.name) === Col.normName(found.name)) peak = item;
  });
  setMapSearch('', false);
  var input = document.getElementById('map-query');
  if (input) input.value = '';
  if (peak) {
    showPeakDetail(peak);
    return;
  }
  var famous = famousByName(found.name);
  if (famous && famous.kind === 'hike') showTrailSheet(famous);
  else if (famous) showPeakDetail(famous);
}

document.getElementById('map-query').addEventListener('input', function () {
  setMapSearch(document.getElementById('map-query').value, true);
});
document.getElementById('map-query-clear').addEventListener('click', function () {
  setMapSearch('', false);
  document.getElementById('map-query').focus();
});
document.getElementById('map-suggestions').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('[data-map-objective]') : null;
  if (!button) return;
  chooseMapSuggestion(button.getAttribute('data-map-objective'));
});
document.getElementById('map-filter').addEventListener('click', function () {
  var chips = document.getElementById('map-chips');
  if (chips) chips.scrollIntoView({ block: 'nearest', inline: 'start' });
});
document.getElementById('map-search-form').addEventListener('submit', function (event) {
  event.preventDefault();
  var hit = mapFeatures()[0];
  if (!hit || !map) return;
  map.setView([hit.lat, hit.lng], Math.max(map.getZoom(), 10));
  openFeature(hit);
});

document.getElementById('collection-progress').addEventListener('click', function () {
  selectTab('explore');
  selectBrowseCollection(collectionData ? collectionData.id : 'uiaa-alps-4000');
});

function refreshLogbookView(done) {
  if (logbookView === 'map') renderLogbookMap(done);
  if (logbookView === 'calendar') renderCalendar(done);
  if (logbookView === 'stats') renderPersonalStats(done);
}

function setLogbookView(name) {
  logbookView = name === 'map' || name === 'calendar' || name === 'stats' ? name : 'timeline';
  if (logbookView === 'calendar' && !calendarTouched) {
    var dates = Lgc.doneOrder(items).map(function (item) { return item.date; }).filter(Boolean).sort();
    if (dates.length) calendarCursor = new Date(dates[dates.length - 1] + 'T12:00:00');
  }
  ['timeline', 'map', 'calendar', 'stats'].forEach(function (view) {
    var pane = document.getElementById('logbook-' + view);
    if (pane) pane.classList.toggle('hidden', view !== logbookView);
    var button = document.querySelector('#logbook-views [data-view="' + view + '"]');
    if (!button) return;
    button.classList.toggle('active', view === logbookView);
    button.setAttribute('aria-selected', view === logbookView ? 'true' : 'false');
  });
  refreshLogbookView(Lgc.doneOrder(items).filter(matchesLogbook));
}

function renderLogbookMap(done) {
  var box = document.getElementById('logbook-map');
  if (!box || typeof L === 'undefined') {
    if (box) box.replaceChildren(el('p', { class: 'muted', text: 'The map did not load.' }));
    return;
  }
  if (!logbookMap) {
    logbookMap = L.map(box, { zoomControl: false }).setView([46.5, 8.5], 5);
    mutedTiles().addTo(logbookMap);
  }
  logbookMarkers.forEach(function (marker) { logbookMap.removeLayer(marker); });
  logbookMarkers = [];
  var bounds = [];
  done.forEach(function (item) {
    if (!Lgc.hasCoords(item)) return;
    var marker = L.circleMarker([item.lat, item.lng], { radius: 7, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.85 }).addTo(logbookMap);
    marker.bindPopup(item.name);
    logbookMarkers.push(marker);
    bounds.push([item.lat, item.lng]);
  });
  setTimeout(function () {
    if (!logbookMap) return;
    logbookMap.invalidateSize();
    if (bounds.length) logbookMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 8 });
  }, 60);
}

function renderCalendar(done) {
  var box = document.getElementById('logbook-calendar');
  if (!box) return;
  var year = calendarCursor.getFullYear();
  var month = calendarCursor.getMonth();
  var first = new Date(year, month, 1);
  var start = (first.getDay() + 6) % 7;
  var days = new Date(year, month + 1, 0).getDate();
  var byDay = {};
  done.forEach(function (item) {
    if (!item.date || item.date.slice(0, 7) !== year + '-' + String(month + 1).padStart(2, '0')) return;
    var day = Number(item.date.slice(8, 10));
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(item.name);
  });
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var prev = el('button', { class: 'secondary', type: 'button', text: 'Previous' });
  var next = el('button', { class: 'secondary', type: 'button', text: 'Next' });
  prev.addEventListener('click', function () {
    calendarTouched = true;
    calendarCursor = new Date(year, month - 1, 1);
    renderCalendar(done);
  });
  next.addEventListener('click', function () {
    calendarTouched = true;
    calendarCursor = new Date(year, month + 1, 1);
    renderCalendar(done);
  });
  var grid = el('div', { class: 'calendar-grid' });
  ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].forEach(function (label) {
    grid.appendChild(el('span', { class: 'calendar-dow', text: label }));
  });
  for (var i = 0; i < start; i++) grid.appendChild(el('span', { class: 'calendar-empty' }));
  for (var day = 1; day <= days; day++) {
    var cell = el('span', { class: byDay[day] ? 'calendar-day has' : 'calendar-day', text: String(day) });
    if (byDay[day]) cell.title = byDay[day].join(', ');
    grid.appendChild(cell);
  }
  var listed = el('ul', { class: 'resume-list' });
  Object.keys(byDay).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (day) {
    listed.appendChild(el('li', { text: day + ' · ' + byDay[day].join(', ') }));
  });
  box.replaceChildren(
    el('div', { class: 'calendar-nav' }, prev, el('strong', { text: months[month] + ' ' + year }), next),
    grid,
    listed.childNodes.length ? listed : el('p', { class: 'muted', text: 'Nothing logged in this month.' })
  );
}

function renderPersonalStats(done) {
  var box = document.getElementById('logbook-stats');
  if (!box) return;
  var summits = done.filter(function (item) { return item.activityType === 'mountaineering'; });
  var summitElevation = summits.reduce(function (sum, item) { return sum + (item.elevation || 0); }, 0);
  var distance = done.reduce(function (sum, item) { return sum + (item.distance || 0); }, 0);
  var gain = done.reduce(function (sum, item) {
    return sum + (item.elevationGain || 0) + (item.activityType === 'hiking' ? (item.elevation || 0) : 0);
  }, 0);
  var rock = done.filter(function (item) { return item.activityType === 'rock'; }).length;
  var hikes = done.filter(function (item) { return item.activityType === 'hiking'; }).length;
  var order = (Col && Col.GRADE_ORDER) || [];
  var recorded = [];
  done.forEach(function (item) {
    if (item.grade && recorded.indexOf(item.grade) < 0) recorded.push(item.grade);
  });
  var known = recorded.filter(function (grade) { return order.indexOf(grade) >= 0; }).sort(function (a, b) {
    return order.indexOf(a) - order.indexOf(b);
  });
  var other = recorded.filter(function (grade) { return order.indexOf(grade) < 0; });
  var lines = [
    el('p', { class: 'muted', text: 'These numbers are only yours. Nothing here is a comparison.' }),
    el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('strong', { text: String(summits.length) }), el('span', { text: 'Summits' })),
      el('div', { class: 'stat' }, el('strong', { text: String(rock) }), el('span', { text: 'Rock routes' })),
      el('div', { class: 'stat' }, el('strong', { text: String(hikes) }), el('span', { text: 'Treks' }))
    ),
    el('p', { text: 'Summit elevation in your log: ' + summitElevation + ' m.' }),
    el('p', { text: 'Distance you recorded: ' + Math.round(distance * 10) / 10 + ' km.' }),
    el('p', { text: 'Elevation gain you recorded: ' + gain + ' m.' })
  ];
  if (known.length) lines.push(el('p', { text: 'Alpine grades in your log, easier to harder: ' + known.join(', ') + '.' }));
  if (other.length) lines.push(el('p', { text: 'Other grades you recorded: ' + other.join(', ') + '.' }));
  if (!recorded.length) lines.push(el('p', { class: 'muted', text: 'No grade recorded yet.' }));
  if (known.length) lines.push(el('p', { text: 'The hardest alpine grade in your log is ' + known[known.length - 1] + '.' }));
  box.replaceChildren.apply(box, lines);
}

document.getElementById('logbook-views').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('[data-view]') : null;
  if (!button) return;
  setLogbookView(button.getAttribute('data-view'));
});

function placeChatAboveKeyboard() {
  var screen = document.getElementById('chat-screen');
  if (!screen || screen.classList.contains('hidden') || !window.visualViewport) return;
  var active = document.activeElement;
  var inComposer = active && active.closest && active.closest('.composer');
  if (!inComposer) {
    screen.style.height = '';
    return;
  }
  var header = document.querySelector('#app > header');
  var nav = document.querySelector('#app > nav');
  var available = window.visualViewport.height - (header ? header.offsetHeight : 0) - (nav ? nav.offsetHeight : 0) - 8;
  screen.style.height = Math.max(220, Math.round(available)) + 'px';
}

function focusFieldIntoView(target) {
  if (!target || !target.matches || !target.matches('input, textarea, select')) return;
  if (target.closest && target.closest('#map-chrome, .map-search, #map-search-form')) return;
  if (target.closest && target.closest('.composer')) {
    placeChatAboveKeyboard();
    return;
  }
  window.setTimeout(function () {
    if (!target.isConnected) return;
    target.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth'
    });
  }, 280);
}

document.addEventListener('focusin', function (event) {
  focusFieldIntoView(event.target);
});
document.addEventListener('focusout', function (event) {
  var target = event.target;
  if (!target || !target.closest || !target.closest('.composer')) return;
  window.setTimeout(function () {
    var active = document.activeElement;
    if (!active || !active.closest || !active.closest('.composer')) placeChatAboveKeyboard();
  }, 60);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', function () {
    var active = document.activeElement;
    if (active && active.closest && active.closest('.composer')) placeChatAboveKeyboard();
    else focusFieldIntoView(active);
  });
}
window.addEventListener('resize', function () {
  var active = document.activeElement;
  if (!active) return;
  if (active.closest && active.closest('.composer')) placeChatAboveKeyboard();
  else focusFieldIntoView(active);
});

// ---- Init ----
bindViewport();
sizeFullMap();
registerServiceWorker();

if (window.SummitChat) {
  SummitChat.bind({
    selectPartners: function () {
      var section = document.getElementById('partners');
      if (section && !section.classList.contains('hidden')) return;
      selectTab('partners');
    },
    getPlanByName: function (name) {
      var found = null;
      items.forEach(function (item) {
        if (item && Partners.fold(item.name) === Partners.fold(name || '')) found = item;
      });
      return found;
    },
    signIn: function () { showLogin(); },
    openRequest: function (name) {
      var item = null;
      items.forEach(function (entry) {
        if (entry && entry.status === 'planned' && Partners.fold(entry.name) === Partners.fold(name || '')) item = entry;
      });
      if (item) startPartnerFrom(item.id);
      else selectTab('partners');
    }
  });
}

if (window.SummitProfile) {
  SummitProfile.bind({
    getItems: function () { return items; },
    peaks: function () { return collectionData && collectionData.peaks ? collectionData.peaks : []; },
    photoFor: function (item) {
      var peak = collectionPeakByName(item);
      return peak ? photoRecord(peak) : null;
    },
    openStats: function () { selectTab('logbook'); setLogbookView('stats'); },
    openLogbook: function () { selectTab('logbook'); },
    openMemory: function (id) { selectTab('logbook'); showMemory(id); },
    signIn: function () { showLogin(); }
  });
}

document.getElementById('push-enable') && document.getElementById('push-enable').addEventListener('click', function () {
  if (window.SummitChat && SummitChat.enablePush) SummitChat.enablePush();
  else showLogin();
});

var params = new URLSearchParams(window.location.search);
var openChat = params.get('chat');
if (openChat && window.SummitChat) {
  window.addEventListener('load', function () {
    setTimeout(function () { SummitChat.openConversation(openChat); }, 600);
  });
}
if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type === 'open-chat' && data.conversationId && window.SummitChat) {
      SummitChat.openConversation(data.conversationId);
    }
  });
}

document.addEventListener('DOMContentLoaded', function () {
  if (window.SummitAccount) SummitAccount.prepareScreen();
  if (Store.isIntroDismissed()) showApp();
  else {
    showIntro(false);
    if (window.SummitAccount && SummitAccount.configured()) {
      SummitAccount.boot(accountSnapshot).then(function (sessionUser) {
        if (sessionUser) showApp();
      });
    }
  }
});
