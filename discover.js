// Floating Discover guide. The fixed bottom sheet stays off.
(function (root) {
  'use strict';

  var pos = { edge: 'right', y: 0.58 };
  var drag = null;
  var moved = false;
  var path = ['intent'];
  var choice = { intent: '', region: '', style: '', areaId: 0, trekId: 0 };
  var catalog = null;
  var hikes = null;
  var routes = null;
  var panelDrag = null;

  function byId(id) { return document.getElementById(id); }
  function fold(value) {
    return root.SummitPartners ? SummitPartners.fold(value) : String(value || '').toLowerCase();
  }

  function loadPos() {
    var saved = root.SummitLogStorage && SummitLogStorage.loadDiscover && SummitLogStorage.loadDiscover();
    if (saved) pos = saved;
  }

  function savePos() {
    if (root.SummitLogStorage && SummitLogStorage.saveDiscover) SummitLogStorage.saveDiscover(pos);
  }

  function limits() {
    var frame = byId('map-frame');
    if (!frame) return null;
    var rect = frame.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return null;
    var pills = document.querySelector('.map-pills');
    var top = 148;
    if (pills) top = Math.max(120, pills.getBoundingClientRect().bottom - rect.top + 10);
    var bottomGap = 78;
    return { rect: rect, top: top, bottom: rect.height - bottomGap - 56, size: 56, pad: 12 };
  }

  function place() {
    var bubble = byId('discover-bubble');
    var box = limits();
    if (!bubble || !box) return;
    var y = box.top + pos.y * Math.max(1, box.bottom - box.top);
    y = Math.max(box.top, Math.min(box.bottom, y));
    var x = pos.edge === 'left' ? box.pad : box.rect.width - box.size - box.pad;
    bubble.style.left = x + 'px';
    bubble.style.top = y + 'px';
  }

  function snap(clientX, clientY) {
    var box = limits();
    if (!box) return;
    var frame = byId('map-frame').getBoundingClientRect();
    var localX = clientX - frame.left;
    var localY = clientY - frame.top - box.size / 2;
    pos.edge = localX < frame.width / 2 ? 'left' : 'right';
    var span = Math.max(1, box.bottom - box.top);
    pos.y = Math.max(0, Math.min(1, (localY - box.top) / span));
    var bubble = byId('discover-bubble');
    if (bubble) bubble.classList.add('is-snapping');
    place();
    savePos();
    root.setTimeout(function () { if (bubble) bubble.classList.remove('is-snapping'); }, 200);
  }

  function step() { return path[path.length - 1]; }

  function push(name) { path.push(name); render(); }

  function goBack() {
    if (path.length > 1) path.pop();
    render();
  }

  function reset() {
    path = ['intent'];
    choice = { intent: '', region: '', style: '', areaId: 0, trekId: 0 };
    if (root.SummitLayers) {
      SummitLayers.setActivity('mountaineering');
      SummitLayers.setClimbKind('all');
      SummitLayers.setGrade('', '');
    }
    var min = byId('grade-min');
    var max = byId('grade-max');
    if (min) min.value = '';
    if (max) max.value = '';
    if (typeof root.syncActivityPills === 'function') root.syncActivityPills();
    if (typeof root.updateMapMarkers === 'function') root.updateMapMarkers();
    render();
  }

  function aimAtBubble(panel) {
    var bubble = byId('discover-bubble');
    if (!panel || !bubble) return;
    panel.style.transform = 'none';
    var panelBox = panel.getBoundingClientRect();
    panel.style.transform = '';
    var bubbleBox = bubble.getBoundingClientRect();
    if (!panelBox.width || !bubbleBox.width) return;
    var ox = bubbleBox.left + bubbleBox.width / 2 - panelBox.left;
    var oy = bubbleBox.top + bubbleBox.height / 2 - panelBox.top;
    panel.style.transformOrigin = ox + 'px ' + oy + 'px';
  }

  function closePanel() {
    var panel = byId('discover-panel');
    var bubble = byId('discover-bubble');
    if (bubble) bubble.classList.remove('is-open');
    if (!panel || panel.hidden) return;
    aimAtBubble(panel);
    panel.classList.remove('is-open');
    var token = {};
    panel._closeToken = token;
    root.setTimeout(function () {
      if (panel._closeToken !== token) return;
      panel.hidden = true;
    }, prefersReduced() ? 0 : 230);
  }

  function openPanel() {
    var panel = byId('discover-panel');
    var bubble = byId('discover-bubble');
    if (!panel) return;
    panel._closeToken = {};
    panel.hidden = false;
    if (bubble) bubble.classList.add('is-open');
    render();
    aimAtBubble(panel);
    if (prefersReduced() || panel.classList.contains('is-open')) {
      panel.classList.add('is-open');
      return;
    }
    root.requestAnimationFrame(function () {
      root.requestAnimationFrame(function () {
        if (panel.hidden) return;
        panel.classList.add('is-open');
      });
    });
  }

  function prefersReduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function ensureData(done) {
    var pending = 0;
    function finish() { pending -= 1; if (!pending) done(); }
    if (!catalog) {
      pending += 1;
      fetch('data/map-search.json').then(function (r) { return r.json(); }).then(function (data) {
        catalog = data;
        finish();
      }).catch(finish);
    }
    if (!hikes) {
      pending += 1;
      fetch('data/hikes/treks.json').then(function (r) { return r.json(); }).then(function (data) {
        hikes = data;
        finish();
      }).catch(finish);
    }
    if (!routes) {
      pending += 1;
      fetch('data/camptocamp/routes.json').then(function (r) { return r.json(); }).then(function (data) {
        routes = data;
        root.SummitC2C = data;
        finish();
      }).catch(finish);
    }
    if (!pending) done();
  }

  function rank(grade) {
    var order = root.SummitLayers && SummitLayers.grades ? SummitLayers.grades() : [];
    var text = String(grade || '').toLowerCase();
    var index = order.indexOf(text);
    return index < 0 ? null : index;
  }

  function areaInGrade(area) {
    var grade = root.SummitLayers ? SummitLayers.grade() : { min: '', max: '' };
    if (!grade.min && !grade.max) return true;
    if (!area.graded) return true;
    var lo = rank(area.min);
    var hi = rank(area.max);
    var min = grade.min ? rank(grade.min) : 0;
    var max = grade.max ? rank(grade.max) : 99;
    if (lo == null || hi == null) return true;
    return hi >= min && lo <= max;
  }

  function row(title, detail, onClick) {
    var button = root.el('button', { class: 'discover-row', type: 'button' },
      root.el('span', { class: 'discover-row-copy' },
        root.el('strong', { text: title }),
        detail ? root.el('span', { text: detail }) : null
      ),
      root.el('span', { class: 'discover-chevron', 'aria-hidden': 'true', text: '›' })
    );
    button.addEventListener('click', onClick);
    return button;
  }

  function regions() {
    var peaks = root.collectionData && collectionData.peaks ? collectionData.peaks : [];
    var names = [];
    peaks.forEach(function (peak) {
      var name = peak.subrange || 'Alps';
      if (names.indexOf(name) < 0) names.push(name);
    });
    names.sort();
    return names;
  }

  function peaksIn(region) {
    var peaks = root.collectionData && collectionData.peaks ? collectionData.peaks : [];
    return peaks.filter(function (peak) { return (peak.subrange || 'Alps') === region; });
  }

  function fly(bounds, maxZoom) {
    if (!root.map || !root.L || !bounds || !bounds.length) return;
    map.fitBounds(root.L.latLngBounds(bounds), { padding: [28, 88], maxZoom: maxZoom || 12, animate: !prefersReduced() });
  }

  function useActivity(name) {
    if (!root.SummitLayers) return;
    SummitLayers.setActivity(name);
    if (typeof root.syncActivityPills === 'function') root.syncActivityPills();
    if (typeof root.updateMapMarkers === 'function') root.updateMapMarkers();
  }

  function applyGrade(min, max) {
    if (!root.SummitLayers) return;
    SummitLayers.setGrade(min, max);
    var from = byId('grade-min');
    var to = byId('grade-max');
    if (typeof root.fillGradeSelects === 'function') root.fillGradeSelects();
    if (from) from.value = min || '';
    if (to) to.value = max || '';
    if (typeof root.updateMapMarkers === 'function') root.updateMapMarkers();
  }

  function chooseIntent(intent) {
    choice.intent = intent;
    if (intent === 'mountains') {
      useActivity('mountaineering');
      push('where');
    } else if (intent === 'climbing') {
      useActivity('climbing');
      push('places');
    } else {
      useActivity('hiking');
      push('treks');
    }
  }

  function chooseRegion(name) {
    choice.region = name;
    choice.near = false;
    var pts = peaksIn(name).map(function (peak) { return [peak.lat, peak.lng]; });
    fly(pts, 9);
    applyMountain();
    push('day');
  }

  function chooseNear() {
    if (!navigator.geolocation) {
      choice.nearNote = 'Location is off. Pick a region instead.';
      render();
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      choice.near = true;
      choice.region = '';
      choice.here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (root.map) map.setView([choice.here.lat, choice.here.lng], 10);
      applyMountain();
      push('day');
    }, function () {
      choice.nearNote = 'Location is off. Pick a region instead.';
      render();
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
  }

  function choosePeak(peak) {
    var host = byId('discover-results');
    if (host) host.hidden = true;
    if (typeof root.showPeakDetail === 'function') root.showPeakDetail(peak);
    closePanel();
  }

  function chooseBleau() {
    var areas = catalog && catalog.areas ? catalog.areas : [];
    fly(areas.map(function (area) { return [area.lat, area.lng]; }), 11);
    push('style');
  }

  function chooseStyle(style) {
    choice.style = style;
    if (root.SummitLayers) SummitLayers.setClimbKind(style === 'all' ? 'all' : style);
    if (typeof root.syncActivityPills === 'function') root.syncActivityPills();
    if (typeof root.updateMapMarkers === 'function') root.updateMapMarkers();
    if (style === 'sport' || style === 'trad' || style === 'multipitch') push('empty');
    else push('grade');
  }

  function chooseArea(area) {
    choice.areaId = area.id;
    fly([[area.s, area.w], [area.n, area.e]], 16);
    push('circuits');
  }

  function chooseCircuit(circuit) {
    if (root.map) map.setView([circuit[3], circuit[4]], 16);
    closePanel();
  }

  function chooseTrek(trek) {
    choice.trekId = trek.id;
    if (root.SummitLayers && SummitLayers.flyTo) SummitLayers.flyTo({ type: 'trek', trek: trek });
    if (typeof root.showTrekLine === 'function') root.showTrekLine(trek);
    push('huts');
  }

  function chooseHut(hut, trek) {
    if (root.map) map.setView([hut.lat, hut.lng], 14);
    if (typeof root.showHutStop === 'function') root.showHutStop(hut, trek);
    closePanel();
  }

  function hint(text) {
    var body = byId('discover-body');
    if (!body) return;
    body.insertBefore(root.el('p', { class: 'discover-hint', text: text }), body.firstChild);
  }

  function skip(which) {
    var button = root.el('button', { class: 'discover-skip', type: 'button', text: "I'm not sure" });
    button.addEventListener('click', function () {
      if (which === 'where') { choice.region = ''; choice.near = false; applyMountain(); push('day'); }
      if (which === 'day') chooseDay('');
      if (which === 'experience') chooseExperience('');
      if (which === 'when') chooseWhen(0);
    });
    return button;
  }

  function savedExperience() {
    var store = root.SummitLogStorage;
    return store && store.loadExperience ? store.loadExperience() : '';
  }

  function chooseDay(day) {
    choice.day = day || '';
    applyMountain();
    var saved = savedExperience();
    if (saved) {
      choice.experience = saved;
      path.push('experience');
      path.push('when');
      render();
      return;
    }
    push('experience');
  }

  function chooseExperience(level) {
    choice.experience = level || '';
    if (root.SummitLogStorage && SummitLogStorage.saveExperience) SummitLogStorage.saveExperience(choice.experience);
    applyMountain();
    push('when');
  }

  function chooseWhen(month) {
    choice.when = month || 0;
    applyMountain();
    push('results');
  }

  function c2c(id) {
    return routes && routes.peaks ? routes.peaks[id] : null;
  }

  function gradeRank(grade) {
    var order = ['F', 'F+', 'PD-', 'PD', 'PD+', 'AD-', 'AD', 'AD+', 'D-', 'D', 'D+', 'TD-', 'TD', 'TD+', 'ED-', 'ED', 'ED+'];
    var index = order.indexOf(grade);
    return index < 0 ? null : index;
  }

  function matchesDay(info) {
    if (!choice.day) return true;
    if (!info) return false;
    if (choice.day === 'hike') return info.activity === 'hiking' && info.glacier === false;
    if (choice.day === 'glacier') return info.glacier === true;
    if (choice.day === 'alpine') {
      var hard = gradeRank(info.grade);
      if (info.activity === 'rock') return true;
      return info.activity === 'snow-ice-mixed' && hard != null && hard >= gradeRank('AD-');
    }
    return true;
  }

  function nearEnough(peak) {
    if (!choice.near || !choice.here) return true;
    var x = (peak.lng - choice.here.lng) * Math.cos(((peak.lat + choice.here.lat) / 2) * Math.PI / 180);
    var y = peak.lat - choice.here.lat;
    return Math.sqrt(x * x + y * y) * 111 <= 50;
  }

  function matchingPeaks() {
    var pool = choice.region ? peaksIn(choice.region) : (root.collectionData && collectionData.peaks ? collectionData.peaks.slice() : []);
    return pool.filter(function (peak) {
      if (!nearEnough(peak)) return false;
      if (!choice.day) return true;
      return matchesDay(c2c(peak.id));
    });
  }

  function applyMountain() {
    var matches = matchingPeaks();
    if (choice.intent === 'mountains' && (choice.region || choice.near || choice.day)) {
      var ids = {};
      matches.forEach(function (peak) { ids[peak.id] = true; });
      root.discoverPeakIds = ids;
    } else root.discoverPeakIds = null;
    if (typeof root.updateMapMarkers === 'function') root.updateMapMarkers();
  }

  function dayLabel(day) {
    if (day === 'hike') return 'Summit hike';
    if (day === 'glacier') return 'Glacier tour';
    if (day === 'alpine') return 'Alpine climb';
    return 'Any day';
  }
  function experienceLabel(level) {
    if (level === 'beginner') return 'Beginner';
    if (level === 'guide') return 'With a guide';
    if (level === 'glacier') return 'Glacier skills';
    return 'Experience';
  }
  function whenLabel(month) {
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return month ? names[month - 1] : 'Any time';
  }

  function fitNote(info) {
    if (!info || !info.grade) return 'Grade unknown';
    var hard = gradeRank(info.grade);
    if (choice.experience === 'beginner' && info.glacier === true) return 'Glacier skills needed';
    if (choice.experience === 'beginner' && hard != null && hard >= gradeRank('AD-')) return info.grade + ' — alpine climbing experience';
    if (choice.experience === 'guide' && hard != null && hard >= gradeRank('D-')) return info.grade + ' — alpine climbing experience';
    if (choice.experience === 'glacier' && hard != null && hard >= gradeRank('TD-')) return info.grade + ' — alpine climbing experience';
    return dayLabel(choice.day);
  }

  function paintResults(matches) {
    var host = byId('discover-results');
    if (!host) return;
    if (!matches.length) { host.hidden = true; host.replaceChildren(); return; }
    host.hidden = false;
    host.replaceChildren.apply(host, matches.slice(0, 12).map(function (peak) {
      var info = c2c(peak.id) || {};
      var photo = typeof root.photoRecord === 'function' ? root.photoRecord(peak) : null;
      var src = photo && typeof root.safePhotoUrl === 'function' ? root.safePhotoUrl(photo.thumb) : '';
      var add = root.el('button', { type: 'button', text: 'Add to plan' });
      add.addEventListener('click', function (event) {
        event.stopPropagation();
        if (typeof root.placeForPeak === 'function' && typeof root.confirmPlan === 'function') root.confirmPlan(root.placeForPeak(peak));
      });
      var card = root.el('article', { class: 'discover-card' },
        src ? root.el('img', { alt: '', src: src }) : root.el('div', { class: 'peak-photo-empty', role: 'img', 'aria-label': 'Illustrated placeholder' }),
        root.el('div', {},
          root.el('strong', { text: peak.name }),
          root.el('span', { text: peak.elevation ? peak.elevation + ' m' : '' }),
          root.el('span', { text: (info.name || 'Normal route') + ' · ' + (info.grade || 'Grade unknown') }),
          root.el('span', { text: fitNote(info) }),
          add
        )
      );
      card.addEventListener('click', function () { choosePeak(peak); });
      return card;
    }));
  }

  function crumbLabel(name) {
    if (name === 'intent') {
      if (choice.intent === 'mountains') return 'Mountain objectives';
      if (choice.intent === 'climbing') return 'Climbing areas';
      if (choice.intent === 'hiking') return 'Hiking and trekking';
      return 'Start';
    }
    if (name === 'where') return choice.near ? 'Near me' : (choice.region || 'Where');
    if (name === 'day') return dayLabel(choice.day);
    if (name === 'experience') return experienceLabel(choice.experience);
    if (name === 'when') return whenLabel(choice.when);
    if (name === 'places' || name === 'treks') {
      if (choice.intent === 'climbing') return 'Climbing areas';
      return 'Hiking and trekking';
    }
    if (name === 'style') return 'Fontainebleau';
    if (name === 'grade') return choice.style === 'bouldering' ? 'Bouldering' : 'Style';
    if (name === 'areas') return 'Grade';
    if (name === 'circuits') return 'Area';
    if (name === 'huts') return 'Trek';
    return name;
  }

  function renderCrumbs() {
    var host = byId('discover-crumbs');
    if (!host) return;
    if (path.length < 2) {
      host.replaceChildren();
      return;
    }
    host.replaceChildren.apply(host, path.slice(0, -1).map(function (name, index) {
      var button = root.el('button', { class: 'discover-crumb', type: 'button', text: crumbLabel(name) });
      button.addEventListener('click', function () {
        path = path.slice(0, index + 1);
        render();
      });
      return button;
    }));
  }

  function render() {
    var title = byId('discover-title');
    var body = byId('discover-body');
    var back = byId('discover-back');
    if (!title || !body) return;
    if (back) back.disabled = path.length < 2;
    renderCrumbs();
    var name = step();
    if (name === 'intent') {
      title.textContent = 'What are you looking for?';
      body.replaceChildren(
        row('Mountain objectives', 'Summits and alpine routes', function () { chooseIntent('mountains'); }),
        row('Climbing areas', 'Crags, boulders and routes', function () { chooseIntent('climbing'); }),
        row('Hiking and trekking', 'Trails and long-distance routes', function () { chooseIntent('hiking'); })
      );
      return;
    }
    if (name === 'where') {
      title.textContent = 'Where do you want to go?';
      var list = regions();
      var nodes = list.map(function (region) { return row(region, 'Alpine 4000ers', function () { chooseRegion(region); }); });
      nodes.push(row('Near me', 'Uses this device’s location', chooseNear));
      nodes.push(skip('where'));
      if (choice.nearNote) nodes.push(root.el('p', { class: 'muted', text: choice.nearNote }));
      body.replaceChildren.apply(body, nodes);
      hint('A region from the Alpine 4000ers, or where you are now.');
      return;
    }
    if (name === 'day') {
      title.textContent = 'What kind of day?';
      body.replaceChildren(
        row('Summit hike', 'A walk to a summit, no glacier', function () { chooseDay('hike'); }),
        row('Glacier tour', 'A glacier is part of the normal route', function () { chooseDay('glacier'); }),
        row('Alpine climb', 'Snow, ice, mixed or rock', function () { chooseDay('alpine'); }),
        skip('day')
      );
      hint('This uses the normal route recorded on Camptocamp. Unknown routes are left out.');
      return;
    }
    if (name === 'experience') {
      title.textContent = 'Your experience?';
      body.replaceChildren(
        row('Beginner', 'New to alpine days', function () { chooseExperience('beginner'); }),
        row('With a guide', 'Going with someone who leads', function () { chooseExperience('guide'); }),
        row('Independent with glacier skills', 'You travel on glaciers yourself', function () { chooseExperience('glacier'); }),
        skip('experience')
      );
      hint('Nothing is hidden. A short note appears when a route asks for more experience.');
      return;
    }
    if (name === 'when') {
      title.textContent = 'When?';
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      body.replaceChildren.apply(body, months.map(function (month, index) {
        return row(month, '', function () { chooseWhen(index + 1); });
      }).concat([skip('when')]));
      hint('Best months are used only when Camptocamp recorded them.');
      return;
    }
    if (name === 'results') {
      title.textContent = 'A few that fit';
      applyMountain();
      var matches = matchingPeaks();
      paintResults(matches);
      var surprise = root.el('button', { class: 'primary', type: 'button', text: 'Surprise me' });
      surprise.addEventListener('click', function () {
        if (!matches.length) return;
        choosePeak(matches[Math.floor(Math.random() * matches.length)]);
      });
      body.replaceChildren(
        matches.length ? root.el('p', { class: 'muted', text: 'The matching summits are on the map. Cards sit above Discover.' }) : root.el('p', { class: 'muted', text: 'Nothing recorded for this combination.' }),
        surprise
      );
      return;
    }
    if (name === 'places') {
      title.textContent = 'Climbing areas';
      body.replaceChildren(
        row('Fontainebleau', 'Boulder areas, circuits and problems', chooseBleau),
        root.el('p', { class: 'muted', text: 'Sport, trad and multipitch areas are not in this map yet.' })
      );
      return;
    }
    if (name === 'style') {
      title.textContent = 'Which style?';
      body.replaceChildren(
        row('Bouldering', 'Fontainebleau problems', function () { chooseStyle('bouldering'); }),
        row('Sport', 'No areas yet', function () { chooseStyle('sport'); }),
        row('Trad', 'No areas yet', function () { chooseStyle('trad'); }),
        row('Multipitch', 'No areas yet', function () { chooseStyle('multipitch'); })
      );
      return;
    }
    if (name === 'empty') {
      title.textContent = 'No areas here yet';
      body.replaceChildren(root.el('p', { text: 'No areas here yet' }));
      return;
    }
    if (name === 'grade') {
      title.textContent = 'Grade range';
      var grades = root.SummitLayers && SummitLayers.grades ? SummitLayers.grades() : [];
      var current = root.SummitLayers ? SummitLayers.grade() : { min: '', max: '' };
      function select(id, value) {
        var node = root.el('select', { id: id, 'aria-label': id === 'discover-grade-min' ? 'Minimum grade' : 'Maximum grade' });
        node.appendChild(root.el('option', { value: '', text: 'Any' }));
        grades.forEach(function (grade) { node.appendChild(root.el('option', { value: grade, text: grade })); });
        node.value = value || '';
        node.addEventListener('change', function () {
          applyGrade(byId('discover-grade-min').value, byId('discover-grade-max').value);
        });
        return node;
      }
      var next = root.el('button', { class: 'primary', type: 'button', text: 'Choose an area' });
      next.addEventListener('click', function () { push('areas'); });
      body.replaceChildren(
        root.el('p', { class: 'field-label', text: 'Font grades' }),
        root.el('label', { class: 'field-label', text: 'From' }),
        select('discover-grade-min', current.min),
        root.el('label', { class: 'field-label', text: 'To' }),
        select('discover-grade-max', current.max),
        next
      );
      return;
    }
    if (name === 'areas') {
      title.textContent = 'Fontainebleau';
      var areas = (catalog && catalog.areas ? catalog.areas : []).filter(areaInGrade);
      body.replaceChildren.apply(body, areas.length
        ? areas.map(function (area) {
          var detail = area.graded ? '' : 'No grade data';
          return row(area.name, detail, function () { chooseArea(area); });
        })
        : [root.el('p', { class: 'muted', text: 'Nothing in this grade range.' })]);
      return;
    }
    if (name === 'circuits') {
      title.textContent = 'Circuits';
      var circuits = (catalog && catalog.circuits ? catalog.circuits : []).filter(function (item) { return item[1] === choice.areaId; });
      body.replaceChildren.apply(body, circuits.length
        ? circuits.map(function (item) {
          var label = (item[2] || 'Circuit');
          return row(label.charAt(0).toUpperCase() + label.slice(1) + ' circuit', '', function () { chooseCircuit(item); });
        })
        : [root.el('p', { class: 'muted', text: 'No circuit line for this area.' })]);
      return;
    }
    if (name === 'treks') {
      title.textContent = 'Treks';
      var list = hikes && hikes.treks ? hikes.treks : [];
      body.replaceChildren.apply(body, list.map(function (trek) {
        return row(trek.name, 'Trek', function () { chooseTrek(trek); });
      }));
      return;
    }
    if (name === 'huts') {
      title.textContent = 'Huts';
      var trek = null;
      (hikes && hikes.treks ? hikes.treks : []).forEach(function (item) { if (item.id === choice.trekId) trek = item; });
      var huts = trek && trek.huts ? trek.huts : [];
      body.replaceChildren.apply(body, huts.length
        ? huts.map(function (hut) { return row(hut.name, 'Alpine hut', function () { chooseHut(hut, trek); }); })
        : [root.el('p', { class: 'muted', text: 'No alpine huts were stored along this line.' })]);
    }
  }

  function bindBubble() {
    var bubble = byId('discover-bubble');
    if (!bubble || bubble.dataset.bound) return;
    bubble.dataset.bound = '1';
    bubble.addEventListener('pointerdown', function (event) {
      if (event.button != null && event.button !== 0) return;
      var box = bubble.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top };
      moved = false;
      bubble.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    bubble.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      if (dx * dx + dy * dy > 36) moved = true;
      if (!moved) return;
      var frame = byId('map-frame').getBoundingClientRect();
      bubble.classList.remove('is-snapping');
      bubble.style.left = (drag.left - frame.left + dx) + 'px';
      bubble.style.top = (drag.top - frame.top + dy) + 'px';
    });
    function end(event) {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      if (moved) snap(event.clientX, event.clientY);
      else openPanel();
    }
    bubble.addEventListener('click', function () {
      if (moved) { moved = false; return; }
      openPanel();
    });
    bubble.addEventListener('pointerup', end);
    bubble.addEventListener('pointercancel', end);
  }

  function bindPanel() {
    var panel = byId('discover-panel');
    var grab = byId('discover-grab');
    if (!panel || !grab || panel.dataset.bound) return;
    panel.dataset.bound = '1';
    grab.addEventListener('pointerdown', function (event) {
      var box = panel.getBoundingClientRect();
      var frame = byId('map-frame').getBoundingClientRect();
      panelDrag = { id: event.pointerId, y: event.clientY, top: box.top - frame.top };
      grab.setPointerCapture(event.pointerId);
    });
    grab.addEventListener('pointermove', function (event) {
      if (!panelDrag || event.pointerId !== panelDrag.id) return;
      var frame = byId('map-frame').getBoundingClientRect();
      var next = panelDrag.top + (event.clientY - panelDrag.y);
      next = Math.max(120, Math.min(frame.height - 160, next));
      panel.style.top = next + 'px';
      panel.style.bottom = 'auto';
    });
    grab.addEventListener('pointerup', function () { panelDrag = null; });
    byId('discover-back').addEventListener('click', goBack);
    byId('discover-show').addEventListener('click', closePanel);
    byId('discover-reset').addEventListener('click', reset);
  }

  function refresh() { if (byId('discover-panel') && !byId('discover-panel').hidden) render(); }

  loadPos();
  bindBubble();
  bindPanel();
  ensureData(function () { if (byId('discover-panel') && !byId('discover-panel').hidden) render(); });
  root.addEventListener('resize', place);
  place();

  root.SummitDiscover = {
    reload: function () { loadPos(); place(); },
    place: place,
    refresh: refresh,
    close: closePanel
  };
})(window);
