// Partner chat. A conversation exists only after a request is accepted.
// With no account server this module leaves the "not connected" copy in place.
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SummitChat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var queueCache = {};
  var requestCache = { incoming: [], outgoing: [] };
  var threads = [];
  var active = null;
  var started = false;
  var pollTimer = null;
  var primed = false;
  var threadState = {};
  var pushOffered = false;
  var hooks = {
    onUnread: function () {},
    getPlanByName: function () { return null; },
    selectPartners: function () {},
    signIn: function () {},
    openRequest: function () {}
  };

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
    var api = account();
    var person = api && api.user();
    return person ? person.id : '';
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

  function byId(id) { return document.getElementById(id); }

  function localStamp(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function mintId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    if (root.SummitLogLogic && root.SummitLogLogic.mintId) return root.SummitLogLogic.mintId();
    return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
  }

  function outbox() {
    var store = root.SummitLogStorage;
    if (!store || !store.loadOutbox) return [];
    return store.loadOutbox();
  }

  function saveOutbox(items) {
    var store = root.SummitLogStorage;
    if (store && store.saveOutbox) store.saveOutbox(items);
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function setStatus(text) {
    var node = byId('messages-status');
    if (node && text) node.textContent = text;
  }

  function setBadge(count) {
    ['nav-unread', 'chat-unread', 'map-chat-unread'].forEach(function (id) {
      var badge = byId(id);
      if (!badge) return;
      if (!count) {
        badge.textContent = '';
        badge.classList.add('hidden');
      } else {
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.classList.remove('hidden');
      }
    });
    try { hooks.onUnread(count); } catch (err) { /* badge is enough */ }
  }

  function peopleFor(objective) {
    if (!objective || !ready()) return [];
    var key = root.SummitPartners ? root.SummitPartners.fold(objective.name) : String(objective.name || '').toLowerCase();
    var hit = queueCache[key];
    return hit && hit.people ? hit.people.slice() : [];
  }

  function personById(id) {
    var found = null;
    Object.keys(queueCache).forEach(function (key) {
      (queueCache[key].people || []).forEach(function (person) {
        if (person.id === id) found = person;
      });
    });
    return found;
  }

  function prefetchQueue(objective, done) {
    if (!objective || !ready()) return;
    var key = root.SummitPartners.fold(objective.name);
    var cached = queueCache[key];
    if (cached && Date.now() - cached.at < 12000) return;
    queueCache[key] = { at: Date.now(), people: cached ? cached.people : [] };
    db().from('plan_shares').select('id, owner_id, name, route_name, route_grade, stage, timeframe, fixed_date, share_note, looking_for_partner, elevation')
      .eq('visibility', 'community')
      .eq('name_key', key)
      .then(function (result) {
        if (result.error) return;
        var ids = [];
        (result.data || []).forEach(function (row) {
          if (row.owner_id && row.owner_id !== uid() && ids.indexOf(row.owner_id) < 0) ids.push(row.owner_id);
        });
        var profiles = ids.length
          ? db().from('profiles').select('id, display_name, region_label').in('id', ids)
          : Promise.resolve({ data: [] });
        return profiles.then(function (people) {
          var names = {};
          (people.data || []).forEach(function (profile) { names[profile.id] = profile; });
          var list = [];
          (result.data || []).forEach(function (row) {
            if (!row.owner_id || row.owner_id === uid()) return;
            var profile = names[row.owner_id] || {};
            var when = row.fixed_date || row.timeframe || '';
            list.push({
              id: 'user:' + row.owner_id,
              userId: row.owner_id,
              account: true,
              demo: false,
              planId: row.id,
              name: profile.display_name || 'Climber',
              initials: initials(profile.display_name || 'Climber'),
              level: profile.region_label ? 'Near ' + profile.region_label : '',
              dates: when,
              note: row.share_note || '',
              logs: [],
              routeName: row.route_name || '',
              routeGrade: row.route_grade || '',
              stage: row.stage || '',
              objectiveName: row.name
            });
          });
          var previous = JSON.stringify(queueCache[key].people || []);
          queueCache[key] = { at: Date.now(), people: list };
          if (previous !== JSON.stringify(list) && typeof done === 'function') done();
        });
      }).catch(function () {});
  }

  function requestState(userId, objectiveName) {
    var name = root.SummitPartners ? root.SummitPartners.fold(objectiveName) : '';
    var hit = null;
    requestCache.outgoing.forEach(function (row) {
      if (row.to_user === userId && root.SummitPartners.fold(row.objective_name) === name) hit = row;
    });
    return hit;
  }

  function actionsForPerson(person) {
    if (!person || !person.account || !person.userId || !ready()) return null;
    var objective = root.activeObjective || null;
    var name = person.objectiveName || (objective && objective.name) || '';
    var existing = requestState(person.userId, name);
    if (existing && existing.status === 'accepted' && existing.conversation_id) {
      var open = el('button', { class: 'secondary', type: 'button', 'data-message': person.userId, text: 'Message' });
      open.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openConversation(existing.conversation_id);
      });
      return el('div', { class: 'partner-actions' }, open);
    }
    if (existing && existing.status === 'pending') {
      return el('div', { class: 'partner-actions' }, el('p', { class: 'muted small', text: 'Request sent. A chat opens if they accept.' }));
    }
    var button = el('button', { class: 'secondary', type: 'button', 'data-ask': person.userId, text: 'Message' });
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      sendRequest(person, name).then(function (result) {
        button.disabled = true;
        button.textContent = result && result.ok ? 'Request sent' : 'Could not send';
      });
    });
    return el('div', { class: 'partner-actions' }, button);
  }

  function sendRequest(person, objectiveName) {
    if (!ready()) return Promise.resolve({ ok: false });
    var row = {
      to_user: person.userId,
      plan_id: person.planId || null,
      objective_name: objectiveName || person.objectiveName || '',
      route_name: person.routeName || '',
      dates: person.dates || '',
      stage: person.stage || '',
      note: ''
    };
    return db().from('partner_requests').insert(row).select('id, status, to_user, objective_name').then(function (result) {
      if (result.error) return { ok: false };
      requestCache.outgoing.push(result.data[0]);
      return { ok: true };
    }, function () { return { ok: false }; });
  }

  function loadRequests() {
    if (!ready()) return Promise.resolve();
    return Promise.all([
      db().from('partner_requests').select('id, from_user, to_user, plan_id, objective_name, route_name, dates, stage, note, status').eq('to_user', uid()).eq('status', 'pending'),
      db().from('partner_requests').select('id, from_user, to_user, plan_id, objective_name, route_name, dates, stage, status').eq('from_user', uid()).in('status', ['pending', 'accepted'])
    ]).then(function (parts) {
      requestCache.incoming = (parts[0].data || []);
      requestCache.outgoing = (parts[1].data || []);
      return attachConversations(requestCache.outgoing);
    });
  }

  function attachConversations(rows) {
    var accepted = rows.filter(function (row) { return row.status === 'accepted'; }).map(function (row) { return row.id; });
    if (!accepted.length) return;
    return db().from('conversations').select('id, request_id').in('request_id', accepted).then(function (result) {
      var byRequest = {};
      (result.data || []).forEach(function (row) { byRequest[row.request_id] = row.id; });
      rows.forEach(function (row) {
        if (byRequest[row.id]) row.conversation_id = byRequest[row.id];
      });
    });
  }

  function loadThreads() {
    if (!ready()) return Promise.resolve([]);
    return db().from('conversation_members').select('conversation_id, last_read_at, muted_until, conversations(id, type, plan_id, objective_name, route_name, dates, stage, updated_at)')
      .eq('user_id', uid())
      .is('left_at', null)
      .then(function (result) {
        if (result.error) return [];
        var members = result.data || [];
        var ids = members.map(function (row) { return row.conversation_id; });
        if (!ids.length) {
          threads = [];
          return threads;
        }
        return db().from('messages').select('id, conversation_id, sender_id, body, kind, created_at')
          .in('conversation_id', ids)
          .order('created_at', { ascending: false })
          .limit(200)
          .then(function (messages) {
            threads = members.map(function (member) {
              var conversation = member.conversations || {};
              var related = (messages.data || []).filter(function (message) {
                return message.conversation_id === member.conversation_id;
              });
              var latest = related[0] || null;
              var unread = 0;
              var muted = member.muted_until && Date.parse(member.muted_until) > Date.now();
              if (!muted) {
                related.forEach(function (message) {
                  if (message.sender_id === uid()) return;
                  if (!member.last_read_at || Date.parse(message.created_at) > Date.parse(member.last_read_at)) unread += 1;
                });
              }
              return {
                id: member.conversation_id,
                type: conversation.type || 'direct',
                planId: conversation.plan_id || null,
                objective: conversation.objective_name || '',
                route: conversation.route_name || '',
                dates: conversation.dates || '',
                stage: conversation.stage || '',
                muted: !!muted,
                unread: unread,
                preview: latest ? latest.body : 'No messages yet',
                senderId: latest ? latest.sender_id : '',
                updatedAt: latest ? latest.created_at : conversation.updated_at
              };
            });
            threads.sort(function (a, b) { return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0); });
            noticeThreads(threads);
            return threads;
          });
      });
  }

  function renderInbox() {
    var direct = byId('messages-direct');
    var requests = byId('messages-requests');
    var teams = byId('messages-teams');
    if (!direct || !requests) return;
    var api = account();
    if (!api || !api.configured()) {
      setStatus('Messages are not connected yet. Plans and queues stay on this device. Partner chat will appear here once an account server is added.');
      setBadge(0);
      return;
    }
    if (!api.user()) {
      setStatus('Sign in to send partner requests and messages. A chat opens only after a request is accepted.');
      direct.replaceChildren(el('p', { class: 'muted', text: 'No direct messages yet.' }));
      requests.replaceChildren();
      setBadge(0);
      return;
    }
    setStatus('Direct messages with people who accepted a partner request. Nothing here is a ranking.');
    var pendingNodes = requestCache.incoming.map(function (row) {
      var accept = el('button', { class: 'primary', type: 'button', 'data-accept': row.id, text: 'Accept' });
      var decline = el('button', { class: 'secondary', type: 'button', 'data-decline': row.id, text: 'Decline' });
      accept.addEventListener('click', function () { acceptRequest(row.id); });
      decline.addEventListener('click', function () { declineRequest(row.id); });
      return el('div', { class: 'request-card' },
        el('p', { class: 'thread-title', text: row.objective_name || 'Partner request' }),
        el('p', { class: 'muted small', text: [row.route_name, row.dates, row.stage].filter(Boolean).join(' · ') || 'They asked to partner on this objective.' }),
        el('div', { class: 'partner-actions' }, accept, decline)
      );
    });
    requests.replaceChildren.apply(requests, pendingNodes);
    var directThreads = threads.filter(function (thread) { return thread.type !== 'team'; });
    var teamThreads = threads.filter(function (thread) { return thread.type === 'team'; });
    if (!directThreads.length) direct.replaceChildren(el('p', { class: 'muted', text: 'No direct messages yet.' }));
    else direct.replaceChildren.apply(direct, directThreads.map(threadButton));
    if (teams) {
      if (!teamThreads.length) {
        teams.replaceChildren(el('p', { class: 'muted', text: 'Team chats come next. A team will share one plan, with the same messages and safety tools as a direct chat.' }));
      } else {
        var nodes = teamThreads.map(threadButton);
        nodes.push(el('p', { class: 'muted small', text: 'More teams can share a plan later. This list is only teams you have already joined.' }));
        teams.replaceChildren.apply(teams, nodes);
      }
    }
    var unread = requestCache.incoming.length;
    threads.forEach(function (thread) { unread += thread.unread; });
    setBadge(unread);
  }

  function threadButton(thread) {
    var button = el('button', { class: 'thread', type: 'button', 'data-thread': thread.id },
      el('span', { class: 'thread-top' },
        el('span', { class: 'thread-title', text: thread.objective || 'Conversation' }),
        thread.unread ? el('span', { class: 'unread-dot', text: String(thread.unread) }) : null
      ),
      el('span', { class: 'muted small', text: [thread.route, thread.dates, thread.stage].filter(Boolean).join(' · ') }),
      el('span', { class: 'thread-preview', text: thread.preview })
    );
    button.addEventListener('click', function () { openConversation(thread.id); });
    return button;
  }

  function acceptRequest(id) {
    return db().rpc('accept_partner_request', { request_id: id }).then(function (result) {
      if (result.error) {
        setStatus('That request could not be accepted.');
        return;
      }
      return refresh().then(function () { openConversation(result.data); });
    });
  }

  function declineRequest(id) {
    return db().rpc('decline_partner_request', { request_id: id }).then(function () { return refresh(); });
  }

  function showChatShell() {
    if (hooks.selectPartners) hooks.selectPartners();
    var flow = byId('partner-flow');
    var panel = byId('messages-panel');
    var screen = byId('chat-screen');
    var shared = byId('shared-plan-view');
    if (flow) flow.classList.add('hidden');
    if (panel) panel.classList.add('hidden');
    if (shared) shared.classList.add('hidden');
    if (screen) screen.classList.remove('hidden');
  }

  function openConversation(id) {
    if (!id || !ready()) return;
    active = { id: id, messages: [], blocked: false, muted: false };
    showChatShell();
    var screen = byId('chat-screen');
    if (screen) screen.replaceChildren(el('p', { class: 'muted', text: 'Opening the conversation…' }));
    Promise.all([
      db().from('conversations').select('id, type, plan_id, objective_name, route_name, dates, stage').eq('id', id).maybeSingle(),
      db().from('conversation_members').select('user_id, muted_until, left_at').eq('conversation_id', id),
      db().from('messages').select('id, sender_id, kind, body, payload, client_id, created_at').eq('conversation_id', id).order('created_at', { ascending: true }).limit(200),
      db().from('blocks').select('blocked_id').eq('blocker_id', uid())
    ]).then(function (parts) {
      var conversation = parts[0].data;
      if (!conversation || parts[0].error) {
        if (screen) screen.replaceChildren(el('p', { class: 'muted', text: 'This conversation is not available.' }));
        return;
      }
      var members = parts[1].data || [];
      var mine = null;
      var otherId = '';
      members.forEach(function (member) {
        if (member.user_id === uid()) mine = member;
        else otherId = member.user_id;
      });
      var blockedIds = (parts[3].data || []).map(function (row) { return row.blocked_id; });
      active = {
        id: id,
        conversation: conversation,
        otherId: otherId,
        messages: parts[2].data || [],
        blocked: blockedIds.indexOf(otherId) >= 0,
        muted: !!(mine && mine.muted_until && Date.parse(mine.muted_until) > Date.now())
      };
      paintChat();
      markRead();
    }).catch(function () {
      if (screen) screen.replaceChildren(el('p', { class: 'muted', text: 'This conversation could not be opened. Your log is still on this device.' }));
    });
  }

  function headerLine(conversation) {
    return [conversation.route_name, conversation.dates, conversation.stage].filter(Boolean).join(' · ');
  }

  function paintChat() {
    var screen = byId('chat-screen');
    if (!screen || !active || !active.conversation) return;
    var conversation = active.conversation;
    var back = el('button', { class: 'secondary', type: 'button', text: 'Back' });
    back.addEventListener('click', closeChat);
    var plan = el('button', { class: 'secondary', type: 'button', text: 'Shared plan' });
    plan.addEventListener('click', function () { openSharedPlan(conversation); });
    var log = el('div', { class: 'chat-log', id: 'chat-log' });
    active.messages.forEach(function (message) { log.appendChild(messageNode(message)); });
    var input = el('input', { type: 'text', id: 'chat-input', maxlength: '4000', placeholder: 'Message', 'aria-label': 'Message' });
    var send = el('button', { class: 'primary', type: 'button', id: 'chat-send', text: 'Send' });
    var propose = el('button', { class: 'secondary', type: 'button', text: 'Propose a date' });
    var gear = el('button', { class: 'secondary', type: 'button', text: 'Share gear checklist' });
    send.addEventListener('click', function () { submitText(input); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitText(input);
      }
    });
    propose.addEventListener('click', function () {
      var existing = byId('date-proposal');
      if (existing) {
        existing.focus();
        return;
      }
      var field = el('input', {
        type: 'text',
        id: 'date-proposal',
        maxlength: '120',
        placeholder: 'Date or period',
        'aria-label': 'Date or period',
        value: conversation.dates || ''
      });
      var confirm = el('button', { class: 'primary', type: 'button', id: 'date-send', text: 'Send date' });
      confirm.addEventListener('click', function () {
        var label = field.value.trim().slice(0, 120);
        if (!label) return;
        sendMessage({
          kind: 'date_proposal',
          body: 'Date proposal: ' + label,
          payload: { label: label, status: 'pending' }
        });
      });
      composer.appendChild(field);
      composer.appendChild(confirm);
      field.focus();
    });
    gear.addEventListener('click', shareGear);
    var composer = el('div', { class: 'composer' }, input, send, propose, gear);
    if (active.blocked) {
      composer = el('p', { class: 'muted', text: 'You blocked this person. Unblock to send a message.' });
    }
    var safety = safetyRow();
    var previous = byId('chat-input');
    var draft = previous ? previous.value : '';
    var wasFocused = previous && document.activeElement === previous;
    screen.replaceChildren(
      el('div', { class: 'chat-head' },
        back,
        el('h2', { text: conversation.objective_name || 'Conversation' }),
        el('p', { class: 'chat-objective', text: headerLine(conversation) || 'Objective' }),
        plan
      ),
      log,
      composer,
      safety
    );
    var nextInput = byId('chat-input');
    if (nextInput && draft) nextInput.value = draft;
    if (wasFocused && nextInput) nextInput.focus();
    log.scrollTop = log.scrollHeight;
  }

  function messageNode(message) {
    var mine = message.sender_id === uid();
    var failed = message.failed ? el('span', { class: 'bubble-failed', text: 'Not sent yet. It will retry.' }) : null;
    if (message.kind === 'date_proposal') {
      return dateCard(message, mine);
    }
    if (message.kind === 'gear_checklist') {
      var items = (message.payload && message.payload.items) || [];
      var list = el('ul', { class: 'gear-list' });
      if (!items.length) list.appendChild(el('li', { text: 'No preparation steps on this plan yet.' }));
      items.forEach(function (item) { list.appendChild(el('li', { text: item })); });
      return el('article', { class: 'gear-card' },
        el('p', { class: 'field-label', text: 'Gear checklist' }),
        list,
        el('time', { text: localStamp(message.created_at) })
      );
    }
    return el('article', { class: mine ? 'bubble mine' : 'bubble theirs' },
      el('p', { text: message.body || '' }),
      el('time', { text: localStamp(message.created_at) }),
      failed
    );
  }

  function dateCard(message, mine) {
    var payload = message.payload || {};
    var status = payload.status || 'pending';
    var actions = null;
    if (!mine && status === 'pending') {
      var accept = el('button', { class: 'primary', type: 'button', text: 'Accept' });
      var decline = el('button', { class: 'secondary', type: 'button', text: 'Decline' });
      accept.addEventListener('click', function () { respondDate(message, 'accepted'); });
      decline.addEventListener('click', function () { respondDate(message, 'declined'); });
      actions = el('div', { class: 'partner-actions' }, accept, decline);
    }
    return el('article', { class: 'date-card' },
      el('p', { class: 'field-label', text: 'Date proposal' }),
      el('p', { text: payload.label || message.body || '' }),
      el('p', { class: 'muted small', text: status === 'pending' ? 'Waiting for an answer' : (status === 'accepted' ? 'Accepted' : 'Declined') }),
      actions,
      el('time', { text: localStamp(message.created_at) })
    );
  }

  function submitText(input) {
    var text = input.value.trim();
    if (!text || !active) return;
    input.value = '';
    sendMessage({ kind: 'text', body: text, payload: {} });
  }

  function shareGear() {
    var plan = hooks.getPlanByName(active && active.conversation && active.conversation.objective_name);
    var items = [];
    if (plan && Array.isArray(plan.checklist)) {
      plan.checklist.forEach(function (step) {
        if (step && step.text) items.push(String(step.text).slice(0, 200));
      });
    }
    items = items.slice(0, 30);
    var body = items.length ? 'Gear checklist: ' + items.join(', ') : 'No preparation steps on this plan yet.';
    sendMessage({ kind: 'gear_checklist', body: body.slice(0, 4000), payload: { items: items } });
  }

  function sendMessage(draft) {
    if (!active || active.blocked) return;
    var message = {
      id: mintId(),
      conversation_id: active.id,
      sender_id: uid(),
      kind: draft.kind,
      body: draft.body,
      payload: draft.payload || {},
      client_id: mintId(),
      created_at: new Date().toISOString()
    };
    active.messages.push(message);
    paintChat();
    var online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (!online) {
      message.failed = true;
      queueOut(message);
      paintChat();
      return;
    }
    db().from('messages').insert({
      conversation_id: message.conversation_id,
      sender_id: message.sender_id,
      kind: message.kind,
      body: message.body,
      payload: message.payload,
      client_id: message.client_id
    }).select('id, created_at').then(function (result) {
      if (result.error) {
        message.failed = true;
        queueOut(message);
        paintChat();
        return;
      }
      if (result.data && result.data[0]) {
        message.id = result.data[0].id;
        message.created_at = result.data[0].created_at;
        message.failed = false;
        paintChat();
        offerPush();
      }
    }, function () {
      message.failed = true;
      queueOut(message);
      paintChat();
    });
  }

  function queueOut(message) {
    var items = outbox().filter(function (row) { return row.client_id !== message.client_id; });
    items.push({
      conversation_id: message.conversation_id,
      sender_id: message.sender_id,
      kind: message.kind,
      body: message.body,
      payload: message.payload,
      client_id: message.client_id
    });
    saveOutbox(items);
  }

  function flushOutbox() {
    if (!ready() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve();
    var items = outbox();
    if (!items.length) return Promise.resolve();
    return items.reduce(function (chain, message) {
      return chain.then(function () {
        return db().from('messages').upsert({
          conversation_id: message.conversation_id,
          sender_id: uid(),
          kind: message.kind,
          body: message.body,
          payload: message.payload || {},
          client_id: message.client_id
        }, { onConflict: 'conversation_id,client_id' }).then(function (result) {
          if (!result.error) {
            saveOutbox(outbox().filter(function (row) { return row.client_id !== message.client_id; }));
          }
        });
      });
    }, Promise.resolve());
  }

  function respondDate(message, status) {
    var payload = Object.assign({}, message.payload || {}, { status: status });
    db().from('messages').update({ payload: payload }).eq('id', message.id).then(function (result) {
      if (!result.error) {
        message.payload = payload;
        paintChat();
      }
    });
  }

  function markRead() {
    if (!active) return;
    db().from('conversation_members').update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', active.id)
      .eq('user_id', uid())
      .then(function () { refresh(); });
  }

  function safetyRow() {
    var block = el('button', { class: 'secondary', type: 'button', text: active.blocked ? 'Unblock' : 'Block' });
    var report = el('button', { class: 'secondary', type: 'button', text: 'Report' });
    var mute = el('button', { class: 'secondary', type: 'button', text: active.muted ? 'Unmute' : 'Mute' });
    var leave = el('button', { class: 'secondary', type: 'button', text: 'Leave' });
    block.addEventListener('click', toggleBlock);
    report.addEventListener('click', reportPerson);
    mute.addEventListener('click', toggleMute);
    leave.addEventListener('click', leaveChat);
    return el('div', { class: 'safety-row' }, block, report, mute, leave);
  }

  function toggleBlock() {
    if (!active || !active.otherId) return;
    if (active.blocked) {
      db().from('blocks').delete().eq('blocker_id', uid()).eq('blocked_id', active.otherId).then(function () {
        active.blocked = false;
        paintChat();
      });
      return;
    }
    if (!window.confirm('Block this person? They will not be able to message you.')) return;
    db().from('blocks').insert({ blocker_id: uid(), blocked_id: active.otherId }).then(function (result) {
      if (!result.error) {
        active.blocked = true;
        paintChat();
      }
    });
  }

  function reportPerson() {
    if (!active || !active.otherId) return;
    var screen = byId('chat-screen');
    if (!screen || byId('report-reason')) return;
    var field = el('textarea', { id: 'report-reason', rows: '2', maxlength: '1000', placeholder: 'What happened?', 'aria-label': 'Report' });
    var send = el('button', { class: 'primary', type: 'button', text: 'Send report' });
    send.addEventListener('click', function () {
      var reason = field.value.trim().slice(0, 1000);
      if (!reason) return;
      db().from('reports').insert({
        reporter_id: uid(),
        reported_id: active.otherId,
        conversation_id: active.id,
        reason: reason
      }).then(function (result) {
        var note = el('p', {
          class: 'migration-note',
          role: 'status',
          text: result.error ? 'The report could not be sent.' : 'Report sent. It stays with the account server.'
        });
        if (screen) screen.appendChild(note);
      });
    });
    screen.appendChild(el('div', { class: 'composer' }, field, send));
  }

  function toggleMute() {
    if (!active) return;
    var until = active.muted ? null : '9999-12-31T00:00:00.000Z';
    db().from('conversation_members').update({ muted_until: until })
      .eq('conversation_id', active.id)
      .eq('user_id', uid())
      .then(function (result) {
        if (!result.error) {
          active.muted = !active.muted;
          paintChat();
          refresh();
        }
      });
  }

  function leaveChat() {
    if (!active) return;
    if (!window.confirm('Leave this conversation? You will stop seeing new messages.')) return;
    db().from('conversation_members').update({ left_at: new Date().toISOString() })
      .eq('conversation_id', active.id)
      .eq('user_id', uid())
      .then(function () {
        active = null;
        closeChat();
        refresh();
      });
  }

  function openSharedPlan(conversation) {
    var view = byId('shared-plan-view');
    var screen = byId('chat-screen');
    if (!view) return;
    if (screen) screen.classList.add('hidden');
    view.classList.remove('hidden');
    view.replaceChildren(el('p', { class: 'muted', text: 'Opening the shared plan…' }));
    var finish = function (node) {
      var back = el('button', { class: 'secondary', type: 'button', text: 'Back to chat' });
      back.addEventListener('click', function () {
        view.classList.add('hidden');
        if (screen) screen.classList.remove('hidden');
      });
      view.replaceChildren(el('div', { class: 'detail-copy' }, back, node));
    };
    if (!conversation.plan_id) {
      finish(snapshotNode(conversation, 'This plan is not shared. You can see the objective from the request, not the private notes.'));
      return;
    }
    db().from('plan_shares').select('name, kind, route_name, route_grade, stage, timeframe, fixed_date, season, share_note, visibility, looking_for_partner, elevation')
      .eq('id', conversation.plan_id)
      .maybeSingle()
      .then(function (result) {
        if (result.error || !result.data) {
          finish(snapshotNode(conversation, 'This plan is not shared. You can see the objective from the request, not the private notes.'));
          return;
        }
        var row = result.data;
        finish(el('div', null,
          el('h2', { class: 'summit-name', text: row.name || conversation.objective_name }),
          el('p', { text: [row.elevation ? row.elevation + ' m' : '', row.route_name, row.route_grade, row.stage].filter(Boolean).join(' · ') }),
          el('p', { text: row.fixed_date || row.timeframe || conversation.dates || 'Date not set' }),
          row.share_note ? el('p', { text: row.share_note }) : null,
          el('p', { class: 'muted', text: 'Private preparation notes are not part of this view.' })
        ));
      });
  }

  function snapshotNode(conversation, notice) {
    return el('div', null,
      el('h2', { class: 'summit-name', text: conversation.objective_name || 'Objective' }),
      el('p', { text: headerLine(conversation) }),
      el('p', { class: 'muted', text: notice })
    );
  }

  function closeChat() {
    active = null;
    var screen = byId('chat-screen');
    var shared = byId('shared-plan-view');
    var flow = byId('partner-flow');
    var panel = byId('messages-panel');
    if (screen) screen.classList.add('hidden');
    if (shared) shared.classList.add('hidden');
    if (flow) flow.classList.remove('hidden');
    if (panel) panel.classList.remove('hidden');
    var home = byId('partner-home');
    var page = byId('objective-page');
    var profile = byId('partner-profile');
    if (home) home.classList.remove('hidden');
    if (page) page.classList.add('hidden');
    if (profile) profile.classList.add('hidden');
    refresh();
  }

  function refresh() {
    if (!ready()) {
      renderInbox();
      return Promise.resolve();
    }
    return loadRequests().then(loadThreads).then(function () {
      renderInbox();
      if (active && active.id) {
        return db().from('messages').select('id, sender_id, kind, body, payload, client_id, created_at')
          .eq('conversation_id', active.id)
          .order('created_at', { ascending: true })
          .limit(200)
          .then(function (result) {
            if (result.data && active) {
              var pending = active.messages.filter(function (message) { return message.failed; });
              active.messages = result.data.concat(pending.filter(function (message) {
                return !result.data.some(function (row) { return row.client_id === message.client_id; });
              }));
              var screen = byId('chat-screen');
              if (screen && !screen.classList.contains('hidden')) paintChat();
            }
          });
      }
    }).catch(function () {});
  }

  function noticeThreads(next) {
    if (!primed) {
      primed = true;
      next.forEach(function (thread) {
        threadState[thread.id] = { unread: thread.unread, preview: thread.preview };
      });
      return;
    }
    next.forEach(function (thread) {
      var prev = threadState[thread.id];
      if (prev && thread.unread > prev.unread && thread.senderId && thread.senderId !== uid()) {
        if (!(active && active.id === thread.id)) {
          showToast({
            conversationId: thread.id,
            preview: thread.preview,
            senderId: thread.senderId,
            title: thread.objective || 'New message'
          });
        }
      }
      threadState[thread.id] = { unread: thread.unread, preview: thread.preview };
    });
  }

  function showToast(message) {
    var host = byId('chat-toasts');
    if (!host || !message || !message.conversationId) return;
    var existing = host.querySelector('[data-toast="' + message.conversationId + '"]');
    var title = message.title || 'New message';
    var preview = String(message.preview || '').slice(0, 140);
    if (existing) {
      var line = existing.querySelector('p');
      if (line) line.textContent = title + ': ' + preview;
      restartToast(existing);
      return;
    }
    while (host.children.length >= 3) host.removeChild(host.firstChild);
    var toast = el('button', { type: 'button', class: 'chat-toast', 'data-toast': message.conversationId },
      el('p', { text: title + ': ' + preview })
    );
    var startY = 0;
    toast.addEventListener('click', function () {
      toast.remove();
      openConversation(message.conversationId);
    });
    toast.addEventListener('touchstart', function (event) {
      startY = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0].clientY : 0;
    }, { passive: true });
    toast.addEventListener('touchend', function (event) {
      var y = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0].clientY : startY;
      if (startY - y > 24) toast.remove();
    });
    host.appendChild(toast);
    restartToast(toast);
    if (message.senderId && ready()) {
      db().from('profiles').select('display_name').eq('id', message.senderId).maybeSingle().then(function (result) {
        var name = result.data && result.data.display_name;
        var line = toast.querySelector('p');
        if (name && line && toast.isConnected) line.textContent = name + ': ' + preview;
      }).catch(function () {});
    }
  }

  function restartToast(toast) {
    if (toast._timer) window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(function () { if (toast.isConnected) toast.remove(); }, 4000);
  }

  function offerPush() {
    if (pushOffered || !ready()) return;
    var api = account();
    if (!api.pushEnabled || !api.pushEnabled()) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
    pushOffered = true;
    var host = byId('chat-toasts');
    if (!host) return;
    var card = el('div', { class: 'chat-toast push-offer' },
      el('p', { text: 'Get a notification when someone replies.' }),
      el('p', { class: 'muted small', text: 'On iPhone, this works after you add SummitLog to the Home Screen (iOS 16.4 or newer).' })
    );
    var enable = el('button', { class: 'primary', type: 'button', text: 'Turn on' });
    var later = el('button', { class: 'secondary', type: 'button', text: 'Not now' });
    enable.addEventListener('click', function () { enablePush(); card.remove(); });
    later.addEventListener('click', function () { card.remove(); });
    card.appendChild(el('div', { class: 'partner-actions' }, enable, later));
    host.appendChild(card);
  }

  function enablePush() {
    var api = account();
    if (!api || !api.pushEnabled || !api.pushEnabled() || !ready()) return Promise.resolve({ ok: false });
    if (!root.Notification || !navigator.serviceWorker) return Promise.resolve({ ok: false, reason: 'unsupported' });
    var cfg = root.SUMMIT_CONFIG || {};
    return Notification.requestPermission().then(function (permission) {
      if (permission !== 'granted') return { ok: false };
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey || '')
        });
      }).then(function (sub) {
        var json = sub.toJSON();
        return db().from('push_subscriptions').upsert({
          user_id: uid(),
          endpoint: sub.endpoint,
          p256dh: json.keys.p256dh,
          auth_secret: json.keys.auth
        }, { onConflict: 'user_id,endpoint' }).then(function (result) {
          return { ok: !result.error };
        });
      });
    }).catch(function () { return { ok: false }; });
  }

  function urlBase64ToUint8Array(value) {
    var padding = '='.repeat((4 - value.length % 4) % 4);
    var base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = window.atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function openInbox() {
    if (!ready()) {
      if (hooks.signIn) hooks.signIn();
      return;
    }
    active = null;
    if (typeof root.selectTab === 'function') root.selectTab('partners');
  }

  function messageAbout(name) {
    if (!ready()) {
      if (hooks.signIn) hooks.signIn();
      return;
    }
    var key = root.SummitPartners ? root.SummitPartners.fold(name) : String(name || '').toLowerCase();
    var found = null;
    threads.forEach(function (thread) {
      if (root.SummitPartners.fold(thread.objective) === key) found = thread;
    });
    if (found) {
      if (typeof root.selectTab === 'function') root.selectTab('partners');
      openConversation(found.id);
      return;
    }
    if (hooks.openRequest) hooks.openRequest(name);
  }

  function openWithUser(userId) {
    if (!ready()) {
      if (hooks.signIn) hooks.signIn();
      return Promise.resolve(false);
    }
    return db().from('conversation_members').select('conversation_id, user_id').in('user_id', [uid(), userId]).then(function (result) {
      var mine = {};
      var theirs = {};
      (result.data || []).forEach(function (row) {
        if (row.user_id === uid()) mine[row.conversation_id] = true;
        if (row.user_id === userId) theirs[row.conversation_id] = true;
      });
      var found = null;
      Object.keys(mine).forEach(function (id) { if (theirs[id]) found = id; });
      if (!found) return false;
      if (typeof root.selectTab === 'function') root.selectTab('partners');
      openConversation(found);
      return true;
    }).catch(function () { return false; });
  }

  function subscribe() {
    var api = db();
    if (!api || !api.channel || api._summitChannel) return;
    try {
      api._summitChannel = api.channel('summit-inbox')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, function () { refresh(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_requests' }, function () { refresh(); })
        .subscribe();
    } catch (err) {
      // Realtime can be absent on a local API. Polling still updates the inbox.
    }
  }

  function start() {
    renderInbox();
    if (!ready()) return;
    if (!started) {
      started = true;
      window.addEventListener('online', function () { flushOutbox().then(refresh); });
      pollTimer = window.setInterval(function () {
        if (ready()) refresh();
      }, 8000);
    }
    subscribe();
    flushOutbox().then(refresh);
  }

  function bind(next) {
    hooks = Object.assign(hooks, next || {});
  }

  return {
    bind: bind,
    start: start,
    refresh: refresh,
    renderInbox: renderInbox,
    peopleFor: peopleFor,
    personById: personById,
    prefetchQueue: prefetchQueue,
    actionsForPerson: actionsForPerson,
    openConversation: openConversation,
    openInbox: openInbox,
    messageAbout: messageAbout,
    openWithUser: openWithUser,
    enablePush: enablePush,
    localStamp: localStamp
  };
});
