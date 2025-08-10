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
let infoWindow;             // one reusable info window
let boundaryLayer = null;   // non-clickable Data layer for the border

// ---------- Camera restriction (simple box) ----------
const LEB_BOUNDS = { north: 34.70, south: 33.05, west: 35.10, east: 36.65 };

// ---------- Precise Lebanon boundary (GeoJSON via Turf) ----------
let lebFeature = null; // Polygon/MultiPolygon Feature used by Turf

// Colors for 1..5 (tweak to taste)
const INTENSITY_COLORS = {
  1: '#22c55e',
  2: '#a3e635', 
  3: '#facc15',
  4: '#f97316', 
  5: '#ef4444'  
};

// Build a simple SVG circle marker
function svgPin(color) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 1,
    scale: 12,             // size of the circle
    strokeWeight: 3,
    strokeColor: '#fff'
  };
}

function glowingPin(color) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <!-- glow halo -->
      <circle cx="16" cy="16" r="14" fill="${color}" fill-opacity="0.3"/>
      <!-- main pin -->
      <circle cx="16" cy="16" r="10" fill="${color}" stroke="white" stroke-width="3"/>
    </svg>
  `;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(32, 32),
    anchor: new google.maps.Point(16, 16)
  };
}

function iconForIntensity(i) {
  const c = INTENSITY_COLORS[i] || INTENSITY_COLORS[3];
  return glowingPin(c);
}


async function loadLebanonBoundary() {
  const res = await fetch('./geoBoundaries-LBN-ADM0.geojson'); // adjust path if needed
  if (!res.ok) throw new Error('Failed to fetch boundary');
  const gj = await res.json();

  // Extract a single Feature for Turf checks
  lebFeature = (gj.type === 'FeatureCollection') ? gj.features[0]
            : (gj.type === 'Feature') ? gj
            : { type: 'Feature', geometry: gj, properties: {} };

  // Draw on our NON-CLICKABLE layer so map clicks still work
  try {
    boundaryLayer.addGeoJson(gj);
  } catch {
    boundaryLayer.addGeoJson(lebFeature);
  }
  boundaryLayer.setStyle({ fillOpacity: 0, strokeWeight: 2, strokeColor: '#1a73e8' });
}

function isInsideLebanon(lat, lng) {
  if (!lebFeature) return false;
  const pt = turf.point([lng, lat]); // GeoJSON order: [lng, lat]
  return turf.booleanPointInPolygon(pt, lebFeature);
}

// ---------- Init Map + Places ----------
window.initMap = async () => {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 33.8938, lng: 35.5194 },
    zoom: 1,
    restriction: { latLngBounds: LEB_BOUNDS, strictBounds: true },
    streetViewControl: false,
    fullscreenControl: false,
    mapTypeControl: true,
    rotateControl: true,
    scaleControl: false,
    keyboardShortcuts: false,
    clickableIcons: false,
    gestureHandling: 'greedy'
  });

  infoWindow = new google.maps.InfoWindow();

  // Create the NON-CLICKABLE border layer now that map exists
  boundaryLayer = new google.maps.Data({ map, clickable: true });
  boundaryLayer.addListener('click', (e) => {
  google.maps.event.trigger(map, 'click', { latLng: e.latLng });
});

  // ------- Places Autocomplete (biased to Lebanon box) -------
  const LEB_BOUNDS_G = new google.maps.LatLngBounds(
    new google.maps.LatLng(33.05, 35.10), // SW
    new google.maps.LatLng(34.70, 36.65)  // NE
  );

  if (searchInput) {
    let sessionToken = new google.maps.places.AutocompleteSessionToken();

    const ac = new google.maps.places.Autocomplete(searchInput, {
      fields: ['geometry', 'name', 'formatted_address', 'place_id'],
      componentRestrictions: { country: ['lb'] }
    });

    ac.setBounds(LEB_BOUNDS_G);
    ac.setOptions({ strictBounds: true, sessionToken });

    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (!place?.geometry) return;

      if (place.geometry.viewport) {
        map.fitBounds(place.geometry.viewport);
        if (map.getZoom() > 17) map.setZoom(17);
      } else if (place.geometry.location) {
        map.setCenter(place.geometry.location);
        map.setZoom(16);
      }

      // New billing session
      sessionToken = new google.maps.places.AutocompleteSessionToken();
      ac.setOptions({ sessionToken });
    });
  }

  // ------- Load the accurate boundary before enabling placement -------
  try {
    await loadLebanonBoundary();
  } catch (e) {
    console.error(e);
    alert('Could not load Lebanon boundary. Pin placement will be disabled until it loads.');
  }

  // ------- Click to place/move the draft marker (validated by polygon) -------
  map.addListener('click', (e) => {
    if (!addingPoint) return;

    const lat = e.latLng.lat();
    const lng = e.latLng.lng();

    if (!isInsideLebanon(lat, lng)) {
      alert('Please place pins inside Lebanon’s legal border.');
      return;
    }

    if (draftMarker) draftMarker.setMap(null);
    draftMarker = new google.maps.Marker({
    position: e.latLng,
    map,
    icon: iconForIntensity(Number(intensity.value))
    });


    // Fill form
    coordInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    roadSide.value = 'Middle';
    details.value = '';
    intensity.value = '3';
    intensityOut.textContent = '3';
    formPanel.classList.remove('hidden');
  });

  // ------- Load existing pins from Supabase -------
  const { data, error } = await supabase
    .from('pins')
    .select('*')
    .order('created_at', { ascending: false });

  if (!error && data) data.forEach(addMarkerFromDB);
};

// ---------- Markers from DB ----------
function addMarkerFromDB(row) {
  // Skip anything outside precise border
  if (!isInsideLebanon(row.lat, row.lng)) return;

  const pos = { lat: row.lat, lng: row.lng };

  // Set the colored icon on the marker itself
  const marker = new google.maps.Marker({
    position: pos,
    map,
    icon: iconForIntensity(Number(row.intensity ?? 3))
  });

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
  addPointBtn.style.backgroundColor = '#28a745';
});

intensity.addEventListener('input', () => {
  intensityOut.textContent = intensity.value;
  if (draftMarker) {
    draftMarker.setIcon(iconForIntensity(Number(intensity.value)));
  }
});

cancelPinBtn.addEventListener('click', () => {
  if (draftMarker) { draftMarker.setMap(null); draftMarker = null; }
  addingPoint = false;
  formPanel.classList.add('hidden');
  addPointBtn.style.backgroundColor = '#007bff';
});

savePinBtn.addEventListener('click', async () => {
  if (!draftMarker || isSaving) return;

  const ll = draftMarker.getPosition();
  const lat = ll.lat();
  const lng = ll.lng();

  // Strict border check on save
  if (!isInsideLebanon(lat, lng)) {
    alert('This pin is outside Lebanon’s border and cannot be saved.');
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
  addPointBtn.style.backgroundColor = '#007bff';
  draftMarker = null;
  isSaving = false;
  savePinBtn.disabled = false;
  savePinBtn.textContent = 'Save';
});
