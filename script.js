// --- Supabase client ---
const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON);

// --- Leaflet map (Sassine Square) ---
const map = L.map('map').setView([33.8938, 35.5194], 16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
}).addTo(map);

// ---------- Lebanon bounds ----------
const LEB_BOUNDS = L.latLngBounds([33.05, 35.10], [34.70, 36.65]);
// Keep panning roughly inside Lebanon
map.setMaxBounds(LEB_BOUNDS.pad(0.05));

// --- State ---
let addingPoint = false;
let draftMarker = null;
let isSaving = false; // guard to prevent double inserts

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

// Search UI
const searchInput   = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

// Guard for missing elements (logs if anything is off)
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
  const latlng = L.latLng(row.lat, row.lng);
  // Skip any bad/out-of-bounds data
  if (!LEB_BOUNDS.contains(latlng)) return;

  const m = L.marker(latlng).addTo(map);
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
  // Friendly nudge before entering add mode
  const ok = confirm("Safety first: don't place pins while driving.\n\nContinue?");
  if (!ok) return;

  addingPoint = true;
  addPointBtn.disabled = true;
  addPointBtn.textContent = "Click Map";
  addPointBtn.style.backgroundColor = "#28a745";
});

// Click map -> place draft + open panel
map.on('click', (e) => {
  if (!addingPoint) return;

  // block clicks outside Lebanon
  if (!LEB_BOUNDS.contains(e.latlng)) {
    alert('Please place pins inside Lebanon 🇱🇧');
    return;
  }

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
  if (!draftMarker || isSaving) return;

  // Double-check bounds on save
  const latlng = draftMarker.getLatLng();
  if (!LEB_BOUNDS.contains(latlng)) {
    alert('This pin is outside Lebanon and cannot be saved.');
    return;
  }

  isSaving = true;
  savePinBtn.disabled = true;
  savePinBtn.textContent = 'Saving…';

  const pin = {
    lat: latlng.lat,
    lng: latlng.lng,
    roadside: roadSide.value,
    details: details.value.trim(),
    intensity: Number(intensity.value)
  };

  // Notice bar show/hide (remember dismissal)
const notice = document.getElementById('notice');
const noticeClose = document.getElementById('noticeClose');

if (!localStorage.getItem('joora_notice_dismissed')) {
  notice?.classList.remove('hidden');
}
noticeClose?.addEventListener('click', () => {
  notice.classList.add('hidden');
  localStorage.setItem('joora_notice_dismissed', '1');
});


  const { data: inserted, error } = await supabase
    .from('pins')
    .insert(pin)
    .select()
    .single();

  if (error) {
    console.error('Error saving pin:', error);
    alert('Could not save pin. Please try again.');
  } else {
    // Attach data to the actual marker and show popup
    draftMarker.metadata = {
      coords: { lat: inserted.lat, lng: inserted.lng },
      roadSide: inserted.roadside,
      details: inserted.details,
      intensity: inserted.intensity,
      createdAt: inserted.created_at
    };
    draftMarker.bindPopup(renderPopup(draftMarker.metadata));
  }

  // Reset UI state
  formPanel.classList.add('hidden');
  addingPoint = false;
  addPointBtn.disabled = false;
  addPointBtn.textContent = "+";
  addPointBtn.style.backgroundColor = "#007bff";
  draftMarker = null;

  isSaving = false;
  savePinBtn.disabled = false;
  savePinBtn.textContent = 'Save';
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
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/* ---------- OPTIONAL: Realtime (show new pins instantly) ----------
   In Supabase: Database → Replication → Realtime → enable for schema `public` and table `pins`.
   Then uncomment this block.
*/
// const channel = supabase
//   .channel('realtime:pins')
//   .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pins' }, (payload) => {
//     addPinToMapFromDB(payload.new);
//   })
//   .subscribe();


// =================== SEARCH (Lebanon-first with aliases + fallbacks) ===================

const ALLOWED_TYPES = new Set([
  'country','state','region','province','county','district',
  'city','town','municipality','suburb','quarter','neighbourhood','neighborhood','village','hamlet'
]);

// Lebanon bounding box (lon/lat: left, top, right, bottom)
const LEB_VIEWBOX = { left: 35.10, top: 34.70, right: 36.65, bottom: 33.05 };

// normalize the query
function normalizeQuery(q) {
  return String(q)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\s+/g, ' ')
    .trim();
}

// Common transliteration aliases for Lebanon
const LB_ALIASES = new Map(Object.entries({
  // Major cities
  'saida': 'sidon',
  'sidon': 'sidon',
  'sour': 'tyre',
  'tyre': 'tyre',
  'jbeil': 'byblos',
  'byblos': 'byblos',
  'trablous': 'tripoli',
  'tripoli': 'tripoli',
  'zahle': 'zahle',
  'zahleh': 'zahle',
  'baalbak': 'baalbek',
  'baalbeck': 'baalbek',
  'baalbek': 'baalbek',
  'nabatiye': 'nabatieh',
  'nabatiyeh': 'nabatieh',
  'jounieh': 'jounieh',
  'junieh': 'jounieh',
  'batroun': 'batroun',
  'beirut': 'beirut',
  'bayrut': 'beirut',
  // Common Beirut areas
  'achrafieh': 'ashrafieh',
  'ashrafiyeh': 'ashrafieh',
  'hamra': 'hamra beirut',
  'dahieh': 'chiyah',
  'dahiyeh': 'chiyah',
  'jlideh': 'jdaideh',
  'jdaideh': 'jdaideh',
  'baabda': 'baabda',
  'hadath': 'hadath',
}));

function applyLebanonAliases(q) {
  const norm = normalizeQuery(q);
  if (LB_ALIASES.has(norm)) return LB_ALIASES.get(norm);
  // token-by-token replacement (e.g., "saida district" -> "sidon district")
  const tokens = norm.split(' ').map(t => LB_ALIASES.get(t) || t);
  return tokens.join(' ');
}

// debounce to avoid spamming API
function debounce(fn, ms = 400) {
  let t; 
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Core fetcher to Nominatim
async function fetchNominatim(q, { bounded } = { bounded: true }) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('q', q);
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '8');
  url.searchParams.set('countrycodes', 'lb');
  if (bounded) {
    url.searchParams.set('bounded', '1');
    url.searchParams.set('viewbox', `${LEB_VIEWBOX.left},${LEB_VIEWBOX.top},${LEB_VIEWBOX.right},${LEB_VIEWBOX.bottom}`);
  }

  const resp = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json', 'Accept-Language': 'ar,en-LB,en' }
  });
  if (!resp.ok) {
    console.warn('Nominatim HTTP', resp.status);
    return [];
  }
  let items = await resp.json();
  return items;
}

// Final geocode with fallbacks
async function geocode(query) {
  if (!query || query.trim().length < 2) return [];

  const aliased = applyLebanonAliases(query);
  const tries = [
    { q: aliased, bounded: true,  label: 'aliased+bounded' },
    { q: query,   bounded: true,  label: 'original+bounded' },
    { q: aliased, bounded: false, label: 'aliased+unbounded' },
    { q: query,   bounded: false, label: 'original+unbounded' },
  ];

  for (const t of tries) {
    let items = await fetchNominatim(t.q, { bounded: t.bounded });

    // Filter to area-like types first
    let filtered = items.filter(it => ALLOWED_TYPES.has((it.type || it.category || '').toLowerCase()));

    // If filtering killed everything, fall back to unfiltered
    if (filtered.length === 0 && items.length > 0) filtered = items;

    if (filtered.length > 0) {
      console.log('Search success via', t.label, '→', filtered.map(i => i.display_name));
      return filtered;
    }
  }

  console.log('No results for', query);
  return [];
}

function showResults(items) {
  if (!searchResults) return;
  if (!items.length) {
    searchResults.classList.remove('hidden');
    searchResults.innerHTML = `<li style="pointer-events:none;color:#666">No results. Try: Saida/Sidon, Sour/Tyre, Jbeil/Byblos, Trablous/Tripoli…</li>`;
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
      if (sel && sel.boundingbox) {
        const [south, north, west, east] = sel.boundingbox.map(Number);
        const bounds = L.latLngBounds([south, west], [north, east]);
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      } else if (sel && sel.lat && sel.lon) {
        map.setView([Number(sel.lat), Number(sel.lon)], 13);
      }
      searchResults.classList.add('hidden');
      searchInput?.blur();
    });
  });
}

const handleSearch = debounce(async () => {
  if (!searchInput) return;
  const q = searchInput.value.trim();
  if (!q) { searchResults?.classList.add('hidden'); if (searchResults) searchResults.innerHTML=''; return; }
  try {
    const res = await geocode(q);
    showResults(res);
  } catch (err) {
    console.error('Search error:', err);
    searchResults?.classList.add('hidden');
  }
}, 400);

searchInput?.addEventListener('input', handleSearch);

// Hide results when clicking outside
document.addEventListener('click', (e) => {
  if (!searchInput || !searchResults) return;
  const inside = (e.target === searchInput) || (e.target === searchResults) || searchResults.contains(e.target);
  if (!inside) searchResults.classList.add('hidden');
});
