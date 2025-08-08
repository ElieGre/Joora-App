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
