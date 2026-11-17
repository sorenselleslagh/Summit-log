// Climbing and hiking layers. Peak pins stay in app.js.
// Climbing data is the Boolder Fontainebleau set (CC BY 4.0), split by area.
// Hiking lines and huts are a simplified OpenStreetMap extract (ODbL).
(function (root) {
  'use strict';

  var state = { climbing: false, mountaineering: true, hiking: false };
  var focusName = '';
  var climbIndex = null;
  var climbLoading = false;
  var areaCache = {};
  var areaLoading = {};
  var treks = null;
  var trekLoading = false;
  var drawn = [];

  var CIRCUIT = {
    yellow: '#d4a017',
    orange: '#e07a1f',
    blue: '#2f6fbf',
    red: '#d64545',
    black: '#241f1a',
    white: '#f7f4ef',
    green: '#2f8f57',
    purple: '#7a4ea3',
    skyblue: '#4aa3c7'
  };

  function on(name) { return !!state[name]; }

  function toggle(name) {
    if (!Object.prototype.hasOwnProperty.call(state, name)) return false;
    state[name] = !state[name];
    return state[name];
  }

  function focus(name) { focusName = name || ''; }

  function clearDrawn(map) {
    drawn.forEach(function (layer) {
      if (map && layer) map.removeLayer(layer);
    });
    drawn = [];
  }

  function stop(event) {
    root.suppressMapClick = true;
    try {
      if (root.L && event && event.originalEvent) root.L.DomEvent.stopPropagation(event);
    } catch (err) { /* A synthetic marker click still opens the card. */ }
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

  function ensureIndex() {
    if (climbIndex || climbLoading) return;
    climbLoading = true;
    fetch('data/climbing/index.json').then(function (response) {
      if (!response.ok) throw new Error('climbing index');
      return response.json();
    }).then(function (data) {
      climbIndex = data;
      climbLoading = false;
      if (state.climbing && root.map) draw(root.map);
    }).catch(function () { climbLoading = false; });
  }

  function ensureTreks() {
    if (treks || trekLoading) return;
    trekLoading = true;
    fetch('data/hikes/treks.json').then(function (response) {
      if (!response.ok) throw new Error('treks');
      return response.json();
    }).then(function (data) {
      treks = data;
      trekLoading = false;
      if (state.hiking && root.map) draw(root.map);
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
      if (state.climbing && root.map && root.map.getZoom() >= 14) draw(root.map);
    }).catch(function () { areaLoading[area.id] = false; });
  }

  function maybeFocus(map) {
    if (focusName !== 'climbing' || !climbIndex || !climbIndex.areas || !climbIndex.areas.length) return;
    var box = root.L.latLngBounds(climbIndex.areas.map(function (area) { return [area.lat, area.lng]; }));
    focusName = '';
    if (map.getBounds().intersects(box)) return;
    root.setTimeout(function () {
      if (map) map.fitBounds(box.pad(0.35), { maxZoom: 11 });
    }, 0);
  }

  function areaHits(map) {
    var bounds = map.getBounds();
    return (climbIndex.areas || []).filter(function (area) {
      return bounds.intersects([[area.s, area.w], [area.n, area.e]]) || bounds.contains([area.lat, area.lng]);
    });
  }

  function drawAreaClusters(map, areas) {
    var zoom = map.getZoom();
    var cell = zoom <= 9 ? 0.2 : 0.06;
    var groups = {};
    areas.forEach(function (area) {
      var key = Math.floor(area.lat / cell) + ':' + Math.floor(area.lng / cell);
      if (!groups[key]) groups[key] = [];
      groups[key].push(area);
    });
    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      if (group.length === 1) {
        var area = group[0];
        var dot = root.L.circleMarker([area.lat, area.lng], {
          radius: 8,
          color: '#ffffff',
          weight: 2,
          fillColor: '#1f6b45',
          fillOpacity: 0.95
        });
        dot.bindTooltip(area.name, { direction: 'top', opacity: 0.9 });
        dot.on('click', function (event) {
          stop(event);
          map.fitBounds([[area.s, area.w], [area.n, area.e]], { maxZoom: 16, padding: [28, 28] });
        });
        add(map, dot);
        return;
      }
      var lat = 0;
      var lng = 0;
      group.forEach(function (area) { lat += area.lat; lng += area.lng; });
      lat /= group.length;
      lng /= group.length;
      var marker = root.L.marker([lat, lng], {
        icon: root.L.divIcon({
          className: 'pin-cluster',
          html: '<span>' + group.length + '</span>',
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        }),
        keyboard: false
      });
      marker.on('click', function (event) {
        stop(event);
        var box = root.L.latLngBounds(group.map(function (area) { return [area.lat, area.lng]; }));
        map.fitBounds(box.pad(0.4), { maxZoom: zoom + 3 });
      });
      add(map, marker);
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
          color: circuitColor(circuit.color),
          weight: 3,
          opacity: 0.8
        });
        add(map, line);
      });
      (data.problems || []).forEach(function (row) {
        var lat = row[3];
        var lng = row[4];
        if (!bounds.contains([lat, lng])) return;
        var problem = {
          id: row[0],
          name: row[1],
          grade: row[2],
          lat: lat,
          lng: lng,
          circuitNumber: row[6] || '',
          circuitColor: row[7] || '',
          area: data.name
        };
        var dot = root.L.circleMarker([lat, lng], {
          radius: 6,
          color: '#ffffff',
          weight: 1.5,
          fillColor: gradeColor(problem.grade),
          fillOpacity: 0.95
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
    if (!state.climbing) return;
    if (!climbIndex) {
      ensureIndex();
      return;
    }
    maybeFocus(map);
    var areas = areaHits(map);
    if (!areas.length && focusName === 'climbing') return;
    if (map.getZoom() < 14) drawAreaClusters(map, areas.length ? areas : []);
    else drawProblems(map, areas);
  }

  function drawHiking(map) {
    if (!state.hiking) return;
    if (!treks) {
      ensureTreks();
      return;
    }
    (treks.treks || []).forEach(function (trek) {
      (trek.lines || []).forEach(function (line) {
        var path = root.L.polyline(line.map(function (pair) { return [pair[1], pair[0]]; }), {
          color: '#1f6b45',
          weight: 4,
          opacity: 0.9
        });
        path.on('click', function (event) {
          stop(event);
          if (typeof root.showTrekLine === 'function') root.showTrekLine(trek);
        });
        add(map, path);
      });
      (trek.huts || []).forEach(function (hut) {
        var dot = root.L.circleMarker([hut.lat, hut.lng], {
          radius: 5,
          color: '#1f6b45',
          weight: 2,
          fillColor: '#f7f4ef',
          fillOpacity: 1
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
  }

  root.SummitLayers = {
    on: on,
    toggle: toggle,
    focus: focus,
    draw: draw
  };
})(window);
