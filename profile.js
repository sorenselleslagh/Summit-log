// Profile screen: own page, someone else's page, and credential chips.
// Verified is never written from here. A pending chip means a proof was offered.
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SummitProfile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var CATALOG = [
    { code: 'ifmga', label: 'IFMGA/UIAGM Mountain guide', detail: 'A professional mountain guide qualification. It is a credential, not a ranking.', group: 'Guides' },
    { code: 'uimla', label: 'UIMLA Mountain leader', detail: 'An international mountain leader qualification for trekking, not glacier guiding.', group: 'Guides' },
    { code: 'aspirant', label: 'Aspirant guide', detail: 'Training toward a guide qualification. Not a finished licence.', group: 'Guides' },
    { code: 'kvb1', label: 'KVB1', detail: 'A club rock course, often the first course before leading.', group: 'Club courses' },
    { code: 'kvb2', label: 'KVB2 lead', detail: 'A club course on leading single-pitch rock climbs.', group: 'Club courses' },
    { code: 'kvb3', label: 'KVB3 multipitch', detail: 'A club course on multipitch rock climbs.', group: 'Club courses' },
    { code: 'c1', label: 'C1 glacier course', detail: 'An introductory course in glacier travel.', group: 'Club courses' },
    { code: 'first_aid', label: 'First aid', detail: 'A current first-aid certificate.', group: 'Care' },
    { code: 'wfr', label: 'Wilderness First Responder', detail: 'A wilderness medicine qualification.', group: 'Care' },
    { code: 'avy', label: 'Avalanche course', detail: 'An avalanche awareness or rescue course.', group: 'Care' }
  ];

  var hooks = {
    getItems: function () { return []; },
    peaks: function () { return []; },
    photoFor: function () { return null; },
    openStats: function () {},
    openLogbook: function () {},
    openMemory: function () {},
    signIn: function () {},
    requestTogether: function () {}
  };
  var screenMode = 'own';
  var previewing = false;
  var editing = false;
  var other = null;
  var pendingPhoto = null;
  var proofFiles = {};
  var serverVerified = [];

  function byCode(code) {
    var found = null;
    CATALOG.forEach(function (row) { if (row.code === code) found = row; });
    return found;
  }

  function fold(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function el(tag, props) {
    var node = document.createElement(tag);
    var children = Array.prototype.slice.call(arguments, 2);
    if (props) {
      Object.keys(props).forEach(function (key) {
        if (key === 'text') node.textContent = props[key] == null ? '' : String(props[key]);
        else if (key === 'class') node.className = props[key];
        else node.setAttribute(key, props[key]);
      });
    }
    children.forEach(function (child) {
      if (child == null || child === false) return;
      if (Array.isArray(child)) {
        child.forEach(function (nested) { if (nested) node.appendChild(nested); });
        return;
      }
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function svgIcon(path) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.8');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }

  function store() { return root.SummitLogStorage; }
  function account() { return root.SummitAccount; }
  function signedIn() {
    var api = account();
    return !!(api && api.user && api.user() && api.client && api.client());
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'You';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function doneItems() {
    return (hooks.getItems() || []).filter(function (item) { return item && item.status !== 'planned'; });
  }

  function counts(items, peaks) {
    var summits = 0;
    var gain = 0;
    var haveGain = false;
    var names = {};
    (peaks || []).forEach(function (peak) {
      if (peak && peak.name) names[fold(peak.name)] = true;
    });
    var four = 0;
    (items || []).forEach(function (item) {
      if (!item || item.status === 'planned') return;
      if (item.kind === 'peak') {
        summits += 1;
        if (names[fold(item.name)]) four += 1;
      }
      if (typeof item.elevationGain === 'number') {
        gain += item.elevationGain;
        haveGain = true;
      }
    });
    return { summits: summits, gain: haveGain ? Math.round(gain) : null, four: four };
  }

  function publicCredentials(rows) {
    return (rows || []).filter(function (row) {
      return row && (row.status === 'self_declared' || row.status === 'verified') && !row.proofPath && !row.path;
    }).map(function (row) {
      return { code: row.code, status: row.status, reviewedAt: row.reviewedAt || row.reviewed_at || '' };
    });
  }

  function assignCredential(existing, code, status) {
    if (!byCode(code)) return { ok: false, reason: 'unknown' };
    if (status === 'verified') return { ok: false, reason: 'verified' };
    var nextStatus = status === 'pending' ? 'pending' : 'self_declared';
    var list = (existing || []).filter(function (row) { return row.code !== code; });
    list.push({ code: code, status: nextStatus, declaredAt: new Date().toISOString() });
    return { ok: true, items: list };
  }

  function factChips(stats) {
    var chips = [];
    if (stats && stats.four > 0) {
      chips.push({
        code: 'fact-4000',
        label: '4000er summits: ' + stats.four,
        detail: 'Counted from your own log. A personal fact, not a qualification and not a ranking.',
        status: 'fact'
      });
    }
    return chips;
  }

  function paintAvatarButtons(name) {
    var userId = signedIn() ? account().user().id : '';
    ['profile-btn', 'map-profile'].forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      if (root.SummitChat && SummitChat.paintAvatar) SummitChat.paintAvatar(node, userId, name);
      else if (!node.querySelector('img')) node.textContent = initials(name);
    });
  }

  function photoNode(name, url) {
    if (url) {
      var img = el('img', { class: 'profile-photo', alt: '' });
      img.src = url;
      return img;
    }
    return el('span', { class: 'profile-photo profile-initials', text: initials(name) });
  }

  function chipButton(row) {
    var type = byCode(row.code) || { label: row.label || row.code, detail: row.detail || '' };
    var status = row.status || 'self_declared';
    var button = el('button', {
      type: 'button',
      class: 'cred-chip is-' + status,
      'data-chip': row.code,
      text: type.label || row.label
    });
    if (status === 'verified') button.appendChild(svgIcon('M5 12.5l4.2 4.2L19 7.2'));
    button.addEventListener('click', function () { showChipDetail(type, row); });
    return button;
  }

  function showChipDetail(type, row) {
    var host = document.getElementById('profile-screen');
    if (!host) return;
    var when = row.reviewedAt || row.reviewed_at || '';
    var meaning = type.detail || row.detail || '';
    var how = 'You added this yourself. It has not been checked.';
    if (row.status === 'verified') how = 'Checked by SummitLog review' + (when ? ' on ' + new Date(when).toLocaleDateString() : '') + '. You cannot mark your own chip verified.';
    if (row.status === 'pending') how = 'A certificate is waiting for review. Until then this stays pending, not verified.';
    if (row.status === 'fact') how = 'This comes from your log. It is not a qualification.';
    var card = el('div', { class: 'card chip-detail', id: 'chip-detail' },
      el('h3', { text: type.label || row.label }),
      el('p', { text: meaning }),
      el('p', { class: 'muted', text: how }),
      (function () {
        var back = el('button', { class: 'secondary', type: 'button', text: 'Close' });
        back.addEventListener('click', function () { card.remove(); });
        return back;
      })()
    );
    var old = document.getElementById('chip-detail');
    if (old) old.remove();
    host.appendChild(card);
  }

  function statTile(value, label, onClick) {
    var button = el('button', { type: 'button', class: 'stat-tile' },
      el('strong', { text: value }),
      el('span', { text: label })
    );
    button.addEventListener('click', onClick);
    return button;
  }

  function activityCard(item, favourite) {
    var photo = hooks.photoFor(item);
    var card = el('article', { class: 'activity-card' });
    if (photo && photo.thumb) {
      card.style.backgroundImage = 'linear-gradient(180deg, rgba(11,17,32,0.15), rgba(11,17,32,0.82)), url("' + String(photo.thumb).replace(/"/g, '') + '")';
    }
    var bits = [];
    if (typeof item.distance === 'number') bits.push(['M4 15h16M7 15l2-6 3 3 3-5 2 8', item.distance + ' km']);
    if (item.duration) bits.push(['M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', item.duration]);
    if (typeof item.elevationGain === 'number') bits.push(['M4 18l6-8 4 4 6-8', item.elevationGain + ' m']);
    var metrics = el('p', { class: 'activity-metrics' });
    bits.forEach(function (pair) {
      var span = el('span', null, svgIcon(pair[0]), document.createTextNode(pair[1]));
      metrics.appendChild(span);
    });
    var pin = el('button', {
      type: 'button',
      class: 'fav-pin',
      'aria-label': favourite ? 'Unpin favourite' : 'Pin favourite',
      'aria-pressed': favourite ? 'true' : 'false',
      text: favourite ? 'Pinned' : 'Pin'
    });
    pin.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleFavourite(item.id);
    });
    var title = el('h3', { text: item.name });
    card.appendChild(el('div', { class: 'activity-copy' },
      item.visibility === 'private' ? el('span', { class: 'lock-mark', text: 'Private' }) : null,
      el('p', { class: 'activity-date', text: item.date || 'Date not set' }),
      title,
      metrics,
      pin
    ));
    card.addEventListener('click', function () { hooks.openMemory(item.id); });
    return card;
  }

  function toggleFavourite(id) {
    var repo = store();
    if (!repo || !repo.loadFavourites) return;
    var ids = repo.loadFavourites();
    var next = ids.indexOf(id) >= 0 ? ids.filter(function (row) { return row !== id; }) : ids.concat([id]);
    repo.saveFavourites(next);
    paint();
  }

  function localProfile() {
    var repo = store();
    var profile = repo && repo.loadProfile ? repo.loadProfile() : { bio: '', homeBase: '', isPrivate: false };
    var accountUser = signedIn() ? account().user() : null;
    var first = accountUser && accountUser.firstName ? accountUser.firstName : '';
    var last = accountUser && accountUser.lastName ? accountUser.lastName : '';
    var name = first && last ? (first + ' ' + last) : '';
    if (!name && repo && repo.getDisplayName) name = repo.getDisplayName();
    if (!name && accountUser) name = accountUser.displayName || '';
    return {
      name: name || 'You',
      firstName: first,
      lastName: last,
      email: accountUser && accountUser.email ? accountUser.email : '',
      bio: profile.bio,
      homeBase: profile.homeBase,
      isPrivate: profile.isPrivate,
      credentials: repo && repo.loadCredentials ? repo.loadCredentials() : []
    };
  }

  function settingsBox(show) {
    var box = document.getElementById('profile-settings');
    if (box) box.classList.toggle('hidden', !show);
  }

  function paint() {
    var host = document.getElementById('profile-screen');
    if (!host) return;
    settingsBox(screenMode === 'own' && !previewing);
    if (screenMode === 'other' && other) paintOther(host);
    else if (editing) paintEdit(host);
    else paintOwn(host);
  }

  function paintOwn(host) {
    var me = localProfile();
    var items = doneItems();
    var visible = previewing ? items.filter(function (item) { return item.visibility !== 'private'; }) : items;
    var creds = (previewing ? publicCredentials(me.credentials.concat(serverVerified)) : me.credentials.concat(serverVerified));
    var stats = counts(visible, hooks.peaks());
    var favs = store() && store().loadFavourites ? store().loadFavourites() : [];
    paintAvatarButtons(me.name);
    var chips = creds.map(function (row) {
      var type = byCode(row.code);
      return chipButton({ code: row.code, status: row.status, label: type ? type.label : row.code, detail: type ? type.detail : '', reviewedAt: row.reviewedAt });
    }).concat(factChips(stats).map(chipButton));
    var gallery = el('div', { class: 'gallery-row', id: 'profile-gallery' });
    var activities = visible.slice(0, 12).map(function (item) {
      return activityCard(item, favs.indexOf(item.id) >= 0);
    });
    var edit = el('button', { class: 'primary', type: 'button', id: 'edit-profile', text: previewing ? 'Back to your view' : 'Edit profile' });
    edit.addEventListener('click', function () {
      if (previewing) { previewing = false; paint(); return; }
      editing = true;
      paint();
    });
    var preview = el('button', { class: 'secondary', type: 'button', text: 'Preview as others see it' });
    preview.addEventListener('click', function () { previewing = true; paint(); });
    var sign = null;
    if (!signedIn()) {
      sign = el('button', { class: 'primary btn-block', type: 'button', id: 'profile-sign-in', text: 'Sign in to sync & find partners' });
      sign.addEventListener('click', function () { hooks.signIn(); });
    }
    var pieces = [
      sign ? el('div', { class: 'card sign-in-prompt' },
        el('p', { text: 'This profile is on this device. Sign in when you want the same log and partner requests on your account.' }),
        sign
      ) : null,
      previewing ? el('p', { class: 'preview-banner', text: 'This is what other people can see. Private plans, notes, and certificates stay hidden.' }) : null,
      el('article', { class: 'card profile-head-card' },
        photoNode(me.name, pendingPhoto),
        el('h2', { class: 'profile-name', text: me.name }),
        !previewing && me.email ? el('p', { class: 'profile-email', text: me.email }) : null,
        me.bio && !(previewing && me.isPrivate) ? el('p', { text: me.bio }) : null,
        me.homeBase && !(previewing && me.isPrivate) ? el('p', { class: 'profile-home', text: me.homeBase }) : null,
        me.isPrivate ? el('p', { class: 'lock-mark', text: 'Private profile' }) : null,
        el('div', { class: 'profile-actions' }, edit, previewing ? null : preview)
      ),
      el('section', { class: 'card' },
        el('h3', { text: 'Credentials' }),
        el('p', { class: 'muted small', text: 'An outline chip is self-declared. A green chip was checked by review. You cannot verify your own.' }),
        el('div', { class: 'chip-row' }, chips.length ? chips : [el('p', { class: 'muted', text: 'No credentials yet.' })])
      ),
      el('div', { class: 'stat-row' },
        statTile(String(stats.summits), 'Summits', hooks.openStats),
        statTile(stats.gain == null ? '—' : String(stats.gain), 'Elevation gained', hooks.openStats),
        statTile(stats.four + '/82', '4000ers', hooks.openStats)
      ),
      el('section', { class: 'card' },
        el('div', { class: 'section-head' },
          el('h3', { text: 'Gallery' }),
          (function () {
            var all = el('button', { class: 'secondary', type: 'button', text: 'View all' });
            all.addEventListener('click', hooks.openLogbook);
            return all;
          })()
        ),
        gallery
      ),
      el('section', null,
        el('h3', { class: 'profile-section-title', text: 'Activity' }),
        activities.length ? activities : [el('p', { class: 'muted', text: 'No logged activity yet.' })]
      ),
      signedIn() && account().user().admin && !previewing ? adminSlot() : null
    ];
    host.replaceChildren.apply(host, pieces.filter(Boolean));
    fillGallery(visible);
    loadAvatarInto(host.querySelector('.profile-photo'));
  }

  function adminSlot() {
    var box = el('section', { class: 'card', id: 'admin-review' },
      el('h3', { text: 'Review credentials' }),
      el('p', { class: 'muted small', text: 'Only an admin can mark a chip verified. Proof files are not public.' }),
      el('div', { id: 'admin-list' }, el('p', { class: 'muted', text: 'Loading requests…' }))
    );
    loadAdmin(box.querySelector('#admin-list'));
    return box;
  }

  function loadAdmin(list) {
    var db = account().client();
    db.from('profile_credentials').select('id, profile_id, code, status').eq('status', 'pending').then(function (result) {
      if (!list.isConnected) return;
      if (result.error || !result.data || !result.data.length) {
        list.replaceChildren(el('p', { class: 'muted', text: result.error ? 'Review is not available yet.' : 'Nothing waiting.' }));
        return;
      }
      list.replaceChildren.apply(list, result.data.map(function (row) {
        var type = byCode(row.code);
        var yes = el('button', { class: 'primary', type: 'button', text: 'Mark verified' });
        var no = el('button', { class: 'secondary', type: 'button', text: 'Decline' });
        yes.addEventListener('click', function () { decide(row.id, 'verified', list); });
        no.addEventListener('click', function () { decide(row.id, 'rejected', list); });
        return el('div', { class: 'admin-row' },
          el('p', { text: (type ? type.label : row.code) }),
          el('div', { class: 'partner-actions' }, yes, no)
        );
      }));
    }).catch(function () {
      if (list.isConnected) list.replaceChildren(el('p', { class: 'muted', text: 'Review is not available yet.' }));
    });
  }

  function decide(id, decision, list) {
    account().client().rpc('review_credential', { credential_id: id, decision: decision }).then(function (result) {
      if (result.error) return;
      loadAdmin(list);
    });
  }

  function fillGallery(items) {
    var row = document.getElementById('profile-gallery');
    var photos = root.SummitPhotos;
    if (!row || !photos || !photos.list) return;
    var jobs = items.slice(0, 12).map(function (item) { return photos.list(item.id); });
    Promise.all(jobs).then(function (groups) {
      if (!row.isConnected) return;
      var thumbs = [];
      groups.forEach(function (list) {
        if (list && list[0] && list[0].blob && thumbs.length < 8) thumbs.push(list[0].blob);
      });
      if (!thumbs.length) {
        row.replaceChildren(el('p', { class: 'muted', text: 'Photos from the logbook show up here.' }));
        return;
      }
      row.replaceChildren.apply(row, thumbs.map(function (blob) {
        var img = el('img', { class: 'gallery-shot', alt: 'Logbook photo' });
        img.src = URL.createObjectURL(blob);
        return img;
      }));
    }).catch(function () {});
  }

  function loadAvatarInto(node) {
    var photos = root.SummitPhotos;
    if (!node || !photos || !photos.getAvatar || node.tagName === 'IMG') return;
    photos.getAvatar().then(function (row) {
      if (!row || !row.blob || !node.isConnected) return;
      var img = el('img', { class: 'profile-photo', alt: '' });
      img.src = URL.createObjectURL(row.blob);
      node.replaceWith(img);
    }).catch(function () {});
  }

  function paintEdit(host) {
    var me = localProfile();
    var stored = me.name === 'You' ? '' : me.name;
    var parts = String(stored || '').trim().split(/\s+/).filter(Boolean);
    var nameFirst = el('input', { id: 'profile-first', type: 'text', maxlength: '40', 'aria-label': 'First name', required: 'required' });
    var nameLast = el('input', { id: 'profile-last', type: 'text', maxlength: '40', 'aria-label': 'Last name', required: 'required' });
    nameFirst.value = me.firstName || (parts[0] || '');
    nameLast.value = me.lastName || (parts.length > 1 ? parts.slice(1).join(' ') : '');
    var bio = el('textarea', { id: 'profile-bio', rows: '3', maxlength: '280', 'aria-label': 'Short bio' });
    bio.value = me.bio;
    var home = el('input', { id: 'profile-home', type: 'text', maxlength: '80', 'aria-label': 'Home base' });
    home.value = me.homeBase;
    var priv = el('input', { id: 'profile-private', type: 'checkbox' });
    priv.checked = me.isPrivate;
    var file = el('input', { id: 'profile-photo', type: 'file', accept: 'image/*', 'aria-label': 'Profile photo' });
    var preview = photoNode(me.name, null);
    file.addEventListener('change', function () {
      var chosen = file.files && file.files[0];
      if (!chosen) return;
      cropSquare(chosen).then(function (blob) {
        pendingPhoto = URL.createObjectURL(blob);
        pendingPhotoBlob = blob;
        var img = el('img', { class: 'profile-photo', alt: '' });
        img.src = pendingPhoto;
        var current = host.querySelector('.profile-photo');
        if (current) current.replaceWith(img);
      }).catch(function () {});
    });
    var save = el('button', { class: 'primary', type: 'button', id: 'profile-save', text: 'Save profile' });
    var cancel = el('button', { class: 'secondary', type: 'button', text: 'Cancel' });
    save.addEventListener('click', saveEdit);
    cancel.addEventListener('click', function () { editing = false; pendingPhoto = null; paint(); });
    var credEditors = CATALOG.map(function (type) {
      var current = null;
      me.credentials.forEach(function (row) { if (row.code === type.code) current = row; });
      var box = el('input', { type: 'checkbox', 'data-cred': type.code });
      box.checked = !!current && current.status !== 'rejected';
      var proof = el('input', { type: 'file', accept: 'image/*,.pdf', 'aria-label': 'Proof for ' + type.label, 'data-proof': type.code });
      proof.addEventListener('change', function () {
        if (proof.files && proof.files[0]) proofFiles[type.code] = proof.files[0];
      });
      return el('div', { class: 'cred-edit' },
        el('label', { class: 'check-row' }, box, el('span', { text: type.label })),
        el('p', { class: 'muted small', text: current && current.status === 'pending' ? 'Pending review' : 'Self-declared until a reviewer checks a certificate.' }),
        proof
      );
    });
    host.replaceChildren(el('article', { class: 'card profile-head-card' },
      preview,
      el('h2', { class: 'profile-name', text: 'Edit profile' }),
      el('label', { class: 'field-label', for: 'profile-first', text: 'First name' }),
      nameFirst,
      el('label', { class: 'field-label', for: 'profile-last', text: 'Last name' }),
      nameLast,
      el('p', { id: 'profile-edit-status', class: 'muted small', text: 'Both names are required. Other people see the name, not your email.' }),
      el('label', { class: 'field-label', for: 'profile-bio', text: 'Short bio' }),
      bio,
      el('label', { class: 'field-label', for: 'profile-home', text: 'Home base' }),
      home,
      el('p', { class: 'muted small', text: 'A place name only, such as Chamonix. Exact location is never stored.' }),
      el('label', { class: 'field-label', text: 'Photo' }),
      file,
      el('p', { class: 'muted small', text: 'The center of the photo is kept as a square.' }),
      el('label', { class: 'check-row' }, priv, el('span', { text: 'Private profile' })),
      el('h3', { text: 'Credentials' }),
      credEditors,
      el('div', { class: 'profile-actions' }, save, cancel)
    ));
    loadAvatarInto(preview);
  }

  var pendingPhotoBlob = null;

  function cropSquare(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var side = Math.min(img.width, img.height);
        var canvas = document.createElement('canvas');
        var size = Math.min(512, side);
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('photo')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('photo')); };
      img.src = url;
    });
  }

  function saveEdit() {
    var repo = store();
    var first = document.getElementById('profile-first').value.trim().slice(0, 40);
    var last = document.getElementById('profile-last').value.trim().slice(0, 40);
    var editStatus = document.getElementById('profile-edit-status');
    if (!first || !last) {
      if (editStatus) editStatus.textContent = 'Enter both your first name and your last name.';
      return;
    }
    var name = (first + ' ' + last).slice(0, 80);
    var bio = document.getElementById('profile-bio').value.trim().slice(0, 280);
    var home = document.getElementById('profile-home').value.trim().slice(0, 80);
    var isPrivate = document.getElementById('profile-private').checked;
    if (name && repo.setDisplayName) repo.setDisplayName(name);
    if (repo.saveProfile) repo.saveProfile({ bio: bio, homeBase: home, isPrivate: isPrivate });
    var next = [];
    CATALOG.forEach(function (type) {
      var box = document.querySelector('[data-cred="' + type.code + '"]');
      if (!box || !box.checked) return;
      var status = proofFiles[type.code] ? 'pending' : 'self_declared';
      var assigned = assignCredential(next, type.code, status);
      if (assigned.ok) next = assigned.items;
    });
    if (repo.saveCredentials) repo.saveCredentials(next);
    var photoDone = pendingPhotoBlob && root.SummitPhotos && root.SummitPhotos.setAvatar
      ? root.SummitPhotos.setAvatar(pendingPhotoBlob) : Promise.resolve();
    var namesSaved = signedIn() && account().saveNames ? account().saveNames(first, last) : Promise.resolve({ ok: true });
    photoDone.then(function () { return namesSaved; }).then(function () { return pushRemote(first, last, bio, home, isPrivate, next); }).then(function () {
      editing = false;
      pendingPhotoBlob = null;
      proofFiles = {};
      if (signedIn() && root.SummitChat && SummitChat.forgetAvatar) SummitChat.forgetAvatar(account().user().id);
      paint();
      paintAvatarButtons(name || 'You');
    }).catch(function () {
      editing = false;
      paint();
    });
  }

  function pushRemote(first, last, bio, home, isPrivate, creds) {
    if (!signedIn()) return Promise.resolve();
    var db = account().client();
    var id = account().user().id;
    var detail = db.from('profile_details').upsert({
      profile_id: id,
      bio: bio,
      home_base: home,
      is_private: isPrivate,
      updated_at: new Date().toISOString()
    }, { onConflict: 'profile_id' });
    var area = isPrivate ? '' : home;
    var display = (String(first || '').trim() + ' ' + String(last || '').trim()).slice(0, 80);
    var named = db.from('profiles').update({
      first_name: first,
      last_name: last,
      display_name: display || account().user().displayName || '',
      region_label: area,
      updated_at: new Date().toISOString()
    }).eq('id', id).then(function (result) {
      if (!result.error) return result;
      return db.from('profiles').update({
        display_name: display || account().user().displayName || '',
        region_label: area,
        updated_at: new Date().toISOString()
      }).eq('id', id);
    });
    return Promise.all([detail, named]).then(function () {
      return Promise.all(creds.map(function (row) {
        return db.from('profile_credentials').upsert({
          profile_id: id,
          code: row.code,
          status: row.status === 'pending' ? 'pending' : 'self_declared'
        }, { onConflict: 'profile_id,code' }).then(function (result) {
          var file = proofFiles[row.code];
          if (!file || result.error) return null;
          var path = id + '/' + row.code;
          return db.storage.from('credential-proofs').upload(path, file, { upsert: true }).then(function (upload) {
            if (upload.error) return null;
            return db.from('profile_credentials').select('id').eq('profile_id', id).eq('code', row.code).maybeSingle().then(function (found) {
              if (!found.data) return null;
              return db.from('credential_proofs').upsert({
                credential_id: found.data.id,
                owner_id: id,
                path: path
              }, { onConflict: 'credential_id' });
            });
          });
        });
      }));
    }).then(function () {
      if (!pendingPhotoBlob) return null;
      var path = id + '/avatar.jpg';
      return db.storage.from('avatars').upload(path, pendingPhotoBlob, { upsert: true, contentType: 'image/jpeg' }).then(function (upload) {
        if (upload.error) return null;
        return db.from('profile_details').update({ avatar_path: path }).eq('profile_id', id);
      });
    }).catch(function () { return null; });
  }

  function paintOther(host) {
    var person = other || { name: 'Climber', bio: '', homeBase: '', credentials: [], plans: [], together: [] };
    var back = el('button', { class: 'secondary', type: 'button', text: 'Back' });
    back.addEventListener('click', function () { screenMode = 'own'; other = null; paint(); });
    var request = el('button', { class: 'primary', type: 'button', text: 'Request to climb together' });
    var message = el('button', { class: 'secondary', type: 'button', text: 'Message' });
    message.addEventListener('click', function () {
      if (!root.SummitChat || !person.id) { hooks.signIn(); return; }
      root.SummitChat.openWithUser(person.id).then(function (opened) {
        if (opened) return;
        request.click();
      });
    });
    request.addEventListener('click', function () {
      if (!signedIn()) { hooks.signIn(); return; }
      var plan = person.planRows && person.planRows[0];
      if (!plan) {
        request.textContent = 'They have no shared objective yet';
        request.disabled = true;
        return;
      }
      account().client().from('partner_requests').insert({
        to_user: person.id,
        plan_id: plan.id,
        objective_name: plan.name,
        route_name: plan.route_name || '',
        dates: plan.fixed_date || plan.timeframe || '',
        stage: plan.stage || ''
      }).then(function (result) {
        request.textContent = result.error ? 'Could not send' : 'Request sent';
        request.disabled = true;
      });
    });
    var chips = publicCredentials(person.credentials).map(function (row) {
      var type = byCode(row.code);
      return chipButton({ code: row.code, status: row.status, label: type ? type.label : row.code, detail: type ? type.detail : '', reviewedAt: row.reviewedAt });
    });
    host.replaceChildren(
      back,
      el('article', { class: 'card profile-head-card' },
        photoNode(person.name, person.avatarUrl || ''),
        el('h2', { class: 'profile-name', text: person.name }),
        person.privateProfile ? el('p', { class: 'lock-mark', text: 'Private profile' }) : null,
        !person.privateProfile && person.bio ? el('p', { text: person.bio }) : null,
        !person.privateProfile && person.homeBase ? el('p', { class: 'profile-home', text: person.homeBase }) : null,
        el('div', { class: 'profile-actions' }, request, message)
      ),
      el('section', { class: 'card' },
        el('h3', { text: 'Credentials' }),
        el('div', { class: 'chip-row' }, chips.length ? chips : el('p', { class: 'muted', text: 'No shared credentials.' }))
      ),
      el('section', { class: 'card' },
        el('h3', { text: 'Climbed together' }),
        person.together && person.together.length
          ? person.together.map(function (trip) { return el('p', { text: trip }); })
          : el('p', { class: 'muted', text: 'No shared trips in your log.' })
      ),
      el('section', { class: 'card' },
        el('h3', { text: 'Upcoming' }),
        person.plans && person.plans.length
          ? person.plans.map(function (plan) { return el('p', { text: plan }); })
          : el('p', { class: 'muted', text: 'No shared objectives.' })
      )
    );
  }

  function openOwn() {
    screenMode = 'own';
    editing = false;
    previewing = false;
    other = null;
    paint();
    if (signedIn()) pullOwn();
  }

  function pullOwn() {
    var db = account().client();
    var id = account().user().id;
    db.from('profile_details').select('bio, home_base, is_private').eq('profile_id', id).maybeSingle().then(function (result) {
      if (result.error || !result.data || !store()) return;
      store().saveProfile({
        bio: result.data.bio || '',
        homeBase: result.data.home_base || '',
        isPrivate: result.data.is_private === true
      });
      if (screenMode === 'own' && !editing) paint();
    }).catch(function () {});
    db.from('profile_credentials').select('code, status, reviewed_at').eq('profile_id', id).then(function (result) {
      if (result.error || !result.data || !store()) return;
      serverVerified = result.data.filter(function (row) { return row.status === 'verified'; }).map(function (row) {
        return { code: row.code, status: 'verified', reviewedAt: row.reviewed_at };
      });
      store().saveCredentials(result.data.filter(function (row) { return row.status !== 'verified'; }).map(function (row) {
        return { code: row.code, status: row.status, declaredAt: '' };
      }));
      if (screenMode === 'own' && !editing) paint();
    }).catch(function () {});
  }

  function openOther(person) {
    screenMode = 'other';
    editing = false;
    other = {
      id: person.userId,
      name: person.name || 'Climber',
      bio: '',
      homeBase: person.level && person.level.indexOf('Near ') === 0 ? person.level.slice(5) : '',
      credentials: [],
      plans: [],
      together: togetherWith(person.name),
      privateProfile: false
    };
    paint();
    if (!signedIn() || !person.userId) return;
    var db = account().client();
    db.from('profiles').select('display_name, first_name, last_name').eq('id', person.userId).maybeSingle().then(function (result) {
      if (!other || other.id !== person.userId || !result.data) return;
      var row = result.data;
      var full = (row.first_name && row.last_name) ? (row.first_name + ' ' + row.last_name) : (row.display_name || '');
      if (full) other.name = full;
      paint();
    }).catch(function () {});
    db.from('profile_details').select('bio, home_base, is_private').eq('profile_id', person.userId).maybeSingle().then(function (result) {
      if (!other || other.id !== person.userId) return;
      if (result.data) {
        other.bio = result.data.bio || '';
        other.homeBase = result.data.home_base || other.homeBase;
        other.privateProfile = result.data.is_private === true;
        if (other.privateProfile) {
          other.bio = '';
          other.homeBase = '';
        }
      }
      paint();
    }).catch(function () {});
    db.from('profile_credentials').select('code, status, reviewed_at').eq('profile_id', person.userId).then(function (result) {
      if (!other || result.error) return;
      other.credentials = (result.data || []).filter(function (row) {
        return row.status === 'self_declared' || row.status === 'verified';
      });
      paint();
    }).catch(function () {});
    db.from('plan_shares').select('id, name, route_name, timeframe, fixed_date, stage, visibility').eq('owner_id', person.userId).eq('status', 'planned').then(function (result) {
      if (!other || result.error) return;
      other.planRows = (result.data || []).filter(function (row) {
        return row.visibility === 'community' || row.visibility === 'people';
      });
      other.plans = other.planRows.map(function (row) {
        return [row.name, row.route_name, row.fixed_date || row.timeframe, row.stage].filter(Boolean).join(' · ');
      });
      paint();
    }).catch(function () {});
  }

  function togetherWith(name) {
    var key = fold(name);
    if (!key) return [];
    return doneItems().filter(function (item) {
      return fold(item.partnersWith).indexOf(key) >= 0;
    }).map(function (item) { return item.name + (item.date ? ' · ' + item.date : ''); });
  }

  function bind(next) { hooks = Object.assign(hooks, next || {}); }

  function openFromAvatar() {
    if (root.selectTab) root.selectTab('profile');
    else openOwn();
  }

  return {
    CATALOG: CATALOG,
    counts: counts,
    publicCredentials: publicCredentials,
    assignCredential: assignCredential,
    factChips: factChips,
    bind: bind,
    openOwn: openOwn,
    openOther: openOther,
    openFromAvatar: openFromAvatar
  };
});
