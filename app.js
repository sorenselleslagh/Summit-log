// SummitLog — working prototype

let logs = JSON.parse(localStorage.getItem('summitlogs') || '[]');
let partnerPosts = JSON.parse(localStorage.getItem('partnerposts') || '[]');
let map;
let markers = [];

const sampleLogs = [
  { id: 1, name: "Mont Blanc", type: "Alpine / Mountaineering", date: "2025-08-12", elevation: 3808, notes: "Via Goûter route. Clear weather, crowded upper section.", lat: 45.8326, lng: 6.8652 },
  { id: 2, name: "Matterhorn (Hörnli)", type: "Alpine / Mountaineering", date: "2025-07-03", elevation: 4478, notes: "Hörnli ridge. Early start, good conditions.", lat: 45.9763, lng: 7.6586 },
  { id: 3, name: "Local sport session", type: "Sport / Trad climbing", date: "2026-10-15", elevation: 0, notes: "6b flash, 6c redpoint attempt.", lat: 46.0, lng: 7.5 }
];

if (logs.length === 0) {
  logs = sampleLogs;
  saveLogs();
}

function saveLogs() { localStorage.setItem('summitlogs', JSON.stringify(logs)); }
function savePosts() { localStorage.setItem('partnerposts', JSON.stringify(partnerPosts)); }

function uid() { return Date.now() + Math.random().toString(36).slice(2, 7); }

// Tabs
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab').forEach(s => s.classList.add('hidden'));
    document.getElementById(btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'map' && map) setTimeout(() => map.invalidateSize(), 100);
  });
});

// Render logs
function renderLogs() {
  const list = document.getElementById('log-list');
  list.innerHTML = logs.length ? '' : '<p style="color:var(--muted)">No entries yet.</p>';

  logs.slice().reverse().forEach(log => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <h3>${log.name}</h3>
      <span class="badge">${log.type}</span>
      <p style="margin-top:0.4rem; color:var(--muted); font-size:0.9rem;">${log.date || 'No date'} · ${log.elevation || 0} m</p>
      ${log.notes ? `<p style="margin-top:0.4rem;">${log.notes}</p>` : ''}
      <div class="log-actions">
        <button class="secondary" onclick="editLog('${log.id}')">Edit</button>
        <button class="danger" onclick="deleteLog('${log.id}')">Delete</button>
      </div>
    `;
    list.appendChild(div);
  });

  document.getElementById('peak-count').textContent = logs.length;
  document.getElementById('elev-total').textContent = logs.reduce((s, l) => s + (parseInt(l.elevation) || 0), 0);
  document.getElementById('trip-count').textContent = logs.length;

  const resume = document.getElementById('resume-summary');
  if (logs.length) {
    const recent = logs.slice(-5).reverse().map(l => `<li>${l.name} — ${l.type}</li>`).join('');
    resume.innerHTML = `<p>Recent activity:</p><ul style="margin:0.5rem 0 0 1.2rem;">${recent}</ul>`;
  } else {
    resume.innerHTML = '<p>No activity logged yet.</p>';
  }

  updateMapMarkers();
}

// Form handling
const form = document.getElementById('add-form');
let editingId = null;

document.getElementById('add-btn').addEventListener('click', () => {
  editingId = null;
  form.classList.toggle('hidden');
  document.getElementById('form-title').textContent = 'New entry';
  document.getElementById('name').value = '';
  document.getElementById('notes').value = '';
  document.getElementById('elevation').value = '';
  document.getElementById('date').value = new Date().toISOString().slice(0, 10);
});

document.getElementById('save-btn').addEventListener('click', () => {
  const name = document.getElementById('name').value.trim();
  if (!name) return alert('Name is required');

  const entry = {
    id: editingId || uid(),
    name,
    type: document.getElementById('type').value,
    date: document.getElementById('date').value,
    elevation: document.getElementById('elevation').value,
    notes: document.getElementById('notes').value.trim(),
    lat: parseFloat(document.getElementById('lat').value) || null,
    lng: parseFloat(document.getElementById('lng').value) || null
  };

  if (editingId) {
    const idx = logs.findIndex(l => l.id == editingId);
    if (idx >= 0) logs[idx] = entry;
  } else {
    logs.push(entry);
  }

  saveLogs();
  form.classList.add('hidden');
  editingId = null;
  renderLogs();
});

window.editLog = function(id) {
  const log = logs.find(l => l.id == id);
  if (!log) return;
  editingId = id;
  document.getElementById('form-title').textContent = 'Edit entry';
  document.getElementById('name').value = log.name;
  document.getElementById('type').value = log.type;
  document.getElementById('date').value = log.date || '';
  document.getElementById('elevation').value = log.elevation || '';
  document.getElementById('notes').value = log.notes || '';
  document.getElementById('lat').value = log.lat || '';
  document.getElementById('lng').value = log.lng || '';
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth' });
};

window.deleteLog = function(id) {
  if (!confirm('Delete this entry?')) return;
  logs = logs.filter(l => l.id != id);
  saveLogs();
  renderLogs();
};

// Map
function initMap() {
  map = L.map('map-container').setView([46.5, 8.5], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  updateMapMarkers();
}

function updateMapMarkers() {
  if (!map) return;
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  logs.forEach(log => {
    if (log.lat && log.lng) {
      const marker = L.marker([log.lat, log.lng]).addTo(map);
      marker.bindPopup(`<b>${log.name}</b><br>${log.type}<br>${log.date || ''}`);
      markers.push(marker);
    }
  });
}

// Partner posts
function renderPosts() {
  const container = document.getElementById('partner-posts');
  container.innerHTML = partnerPosts.length ? '' : '<p style="color:var(--muted)">No partner posts yet.</p>';

  partnerPosts.slice().reverse().forEach(p => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <h3>${p.objective}</h3>
      <p style="color:var(--muted); font-size:0.9rem;">${p.dates}</p>
      <p style="margin:0.5rem 0;">Looking for: ${p.looking}</p>
      <p style="font-size:0.9rem; color:#93c5fd;">Shared context: ${p.shared || 'No log summary attached'}</p>
      <button class="danger" style="margin-top:0.5rem;" onclick="deletePost('${p.id}')">Remove</button>
    `;
    container.appendChild(div);
  });
}

document.getElementById('post-btn').addEventListener('click', () => {
  document.getElementById('post-form').classList.toggle('hidden');
});

document.getElementById('save-post-btn').addEventListener('click', () => {
  const objective = document.getElementById('post-objective').value.trim();
  if (!objective) return alert('Objective required');

  const recent = logs.slice(-3).map(l => l.name).join(', ') || 'No recent logs';
  partnerPosts.push({
    id: uid(),
    objective,
    dates: document.getElementById('post-dates').value.trim() || 'Flexible',
    looking: document.getElementById('post-looking').value.trim(),
    shared: `Recent: ${recent}`
  });
  savePosts();
  document.getElementById('post-form').classList.add('hidden');
  document.getElementById('post-objective').value = '';
  document.getElementById('post-looking').value = '';
  renderPosts();
});

window.deletePost = function(id) {
  partnerPosts = partnerPosts.filter(p => p.id != id);
  savePosts();
  renderPosts();
};

// Export / Import
document.getElementById('export-btn').addEventListener('click', () => {
  const data = { logs, partnerPosts, exported: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'summitlog-export.json';
  a.click();
});

document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.logs) logs = data.logs;
      if (data.partnerPosts) partnerPosts = data.partnerPosts;
      saveLogs();
      savePosts();
      renderLogs();
      renderPosts();
      alert('Import successful');
    } catch (err) {
      alert('Invalid file');
    }
  };
  reader.readAsText(file);
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  renderLogs();
  renderPosts();
});
