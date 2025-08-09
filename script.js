// ---------- Supabase ----------
const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON);

// ---------- UI refs ----------
const addPointBtn = document.getElementById('addPointBtn');
const formPanel   = document.getElementById('formPanel');
const coordInput  = document.getElementById('coord');
const roadSide    = document.getElementById('roadSide');
const details     = document.getElementById('details');
const intensity   = document.getElementById('intensity');
const intensityOut= document.getElementById('intensityOut');
const savePinBtn  = document.getElementById('savePin');
const cancelPinBtn= document.getElementById('cancelPin');
const searchInput = document.getElementById('searchInput');

// ---------- Safety notice ----------
const notice = document.getElementById('notice');
const noticeClose = document.getElementById('noticeClose');
if (!localStorage.getItem('joora_notice_dismissed')) notice?.classList.remove('hidden');
noticeClose?.addEventListener('click', () => {
  notice.classList.add('hidden');
  localStorage.setItem('joora_notice_dismissed', '1');
});

let map, draftMarker = null, addingPoint = false, isSaving = false;
let infoWindow; // one reusable info window

// ---------- Camera restriction (simple box) ----------
const LEB_BOUNDS = { north: 34.70, south: 33.05, west: 35.10, east: 36.65 };

// ---------- Lebanon land polygon (simplified) ----------
const LEB_POLY = [
  {lat:34.691, lng:35.493},
  {lat:34.614, lng:35.786},
  {lat:34.439, lng:35.905},
  {lat:34.125, lng:36.623},
  {lat:33.899, lng:36.611},
  {lat:33.643, lng:36.222},
  {lat:33.277, lng:35.938},
  {lat:33.090, lng:35.127},
  {lat:33.277, lng:35.093},
  {lat:33.823, lng:35.101},
  {lat:34.316, lng:35.126},
  {lat:34.691, lng:35.493}, // close loop
];

// ---------- Point-in-polygon (ray casting) ----------
function isInsideLebanonLand(lat, lng) {
  let inside = false;
  for (let i = 0, j = LEB_POLY.length - 1; i < LEB_POLY.length; j = i++) {
    const xi = LEB_POLY[i].lat, yi = LEB_POLY[i].lng;
    const xj = LEB_POLY[j].lat, yj = LEB_POLY[j].lng;
    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---------- Init Map + Places ----------
window.initMap = async () => {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 33.8938, lng: 35.5194 }, // Sassine
    zoom: 16,
    restriction: { latLngBounds: LEB_BOUNDS, strictBounds: true }, // box to keep camera nearby
    streetViewControl: false,
    fullscreenControl: false,
    mapTypeControl: false,
    rotateControl: false,
    scaleControl: false,
    keyboardShortcuts: false,
    clickableIcons: false,
    gestureHandling: 'greedy'
  });

  infoWindow = new google.maps.InfoWindow();

// Bounds object for biasing the autocomplete
const LEB_BOUNDS_G = new google.maps.LatLngBounds(
  new google.maps.LatLng(33.05, 35.10), // SW
  new google.maps.LatLng(34.70, 36.65)  // NE
);

if (searchInput) {
  // Create a session token (recommended billing model for Autocomplete)
  let sessionToken = new google.maps.places.AutocompleteSessionToken();

  const ac = new google.maps.places.Autocomplete(searchInput, {
    // Don't over-filter: let Google return streets, areas, etc.
    // If you *only* want addresses, you could add: types: ['address']
    fields: ['geometry', 'name', 'formatted_address', 'place_id'],
    componentRestrictions: { country: ['lb'] }
  });

  // Bias to Lebanon box and keep predictions near it
  ac.setBounds(LEB_BOUNDS_G);
  ac.setOptions({ strictBounds: true });

  // Attach the session token
  ac.setOptions({ sessionToken });

  ac.addListener('place_changed', () => {
    const place = ac.getPlace();
    if (!place?.geometry) return;

    // Preferred: if Google gives a viewport (great for areas/streets), fit to it
    if (place.geometry.viewport) {
      map.fitBounds(place.geometry.viewport);
      // Optional: cap max zoom so it stays "general"
      if (map.getZoom() > 17) map.setZoom(17);
    } else if (place.geometry.location) {
      // Fallback: center at point with a reasonable zoom
      map.setCenter(place.geometry.location);
      map.setZoom(16);
    }

    // Start a new billing session after a selection (best practice)
    sessionToken = new google.maps.places.AutocompleteSessionToken();
    ac.setOptions({ sessionToken });
  });
}


  // Click to place/move the draft marker (validated by polygon)
  map.addListener('click', (e) => {
    if (!addingPoint) return;

    const lat = e.latLng.lat();
    const lng = e.latLng.lng();

    if (!isInsideLebanonLand(lat, lng)) {
      alert('Please place pins on land inside Lebanon 🇱🇧');
      return;
    }

    if (draftMarker) draftMarker.setMap(null);
    draftMarker = new google.maps.Marker({ position: e.latLng, map });

    // Fill form
    coordInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    roadSide.value = 'Middle';
    details.value = '';
    intensity.value = '3';
    intensityOut.textContent = '3';
    formPanel.classList.remove('hidden');
  });

  // Load existing pins from Supabase
  const { data, error } = await supabase
    .from('pins')
    .select('*')
    .order('created_at', { ascending: false });

  if (!error && data) data.forEach(addMarkerFromDB);
};

// ---------- Markers from DB ----------
function addMarkerFromDB(row) {
  // Skip anything outside land polygon (keeps map clean if old data slips in)
  if (!isInsideLebanonLand(row.lat, row.lng)) return;

  const pos = { lat: row.lat, lng: row.lng };
  const marker = new google.maps.Marker({ position: pos, map });
  marker.customData = {
    roadSide: row.roadside || 'Middle',
    details : row.details  || '',
    intensity: row.intensity ?? 3,
    coords: pos,
    createdAt: row.created_at
  };

  marker.addListener('click', () => {
    infoWindow.setContent(renderPopup(marker.customData));
    infoWindow.open({ map, anchor: marker });
  });
}

// ---------- Popup HTML ----------
function renderPopup(d) {
  const stars = '★'.repeat(d.intensity) + '☆'.repeat(5 - d.intensity);
  return `
    <div>
      <strong>Pothole</strong><br/>
      <em>${d.roadSide}</em> side of the road<br/>
      Intensity: ${stars} (${d.intensity}/5)<br/>
      ${d.details ? `<div style="margin-top:6px">${escapeHtml(d.details)}</div>` : ''}
      <div style="margin-top:6px;color:#666;font-size:12px">
        ${Number(d.coords.lat).toFixed(5)}, ${Number(d.coords.lng).toFixed(5)}
      </div>
    </div>
  `;
}
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ---------- UI actions ----------
addPointBtn.addEventListener('click', () => {
  const ok = confirm("Safety first: don't place pins while driving.\n\nContinue?");
  if (!ok) return;

  addingPoint = true;
  addPointBtn.disabled = true;
  addPointBtn.textContent = 'Click Map';
  addPointBtn.style.backgroundColor = '#28a745';
});

intensity.addEventListener('input', () => {
  intensityOut.textContent = intensity.value;
});

cancelPinBtn.addEventListener('click', () => {
  if (draftMarker) { draftMarker.setMap(null); draftMarker = null; }
  addingPoint = false;
  formPanel.classList.add('hidden');
  addPointBtn.disabled = false;
  addPointBtn.textContent = '+';
  addPointBtn.style.backgroundColor = '#007bff';
});

savePinBtn.addEventListener('click', async () => {
  if (!draftMarker || isSaving) return;

  const ll = draftMarker.getPosition();
  const lat = ll.lat();
  const lng = ll.lng();

  // land-only check on save
  if (!isInsideLebanonLand(lat, lng)) {
    alert('This pin is outside Lebanon’s land area and cannot be saved.');
    return;
  }

  isSaving = true;
  savePinBtn.disabled = true;
  savePinBtn.textContent = 'Saving…';

  const pin = {
    lat, lng,
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
    console.error('Save error:', error);
    alert('Could not save pin. Please try again.');
  } else {
    // Convert draft → permanent marker with popup
    draftMarker.customData = {
      roadSide: inserted.roadside,
      details : inserted.details,
      intensity: inserted.intensity,
      coords: { lat: inserted.lat, lng: inserted.lng },
      createdAt: inserted.created_at
    };
    draftMarker.addListener('click', () => {
      infoWindow.setContent(renderPopup(draftMarker.customData));
      infoWindow.open({ map, anchor: draftMarker });
    });
  }

  // reset UI
  formPanel.classList.add('hidden');
  addingPoint = false;
  addPointBtn.disabled = false;
  addPointBtn.textContent = '+';
  addPointBtn.style.backgroundColor = '#007bff';
  draftMarker = null;

  isSaving = false;
  savePinBtn.disabled = false;
  savePinBtn.textContent = 'Save';
});
