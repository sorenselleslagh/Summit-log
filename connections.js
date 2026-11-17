// Mutual partners. A missing table leaves the section quiet instead of breaking the tab.
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SummitConnections = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var rows = [];
  var unavailable = false;
  var removeTarget = null;
  var requestsOpen = false;
  var searchTimer = null;

  function account() { return root.SummitAccount || null; }
  function ready() {
    var api = account();
    return !!(api && api.configured() && api.user() && api.client());
  }
  function db() {
    var api = account();
    return api && api.client();
  }
  function uid() {
    var person = account() && account().user && account().user();
    return person && person.id || '';
  }
  function byId(id) { return root.document && root.document.getElementById(id); }
  function el(tag, attrs) {
    var node = root.document.createElement(tag);
    var children = Array.prototype.slice.call(arguments, 2);
    if (attrs) Object.keys(attrs).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else if (key === 'class') node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    children.forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }
  function mockMode() {
    try {
      return /(?:\?|&)partners=mock(?:&|$)/.test(root.location && root.location.search || '');
    } catch (err) { return false; }
  }
  function missing(error) {
    if (!error) return false;
    var text = [error.message, error.code, error.details, error.hint].join(' ');
    return /partner_connections|search_profiles|open_partner_chat|42P01|PGRST20|schema cache/i.test(text);
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
  function avatarUrl(id, path) {
    if (!path) return '';
    if (String(path).indexOf('http') === 0) return path;
    var client = db();
    if (!client || !client.storage || !id) return '';
    var got = client.storage.from('avatars').getPublicUrl(path);
    return (got && got.data && got.data.publicUrl) || '';
  }
  function fullName(row) {
    if (!row) return '';
    var first = String(row.first_name || '').trim();
    var last = String(row.last_name || '').trim();
    if (first && last) return (first + ' ' + last).slice(0, 80);
    return String(row.full_name || row.display_name || row.name || '').trim();
  }

  var MOCK = {
    accepted: [
      { id: 'c-ada', otherId: '11111111-1111-4111-8111-111111111111', name: 'Ada Lovelace', avatarUrl: 'icons/icon-192.png', credential: 'IFMGA guide' },
      { id: 'c-blair', otherId: '22222222-2222-4222-8222-222222222222', name: 'Blair Tremblay', avatarUrl: '', credential: 'First aid' }
    ],
    incoming: [
      { id: 'c-camille', otherId: '33333333-3333-4333-8333-333333333333', name: 'Camille Rossi', avatarUrl: '' }
    ],
    outgoing: [
      { id: 'c-diego', otherId: '44444444-4444-4444-8444-444444444444', name: 'Diego Silva', avatarUrl: '' }
    ],
    directory: [
      { id: '44444444-4444-4444-8444-444444444444', name: 'Diego Silva', avatarUrl: '' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'Elena Berg', avatarUrl: '' },
      { id: '11111111-1111-4111-8111-111111111111', name: 'Ada Lovelace', avatarUrl: '' }
    ]
  };

  function stateFor(userId) {
    var found = 'none';
    rows.forEach(function (row) {
      if (row.otherId !== userId) return;
      if (row.status === 'accepted') found = 'accepted';
      else if (row.direction === 'out' && row.status === 'pending') found = 'requested';
      else if (row.direction === 'in' && row.status === 'pending') found = 'incoming';
    });
    return found;
  }

  function face(name, url, extraClass) {
    var node = el('span', { class: 'story-face' + (extraClass ? ' ' + extraClass : ''), 'aria-hidden': 'true' });
    if (!url) {
      node.textContent = initials(name);
      return node;
    }
    var img = el('img', { alt: '', src: url, width: '64', height: '64' });
    img.addEventListener('error', function () { node.textContent = initials(name); img.remove(); });
    node.appendChild(img);
    return node;
  }

  function note(text) {
    var node = byId('my-partners-note');
    if (node) node.textContent = text || '';
  }

  function paint() {
    var host = byId('partner-row');
    var requestRow = byId('partner-requests-row');
    var requestList = byId('partner-requests-list');
    if (!host) return;
    var incoming = rows.filter(function (row) { return row.direction === 'in' && row.status === 'pending'; });
    var accepted = rows.filter(function (row) { return row.status === 'accepted'; });
    if (requestRow) {
      if (!incoming.length) {
        requestRow.classList.add('hidden');
        requestRow.textContent = '';
        requestsOpen = false;
      } else {
        requestRow.classList.remove('hidden');
        requestRow.textContent = 'Partner requests (' + incoming.length + ')';
      }
    }
    if (requestList) {
      if (!requestsOpen || !incoming.length) {
        requestList.classList.add('hidden');
        requestList.replaceChildren();
      } else {
        requestList.classList.remove('hidden');
        requestList.replaceChildren.apply(requestList, incoming.map(requestCard));
      }
    }
    var add = el('button', { class: 'partner-story', type: 'button', id: 'add-partner', 'aria-label': 'Add partner' },
      el('span', { class: 'story-face story-add', 'aria-hidden': 'true', text: '+' }),
      el('span', { class: 'story-name', text: 'Add' })
    );
    add.addEventListener('click', openAdd);
    var stories = accepted.map(storyButton);
    host.replaceChildren.apply(host, [add].concat(stories));
    if (unavailable) note('Partner connections are not on this account yet. The rest of Partners still works.');
    else if (!ready() && !mockMode()) note('Sign in to add partners and message them.');
    else if (!accepted.length && !incoming.length) note('People you partner with show up here.');
    else note('');
  }

  function storyButton(row) {
    var button = el('button', { class: 'partner-story', type: 'button', 'data-partner': row.otherId },
      face(row.name, row.avatarUrl),
      el('span', { class: 'story-name', text: row.name })
    );
    button.addEventListener('click', function () { openProfile(row); });
    var timer = null;
    var startX = 0;
    button.addEventListener('pointerdown', function (event) {
      startX = event.clientX;
      timer = root.setTimeout(function () { askRemove(row); }, 600);
    });
    function clear() { if (timer) root.clearTimeout(timer); timer = null; }
    button.addEventListener('pointerup', clear);
    button.addEventListener('pointercancel', clear);
    button.addEventListener('pointermove', function (event) {
      if (Math.abs(event.clientX - startX) > 10) clear();
    });
    return button;
  }

  function requestCard(row) {
    var confirm = el('button', { class: 'primary', type: 'button', text: 'Confirm' });
    var remove = el('button', { class: 'secondary', type: 'button', text: 'Delete' });
    confirm.addEventListener('click', function () { decide(row, 'accepted'); });
    remove.addEventListener('click', function () { decide(row, 'declined'); });
    return el('div', { class: 'request-card ig-request' },
      face(row.name, row.avatarUrl),
      el('div', { class: 'ig-request-copy' },
        el('p', { class: 'thread-title', text: row.name }),
        el('p', { class: 'muted small', text: 'Wants to be partners' })
      ),
      el('div', { class: 'partner-actions' }, confirm, remove)
    );
  }

  function openProfile(row) {
    if (!root.SummitProfile || !root.selectTab) return;
    root.selectTab('profile');
    root.SummitProfile.openOther({
      userId: row.otherId,
      name: row.name,
      avatarUrl: row.avatarUrl || ''
    });
  }

  function askRemove(row) {
    removeTarget = row;
    var sheet = byId('remove-partner-sheet');
    var name = byId('remove-partner-name');
    if (name) name.textContent = 'Remove ' + row.name + '?';
    if (sheet) sheet.classList.remove('hidden');
  }

  function closeRemove() {
    removeTarget = null;
    var sheet = byId('remove-partner-sheet');
    if (sheet) sheet.classList.add('hidden');
  }

  function openAdd() {
    var sheet = byId('add-partner-sheet');
    var input = byId('add-partner-query');
    var list = byId('add-partner-results');
    if (sheet) sheet.classList.remove('hidden');
    if (list) list.replaceChildren();
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  function closeAdd() {
    var sheet = byId('add-partner-sheet');
    if (sheet) sheet.classList.add('hidden');
  }

  function resultRow(person) {
    var state = stateFor(person.id);
    var label = state === 'accepted' ? 'Partners' : state === 'requested' ? 'Requested' : state === 'incoming' ? 'Confirm' : 'Add';
    var button = el('button', { class: state === 'accepted' || state === 'requested' ? 'secondary' : 'primary', type: 'button', text: label });
    if (state === 'accepted' || state === 'requested') button.disabled = true;
    button.addEventListener('click', function () {
      if (state === 'incoming') {
        var incoming = null;
        rows.forEach(function (row) { if (row.otherId === person.id && row.direction === 'in') incoming = row; });
        if (incoming) decide(incoming, 'accepted');
        return;
      }
      sendRequest(person).then(function () {
        button.textContent = 'Requested';
        button.disabled = true;
        button.className = 'secondary';
      });
    });
    return el('div', { class: 'ig-result' },
      face(person.name, person.avatarUrl),
      el('p', { class: 'thread-title', text: person.name }),
      button
    );
  }

  function search(query) {
    var list = byId('add-partner-results');
    if (!list) return;
    var text = String(query || '').trim();
    if (text.length < 2) {
      list.replaceChildren(el('p', { class: 'muted small', text: 'Type at least two letters.' }));
      return;
    }
    if (mockMode()) {
      var folded = text.toLowerCase();
      list.replaceChildren.apply(list, MOCK.directory.filter(function (person) {
        return person.name.toLowerCase().indexOf(folded) >= 0;
      }).map(resultRow));
      if (!list.children.length) list.replaceChildren(el('p', { class: 'muted small', text: 'No one with that name.' }));
      return;
    }
    if (!ready()) {
      list.replaceChildren(el('p', { class: 'muted small', text: 'Sign in to find people.' }));
      return;
    }
    db().rpc('search_profiles', { query: text }).then(function (result) {
      if (result.error) {
        if (missing(result.error)) {
          unavailable = true;
          list.replaceChildren(el('p', { class: 'muted small', text: 'Name search is not on this account yet.' }));
          paint();
          return;
        }
        list.replaceChildren(el('p', { class: 'muted small', text: result.error.message || 'Search did not finish.' }));
        return;
      }
      var people = (result.data || []).map(function (row) {
        return { id: row.id, name: row.full_name || 'Climber', avatarUrl: avatarUrl(row.id, row.avatar_path) };
      });
      if (!people.length) {
        list.replaceChildren(el('p', { class: 'muted small', text: 'No one with that name.' }));
        return;
      }
      list.replaceChildren.apply(list, people.map(resultRow));
    }).catch(function () {
      list.replaceChildren(el('p', { class: 'muted small', text: 'Search did not finish.' }));
    });
  }

  function sendRequest(person) {
    if (!person || !person.id) return Promise.resolve(false);
    if (mockMode()) {
      if (stateFor(person.id) === 'none') {
        rows.push({ id: 'c-' + person.id, otherId: person.id, name: person.name, avatarUrl: person.avatarUrl || '', status: 'pending', direction: 'out' });
      }
      paint();
      return Promise.resolve(true);
    }
    if (!ready()) return Promise.resolve(false);
    return db().from('partner_connections').insert({
      requester_id: uid(),
      addressee_id: person.id,
      status: 'pending'
    }).then(function (result) {
      if (result.error) {
        if (missing(result.error)) unavailable = true;
        return false;
      }
      return load().then(function () { return true; });
    }).catch(function () { return false; });
  }

  function decide(row, status) {
    if (mockMode()) {
      rows = rows.filter(function (item) { return item.id !== row.id; });
      if (status === 'accepted') {
        rows.push({ id: row.id, otherId: row.otherId, name: row.name, avatarUrl: row.avatarUrl, status: 'accepted', direction: 'in' });
      }
      paint();
      return Promise.resolve(true);
    }
    if (!ready()) return Promise.resolve(false);
    return db().from('partner_connections').update({ status: status }).eq('id', row.id).then(function (result) {
      if (result.error && missing(result.error)) unavailable = true;
      return load();
    }).catch(function () { return false; });
  }

  function remove(userId) {
    var match = null;
    rows.forEach(function (row) { if (row.otherId === userId && row.status === 'accepted') match = row; });
    if (!match) return Promise.resolve(false);
    if (mockMode()) {
      rows = rows.filter(function (row) { return row.id !== match.id; });
      paint();
      return Promise.resolve(true);
    }
    return db().from('partner_connections').delete().eq('id', match.id).then(function () { return load(); }).catch(function () { return false; });
  }

  function load() {
    if (mockMode()) {
      rows = MOCK.accepted.map(function (row) {
        return { id: row.id, otherId: row.otherId, name: row.name, avatarUrl: row.avatarUrl, status: 'accepted', direction: 'in', credential: row.credential };
      }).concat(MOCK.incoming.map(function (row) {
        return { id: row.id, otherId: row.otherId, name: row.name, avatarUrl: '', status: 'pending', direction: 'in' };
      })).concat(MOCK.outgoing.map(function (row) {
        return { id: row.id, otherId: row.otherId, name: row.name, avatarUrl: '', status: 'pending', direction: 'out' };
      }));
      unavailable = false;
      paint();
      return Promise.resolve(rows);
    }
    if (!ready()) {
      rows = [];
      unavailable = false;
      paint();
      return Promise.resolve([]);
    }
    return db().from('partner_connections').select('id, requester_id, addressee_id, status, created_at').then(function (result) {
      if (result.error) {
        unavailable = missing(result.error);
        rows = [];
        paint();
        return [];
      }
      unavailable = false;
      var mine = uid();
      var next = (result.data || []).map(function (row) {
        var incoming = row.addressee_id === mine;
        return {
          id: row.id,
          otherId: incoming ? row.requester_id : row.addressee_id,
          name: '',
          avatarUrl: '',
          status: row.status,
          direction: incoming ? 'in' : 'out'
        };
      });
      var ids = next.map(function (row) { return row.otherId; });
      if (!ids.length) {
        rows = next;
        paint();
        return rows;
      }
      return db().from('profiles').select('id, display_name, first_name, last_name, avatar_path').in('id', ids).then(function (people) {
        if (people && people.error) {
          return db().from('profiles').select('id, display_name, first_name, last_name').in('id', ids);
        }
        return people;
      }).then(function (people) {
        var names = {};
        var photos = {};
        ((people && people.data) || []).forEach(function (row) {
          names[row.id] = fullName(row) || 'Climber';
          photos[row.id] = row.avatar_path || '';
        });
        next.forEach(function (row) {
          row.name = names[row.otherId] || 'Climber';
          row.avatarUrl = avatarUrl(row.otherId, photos[row.otherId]);
        });
        rows = next;
        paint();
        return rows;
      });
    }).catch(function () {
      rows = [];
      paint();
      return [];
    });
  }

  function buttonFor(userId, name) {
    var state = stateFor(userId);
    var label = state === 'accepted' ? 'Partners' : state === 'requested' ? 'Requested' : 'Add partner';
    var button = el('button', { class: state === 'none' ? 'primary' : 'secondary', type: 'button', text: label });
    if (state === 'accepted' || state === 'requested') button.disabled = true;
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (state !== 'none') return;
      sendRequest({ id: userId, name: name || 'Climber' });
    });
    return button;
  }

  function bind() {
    var requests = byId('partner-requests-row');
    if (requests && !requests.dataset.bound) {
      requests.dataset.bound = '1';
      requests.addEventListener('click', function () {
        requestsOpen = !requestsOpen;
        paint();
      });
    }
    var close = byId('add-partner-close');
    if (close) close.addEventListener('click', closeAdd);
    var input = byId('add-partner-query');
    if (input) input.addEventListener('input', function () {
      if (searchTimer) root.clearTimeout(searchTimer);
      var value = input.value;
      searchTimer = root.setTimeout(function () { search(value); }, 200);
    });
    var cancel = byId('remove-partner-cancel');
    var confirm = byId('remove-partner-confirm');
    if (cancel) cancel.addEventListener('click', closeRemove);
    if (confirm) confirm.addEventListener('click', function () {
      var target = removeTarget;
      closeRemove();
      if (target) remove(target.otherId);
    });
  }

  function previewInbox() {
    if (!mockMode()) return null;
    return [
      { id: 'thread-ada', personId: '11111111-1111-4111-8111-111111111111', name: 'Ada Lovelace', preview: 'Saturday still works for me.', updatedAt: new Date().toISOString(), unread: 1 },
      { id: 'thread-blair', personId: '22222222-2222-4222-8222-222222222222', name: 'Blair Tremblay', preview: 'I can bring the rope.', updatedAt: new Date(Date.now() - 86400000).toISOString(), unread: 0 }
    ];
  }

  bind();
  if (mockMode()) load();

  return {
    refresh: load,
    openAdd: openAdd,
    stateFor: stateFor,
    request: sendRequest,
    remove: remove,
    buttonFor: buttonFor,
    previewInbox: previewInbox,
    mockMode: mockMode
  };
});
