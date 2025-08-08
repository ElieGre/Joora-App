// --- Supabase client ---
const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON);

// --- Leaflet map (Sassine Square) ---
const map = L.map('map').setView([33.8938, 35.5194], 16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
}).addTo(map);

// --- State ---
let addingPoint = false;
let draftMarker = null;

// --- UI refs ---
const addPointBtn   = document.getElementById('addPointBtn');
const formPanel     = document.getElementById('formPanel');
const coordInput    = document.getElementById('coord');
const roadSide      = document.getElementById('roadSide');
const details       = document.getElementById('details');
const intensity     = document.getElementById('intensity');
const intensityOut  = document.getElementById('intensityOut');
const savePinBtn    = document.getElementById('savePin');
const cancelPinBtn  = document.getElementById('cancelPin');

// Guard for missing elements
[addPointBtn, formPanel, coordInput, roadSide, details, intensity, intensityOut, savePinBtn, cancelPinBtn]
  .forEach(el => { if (!el) console.error('Missing element in HTML:', el); });

// --- Load existing pins from Supabase on page load ---
(async function loadPins() {
  const { data, error } = await supabase
    .from('pins')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading pins:', error);
    return;
  }

  data.forEach(row => addPinToMapFromDB(row));
})();

function addPinToMapFromDB(row) {
  const m = L.marker([row.lat, row.lng]).addTo(map);
  m.metadata = {
    coords: { lat: row.lat, lng: row.lng },
    roadSide: row.roadside || 'Middle',
    details: row.details || '',
    intensity: row.intensity ?? 3,
    createdAt: row.created_at
  };
  m.bindPopup(renderPopup(m.metadata));
}

// --- Add mode ---
addPointBtn.addEventListener('click', () => {
  addingPoint = true;
  addPointBtn.disabled = true;
  addPointBtn.textContent = "Click Map";
  addPointBtn.style.backgroundColor = "#28a745";
});

// Click map -> place draft + open panel
map.on('click', (e) => {
  if (!addingPoint) return;
  if (draftMarker) map.removeLayer(draftMarker);

  draftMarker = L.marker(e.latlng).addTo(map);

  const { lat, lng } = e.latlng;
  coordInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  roadSide.value = "Middle";
  details.value = "";
  intensity.value = "3";
  intensityOut.textContent = "3";

  formPanel.classList.remove('hidden');
});

// Keep intensity number synced
intensity.addEventListener('input', () => {
  intensityOut.textContent = intensity.value;
});

// Save -> insert into Supabase, bind popup, reset UI
savePinBtn.addEventListener('click', async () => {
  if (!draftMarker) return;

  const latlng = draftMarker.getLatLng();
  const pin = {
    lat: latlng.lat,
    lng: latlng.lng,
    roadside: roadSide.value,
    details: details.value.trim(),
    intensity: Number(intensity.value)
  };

  const { data: inserted, error } = await supabase
    .from('pins')
    .insert(pin)
    .select()
    .single();

  if (error) {
    console.error('Error saving pin:', error);
    alert('Could not save pin. Please try again.');
    return;
  }

  // Attach data to the actual marker and show popup
  draftMarker.metadata = {
    coords: { lat: inserted.lat, lng: inserted.lng },
    roadSide: inserted.roadside,
    details: inserted.details,
    intensity: inserted.intensity,
    createdAt: inserted.created_at
  };
  draftMarker.bindPopup(renderPopup(draftMarker.metadata));

  // Reset UI state
  formPanel.classList.add('hidden');
  addingPoint = false;
  addPointBtn.disabled = false;
  addPointBtn.textContent = "+";
  addPointBtn.style.backgroundColor = "#007bff";
  draftMarker = null;
});

// Cancel -> discard draft
cancelPinBtn.addEventListener('click', () => {
  if (draftMarker) { map.removeLayer(draftMarker); draftMarker = null; }
  formPanel.classList.add('hidden');
  addingPoint = false;
  addPointBtn.disabled = false;
  addPointBtn.textContent = "+";
  addPointBtn.style.backgroundColor = "#007bff";
});

// --- Helpers ---
function renderPopup(data) {
  return `
    <div>
      <strong>Pothole</strong><br/>
      <em>${data.roadSide}</em> side of the road<br/>
      Intensity: ${"★".repeat(data.intensity)}${"☆".repeat(5 - data.intensity)} (${data.intensity}/5)<br/>
      ${data.details ? `<div style="margin-top:6px">${escapeHtml(data.details)}</div>` : ""}
      <div style="margin-top:6px;color:#666;font-size:12px">
        ${Number(data.coords.lat).toFixed(5)}, ${Number(data.coords.lng).toFixed(5)}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ---- Area search (general, not precise) using Nominatim ----
const searchInput   = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

const ALLOWED_TYPES = new Set([
  'country','state','region','province','county','district',
  'city','town','municipality','suburb','quarter','neighbourhood','neighborhood','village'
]);

// Simple debounce to avoid spamming the API
function debounce(fn, ms = 350) {
  let t; 
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function geocode(query) {
  if (!query || query.trim().length < 2) return [];
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('q', query);
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '8');
  // OPTIONAL: bias to Lebanon if you want
  // url.searchParams.set('countrycodes', 'lb');

  const resp = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' }
    // Browser will send Referer automatically; be gentle with usage.
  });
  if (!resp.ok) return [];
  let items = await resp.json();

  // Keep only general areas
  items = items.filter(it => {
    const type = (it.type || it.category || '').toLowerCase();
    return ALLOWED_TYPES.has(type);
  });

  return items;
}

function showResults(items) {
  if (!items.length) {
    searchResults.classList.add('hidden');
    searchResults.innerHTML = '';
    return;
  }
  searchResults.innerHTML = items.map((it, idx) => `
    <li data-idx="${idx}">
      ${escapeHtml(it.display_name)}
    </li>
  `).join('');
  searchResults.classList.remove('hidden');

  // Click -> fit map to bounding box (general area)
  Array.from(searchResults.querySelectorAll('li')).forEach(li => {
    li.addEventListener('click', () => {
      const i = Number(li.getAttribute('data-idx'));
      const sel = items[i];
      // Prefer bounding box for "general area" fit
      if (sel && sel.boundingbox) {
        const [south, north, west, east] = sel.boundingbox.map(Number);
        const bounds = L.latLngBounds([south, west], [north, east]);
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 }); // cap zoom so it’s not too precise
      } else if (sel && sel.lat && sel.lon) {
        map.setView([Number(sel.lat), Number(sel.lon)], 13);
      }
      searchResults.classList.add('hidden');
      searchInput.blur();
    });
  });
}

// Wire input with debounce
const handleSearch = debounce(async () => {
  const q = searchInput.value.trim();
  if (!q) { searchResults.classList.add('hidden'); searchResults.innerHTML=''; return; }
  try {
    const res = await geocode(q);
    showResults(res);
  } catch (err) {
    console.error('Search error:', err);
    searchResults.classList.add('hidden');
  }
}, 400);

searchInput.addEventListener('input', handleSearch);

// Hide results when clicking outside
document.addEventListener('click', (e) => {
  if (!searchBarContains(e.target)) {
    searchResults.classList.add('hidden');
  }
});
function searchBarContains(node) {
  return node === searchInput || node === searchResults || searchResults.contains(node) || searchInput.contains?.(node);
}
