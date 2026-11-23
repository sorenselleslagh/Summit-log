// Climbing and hiking layers on the existing map.
// Boolder problems stay in per-area files. Search uses data/map-search.json.
(function (root) {
  'use strict';

  var activity = 'mountaineering';
  var climbKind = 'all';
  var gradeMin = '';
  var gradeMax = '';
  var personal = { planned: false, done: false };
  var highlightTrek = 0;
  var searchDoc = null;
  var searchLoading = false;
  var searchWait = [];
  var climbIndex = null;
  var climbLoading = false;
  var areaCache = {};
  var areaLoading = {};
  var treks = null;
  var trekLoading = false;
  var drawn = [];

  var ORDER = ['1','2','3','4','5a','5b','5c','6a','6a+','6b','6b+','6c','6c+','7a','7a+','7b','7b+','7c','7c+','8a','8a+','8b','8b+','8c','8c+','9a','9a+','9b','9b+','9c'];
  var RANK = {};
  ORDER.forEach(function (grade, index) { RANK[grade] = index; });

  var CIRCUIT = {
    yellow: '#d4a017', orange: '#e07a1f', blue: '#2f6fbf', red: '#d64545',
    black: '#241f1a', white: '#f7f4ef', green: '#2f8f57', purple: '#7a4ea3', skyblue: '#4aa3c7'
  };

  function layerOn(name) {
    if (activity === 'all') return true;
    return activity === name;
  }

  function setActivity(name) {
    if (name !== 'all' && name !== 'mountaineering' && name !== 'climbing' && name !== 'hiking') return activity;
    activity = name;
    return activity;
  }

  function setClimbKind(name) {
    climbKind = name || 'all';
    return climbKind;
  }

  function setGrade(min, max) {
    gradeMin = min || '';
    gradeMax = max || '';
  }

  function setPersonal(next) {
    personal.planned = !!(next && next.planned);
    personal.done = !!(next && next.done);
  }

  function boulderOn() {
    return layerOn('climbing') && (climbKind === 'all' || climbKind === 'bouldering');
  }

  function emptyClimbKind() {
    return layerOn('climbing') && climbKind !== 'all' && climbKind !== 'bouldering';
  }

  function rankOf(grade) {
    var text = String(grade || '').toLowerCase().replace(/\s/g, '');
    if (RANK[text] != null) return RANK[text];
    var match = text.match(/^(\d+[abc]?\+?)/);
    if (match && RANK[match[1]] != null) return RANK[match[1]];
    return null;
  }

  function gradeActive() { return !!(gradeMin || gradeMax); }

  function inGrade(grade) {
    if (!gradeActive()) return true;
    var rank = rankOf(grade);
    if (rank == null) return false;
    var min = gradeMin ? rankOf(gradeMin) : 0;
    var max = gradeMax ? rankOf(gradeMax) : ORDER.length;
    if (min == null) min = 0;
    if (max == null) max = ORDER.length;
    return rank >= min && rank <= max;
  }

  function areaVisible(area) {
    if (!area) return false;
    if (!gradeActive()) return true;
    if (!area.graded) return true;
    var min = gradeMin ? rankOf(gradeMin) : 0;
    var max = gradeMax ? rankOf(gradeMax) : ORDER.length;
    var lo = rankOf(area.min);
    var hi = rankOf(area.max);
    if (lo == null || hi == null) return true;
    return hi >= min && lo <= max;
  }

  function passesPersonal(planned, done) {
    if (!personal.planned && !personal.done) return true;
    if (personal.planned && planned) return true;
    if (personal.done && done) return true;
    return false;
  }

  function savedProblem(id) {
    var list = root.items || [];
    var key = 'boolder-' + id;
    var planned = false;
    var done = false;
    list.forEach(function (item) {
      if (!item || item.collectionId !== key) return;
      if (item.status === 'planned') planned = true;
      if (item.status === 'done') done = true;
    });
    return { planned: planned, done: done };
  }

  function clearDrawn(map) {
    drawn.forEach(function (layer) { if (map && layer) map.removeLayer(layer); });
    drawn = [];
  }

  function stop(event) {
    root.suppressMapClick = true;
    try {
      if (root.L && event && event.originalEvent) root.L.DomEvent.stopPropagation(event);
    } catch (err) { /* Synthetic clicks still open the card. */ }
  }

  function gradeColor(grade) {
    var n = parseInt(String(grade || ''), 10);
    if (!n) return '#5c6b62';
    if (n <= 3) return '#2f8f57';
    if (n === 4) return '#2f6f9f';
    if (n === 5) return '#c4841d';
    if (n === 6) return '#d4652f';
    if (n === 7) return '#c23b4a';
    return '#5c4d7a';
  }

  function circuitColor(name) {
    return CIRCUIT[String(name || '').toLowerCase()] || '#6b6258';
  }

  function add(map, layer) {
    layer.addTo(map);
    drawn.push(layer);
    return layer;
  }

  function ensureSearch(done) {
    if (searchDoc) {
      if (done) done(searchDoc);
      return;
    }
    if (done) searchWait.push(done);
    if (searchLoading) return;
    searchLoading = true;
    fetch('data/map-search.json').then(function (response) {
      if (!response.ok) throw new Error('search');
      return response.json();
    }).then(function (data) {
      searchDoc = data;
      climbIndex = { areas: data.areas || [] };
      searchLoading = false;
      var wait = searchWait.slice();
      searchWait = [];
      wait.forEach(function (fn) { fn(searchDoc); });
      if (root.map && boulderOn()) draw(root.map);
    }).catch(function () { searchLoading = false; searchWait = []; });
  }

  function ensureTreks(done) {
    if (treks) {
      if (done) done(treks);
      return;
    }
    if (trekLoading) return;
    trekLoading = true;
    fetch('data/hikes/treks.json').then(function (response) {
      if (!response.ok) throw new Error('treks');
      return response.json();
    }).then(function (data) {
      treks = data;
      trekLoading = false;
      if (done) done(treks);
      if (root.map && layerOn('hiking')) draw(root.map);
    }).catch(function () { trekLoading = false; });
  }

  function loadArea(area) {
    if (areaCache[area.id] || areaLoading[area.id]) return;
    areaLoading[area.id] = true;
    fetch('data/climbing/areas/' + area.id + '.json').then(function (response) {
      if (!response.ok) throw new Error('area');
      return response.json();
    }).then(function (data) {
      areaCache[area.id] = data;
      areaLoading[area.id] = false;
      if (boulderOn() && root.map && root.map.getZoom() >= 13) draw(root.map);
    }).catch(function () { areaLoading[area.id] = false; });
  }

  function areasInBounds(bounds) {
    return ((searchDoc && searchDoc.areas) || (climbIndex && climbIndex.areas) || []).filter(function (area) {
      if (!areaVisible(area)) return false;
      return bounds.intersects([[area.s, area.w], [area.n, area.e]]) || bounds.contains([area.lat, area.lng]);
    });
  }

  function drawAreas(map, areas) {
    areas.forEach(function (area) {
      var dot = root.L.circleMarker([area.lat, area.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: area.graded ? '#1f6b45' : '#8a8175',
        fillOpacity: 0.95
      });
      dot.bindTooltip(area.graded ? area.name : area.name + ' · No grade data', { direction: 'top', opacity: 0.9 });
      dot.on('click', function (event) {
        stop(event);
        map.fitBounds([[area.s, area.w], [area.n, area.e]], { maxZoom: 16, padding: [28, 28] });
      });
      add(map, dot);
    });
  }

  function drawCircuits(map, areas) {
    var bounds = map.getBounds();
    areas.forEach(function (area) {
      var data = areaCache[area.id];
      if (!data) {
        loadArea(area);
        return;
      }
      (data.circuits || []).forEach(function (circuit) {
        if (!circuit.line || circuit.line.length < 2) return;
        var related = (data.problems || []).filter(function (row) { return row[5] === circuit.id; });
        var graded = related.filter(function (row) { return rankOf(row[2]) != null; });
        var show = !gradeActive() || !graded.length || graded.some(function (row) { return inGrade(row[2]); });
        if (!show) return;
        var latlngs = circuit.line.map(function (pair) { return [pair[1], pair[0]]; });
        if (!latlngs.some(function (pair) { return bounds.contains(pair); })) return;
        var line = root.L.polyline(latlngs, { color: circuitColor(circuit.color), weight: 3, opacity: 0.85 });
        var mid = latlngs[Math.floor(latlngs.length / 2)];
        var dot = root.L.circleMarker(mid, {
          radius: 7,
          color: '#ffffff',
          weight: 2,
          fillColor: circuitColor(circuit.color),
          fillOpacity: 0.95
        });
        dot.bindTooltip((circuit.color || 'Circuit') + ' · ' + area.name, { direction: 'top' });
        dot.on('click', function (event) {
          stop(event);
          map.setView(mid, Math.max(map.getZoom(), 16));
        });
        add(map, line);
        add(map, dot);
      });
    });
  }

  function drawProblems(map, areas) {
    var bounds = map.getBounds();
    areas.forEach(function (area) {
      var data = areaCache[area.id];
      if (!data) {
        loadArea(area);
        return;
      }
      (data.circuits || []).forEach(function (circuit) {
        if (!circuit.line || circuit.line.length < 2) return;
        var line = root.L.polyline(circuit.line.map(function (pair) { return [pair[1], pair[0]]; }), {
          color: circuitColor(circuit.color), weight: 2, opacity: 0.55
        });
        add(map, line);
      });
      (data.problems || []).forEach(function (row) {
        if (gradeActive() && !inGrade(row[2])) return;
        var saved = savedProblem(row[0]);
        if (!passesPersonal(saved.planned, saved.done)) return;
        if (!bounds.contains([row[3], row[4]])) return;
        var problem = {
          id: row[0], name: row[1], grade: row[2], lat: row[3], lng: row[4],
          circuitNumber: row[6] || '', circuitColor: row[7] || '', area: data.name
        };
        var dot = root.L.circleMarker([row[3], row[4]], {
          radius: 6, color: '#ffffff', weight: 1.5,
          fillColor: gradeColor(problem.grade), fillOpacity: 0.95
        });
        dot.on('click', function (event) {
          stop(event);
          if (typeof root.showClimbProblem === 'function') root.showClimbProblem(problem);
        });
        add(map, dot);
      });
    });
  }

  function drawClimbing(map) {
    if (!boulderOn()) return;
    if (!searchDoc) {
      ensureSearch();
      return;
    }
    var areas = areasInBounds(map.getBounds());
    var zoom = map.getZoom();
    if (zoom < 13) drawAreas(map, areas);
    else if (zoom < 16) drawCircuits(map, areas);
    else drawProblems(map, areas);
  }

  function drawHiking(map) {
    if (!layerOn('hiking')) return;
    if (!treks) {
      ensureTreks();
      return;
    }
    (treks.treks || []).forEach(function (trek) {
      var on = highlightTrek && highlightTrek === trek.id;
      (trek.lines || []).forEach(function (line) {
        var path = root.L.polyline(line.map(function (pair) { return [pair[1], pair[0]]; }), {
          color: on ? '#145232' : '#1f6b45',
          weight: on ? 7 : 4,
          opacity: 0.95
        });
        path.on('click', function (event) {
          stop(event);
          highlightTrek = trek.id;
          if (typeof root.showTrekLine === 'function') root.showTrekLine(trek);
          draw(map);
        });
        add(map, path);
      });
      (trek.huts || []).forEach(function (hut) {
        var dot = root.L.circleMarker([hut.lat, hut.lng], {
          radius: 5, color: '#1f6b45', weight: 2, fillColor: '#f7f4ef', fillOpacity: 1
        });
        dot.bindTooltip(hut.name, { direction: 'top', opacity: 0.9 });
        dot.on('click', function (event) {
          stop(event);
          if (typeof root.showHutStop === 'function') root.showHutStop(hut, trek);
        });
        add(map, dot);
      });
    });
  }

  function draw(map) {
    if (!map || !root.L) return;
    clearDrawn(map);
    drawHiking(map);
    drawClimbing(map);
    if (typeof root.renderExploreSheet === 'function') root.renderExploreSheet();
  }

  function areaById(id) {
    var found = null;
    ((searchDoc && searchDoc.areas) || []).forEach(function (area) {
      if (area.id === id) found = area;
    });
    return found;
  }

  function search(query) {
    var fold = root.SummitPartners && SummitPartners.fold;
    var scoreText = root.SummitPartners && SummitPartners.scoreText;
    if (!fold || !query) return [];
    var q = fold(query);
    if (q.length < 2) return [];
    function consider(list, name, type, extra) {
      var score = scoreText ? scoreText(q, name) : (fold(name).indexOf(q) >= 0 ? 600 : 0);
      if (!score) return;
      var bucket = score >= 1000 ? 3 : score >= 700 ? 2 : 1;
      list.push(Object.assign({ type: type, name: name, bucket: bucket, score: score }, extra));
    }
    var hits = [];
    if (!searchDoc) {
      ensureSearch(function () { if (typeof root.renderMapSuggestions === 'function') root.renderMapSuggestions(); });
    }
    ((searchDoc && searchDoc.areas) || []).forEach(function (area) {
      consider(hits, area.name, 'area', { id: area.id, lat: area.lat, lng: area.lng, area: area });
    });
    ((searchDoc && searchDoc.circuits) || []).forEach(function (row) {
      var area = areaById(row[1]);
      var label = (row[2] || 'Circuit');
      consider(hits, label + ' circuit', 'circuit', {
        id: row[0], areaId: row[1], areaName: area ? area.name : '', lat: row[3], lng: row[4], color: row[2]
      });
    });
    ((searchDoc && searchDoc.problems) || []).forEach(function (row) {
      var area = areaById(row[2]);
      consider(hits, row[0], 'problem', {
        id: row[5], grade: row[1], areaId: row[2], areaName: area ? area.name : '', lat: row[3], lng: row[4]
      });
    });
    ((treks && treks.treks) || []).forEach(function (trek) {
      consider(hits, trek.name, 'trek', { id: trek.id, trek: trek });
    });
    if (!treks) ensureTreks(function () { if (typeof root.renderMapSuggestions === 'function') root.renderMapSuggestions(); });
    ((treks && treks.treks) || []).forEach(function (trek) {
      (trek.huts || []).forEach(function (hut) {
        consider(hits, hut.name, 'hut', { id: hut.id, lat: hut.lat, lng: hut.lng, trek: trek, hut: hut });
      });
    });
    var order = { peak: 0, area: 1, trek: 2, hut: 3, circuit: 4, problem: 5 };
    hits.sort(function (a, b) {
      if (b.bucket !== a.bucket) return b.bucket - a.bucket;
      if ((order[a.type] || 9) !== (order[b.type] || 9)) return (order[a.type] || 9) - (order[b.type] || 9);
      return String(a.name).localeCompare(String(b.name));
    });
    return hits.slice(0, 20);
  }

  function discover(map) {
    if (!map) return [];
    if (emptyClimbKind()) return [];
    var bounds = map.getBounds();
    var rows = [];
    if (boulderOn() && searchDoc) {
      var zoom = map.getZoom();
      areasInBounds(bounds).forEach(function (area) {
        rows.push({
          type: 'area',
          name: area.name,
          meta: area.graded ? 'Climbing area' : 'No grade data',
          lat: area.lat,
          lng: area.lng,
          area: area
        });
      });
      if (zoom >= 16) {
        areasInBounds(bounds).forEach(function (area) {
          var data = areaCache[area.id];
          if (!data) return;
          (data.problems || []).forEach(function (row) {
            if (!bounds.contains([row[3], row[4]])) return;
            if (gradeActive() && !inGrade(row[2])) return;
            rows.push({
              type: 'problem',
              name: row[1],
              meta: [row[2], area.name].filter(Boolean).join(' · '),
              lat: row[3],
              lng: row[4],
              problem: {
                id: row[0], name: row[1], grade: row[2], lat: row[3], lng: row[4],
                circuitNumber: row[6] || '', circuitColor: row[7] || '', area: area.name
              }
            });
          });
        });
      }
    }
    if (layerOn('hiking') && treks) {
      (treks.treks || []).forEach(function (trek) {
        var pts = [];
        (trek.lines || []).forEach(function (line) { line.forEach(function (pair) { pts.push(pair); }); });
        var inside = pts.some(function (pair) { return bounds.contains([pair[1], pair[0]]); });
        if (inside) rows.push({ type: 'trek', name: trek.name, meta: 'Trek', trek: trek });
        (trek.huts || []).forEach(function (hut) {
          if (!bounds.contains([hut.lat, hut.lng])) return;
          rows.push({ type: 'hut', name: hut.name, meta: 'Hut · ' + trek.name, lat: hut.lat, lng: hut.lng, hut: hut, trek: trek });
        });
      });
    }
    return rows.slice(0, 40);
  }

  function flyTo(hit) {
    var map = root.map;
    if (!map || !root.L || !hit) return;
    if (hit.type === 'area' && hit.area) {
      map.fitBounds([[hit.area.s, hit.area.w], [hit.area.n, hit.area.e]], { maxZoom: 15, padding: [28, 88] });
      return;
    }
    if (hit.type === 'trek' && hit.trek) {
      highlightTrek = hit.trek.id;
      var pts = [];
      (hit.trek.lines || []).forEach(function (line) { line.forEach(function (pair) { pts.push([pair[1], pair[0]]); }); });
      if (pts.length) map.fitBounds(root.L.latLngBounds(pts).pad(0.2), { maxZoom: 11 });
      draw(map);
      return;
    }
    if (hit.lat != null && hit.lng != null) {
      map.setView([hit.lat, hit.lng], hit.type === 'problem' || hit.type === 'circuit' ? 16 : Math.max(map.getZoom(), 12));
    }
  }

  root.SummitLayers = {
    on: layerOn,
    activity: function () { return activity; },
    climbKind: function () { return climbKind; },
    setActivity: setActivity,
    setClimbKind: setClimbKind,
    setGrade: setGrade,
    grade: function () { return { min: gradeMin, max: gradeMax }; },
    setPersonal: setPersonal,
    personal: function () { return { planned: personal.planned, done: personal.done }; },
    grades: function () { return ORDER.slice(); },
    emptyClimbKind: emptyClimbKind,
    search: search,
    discover: discover,
    flyTo: flyTo,
    draw: draw
  };
})(window);
