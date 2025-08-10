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

// Screens
const landing = document.getElementById('landing');
const landingContinue = document.getElementById('landingContinue');
const disclaimer = document.getElementById('disclaimer');
const agreeBtn = document.getElementById('agreeBtn');

// Safety notice
const notice = document.getElementById('notice');
const noticeClose = document.getElementById('noticeClose');

// ---------- Session keys ----------
const SESSION = {
  sawDisclaimer: 'joora_saw_disclaimer_session',
  dismissedNotice: 'joora_notice_dismissed_session'
};

// ---------- Timings (ms) ----------
const TIMING = {
  screen: 1200,          // landing/disclaimer show/hide
  swapOverlap: 300,      // overlap for nicer crossfade
  fabDelay: 1200         // delay before FAB floats in (after map starts)
};

// ---------- Map globals ----------
let map, draftMarker = null, addingPoint = false, isSaving = false;
let infoWindow;
let boundaryLayer = null;

// ---------- Bounds ----------
const LEB_BOUNDS = { north: 34.70, south: 33.05, west: 35.10, east: 36.65 };

// ---------- Border & Turf ----------
let lebFeature = null;

// Colors for intensity 1..5
const INTENSITY_COLORS = { 1:'#22c55e', 2:'#a3e635', 3:'#facc15', 4:'#f97316', 5:'#ef4444' };

// Glowing SVG icon
function glowingPin(color, size=36) {
  const rMain = Math.round(size * 0.31);
  const rGlow = Math.round(size * 0.44);
  const cx = Math.round(size/2), cy = cx;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${rGlow}" fill="${color}" fill-opacity="0.3"/>
      <circle cx="${cx}" cy="${cy}" r="${rMain}" fill="${color}" stroke="white" stroke-width="${Math.max(2, size*0.09)}"/>
    </svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(cx, cy)
  };
}
function iconForIntensity(i) {
  const c = INTENSITY_COLORS[i] || INTENSITY_COLORS[3];
  return glowingPin(c, 40); // a bit bigger
}

// ---------- Screens: helpers ----------
function showScreen(el) {
  if (!el) return;
  el.classList.remove('fade-out','hidden');
  el.classList.add('show');
  document.body.classList.add('has-screen');
}
function hideScreen(el, { withFade = true } = {}) {
  if (!el) return;
  if (withFade) {
    el.classList.add('fade-out');
    el.classList.remove('show');
    setTimeout(() => {
      el.classList.add('hidden');
      el.classList.remove('fade-out');
      const anyOpen = !!document.querySelector('.screen.show');
      if (!anyOpen) document.body.classList.remove('has-screen');
    }, TIMING.screen);
  } else {
    el.classList.remove('show');
    el.classList.add('hidden');
    const anyOpen = !!document.querySelector('.screen.show');
    if (!anyOpen) document.body.classList.remove('has-screen');
  }
}
function swapScreens(fromEl, toEl) {
  hideScreen(fromEl, { withFade: true });
  setTimeout(() => showScreen(toEl), TIMING.swapOverlap);
}

// ---------- Safety notice (session-only optional) ----------
if (!sessionStorage.getItem(SESSION.dismissedNotice)) {
  // notice?.classList.remove('hidden');
}
noticeClose?.addEventListener('click', () => {
  notice.classList.add('hidden');
  sessionStorage.setItem(SESSION.dismissedNotice, '1');
});

// ---------- Boot screens ----------
function bootstrapScreens() {
  const agreed = sessionStorage.getItem(SESSION.sawDisclaimer) === '1';
  if (!agreed) {
    showScreen(landing);
    disclaimer.classList.add('hidden');
    document.body.classList.remove('map-live', 'fab-live'); // hide map & fab until agree
  } else {
    landing.classList.add('hidden');
    disclaimer.classList.add('hidden');
    document.body.classList.remove('has-screen');
    document.body.classList.add('map-live');
    setTimeout(() => document.body.classList.add('fab-live'), TIMING.fabDelay);
  }
}
bootstrapScreens();

// Landing → Disclaimer (Continue acts like login)
landingContinue?.addEventListener('click', () => {
  swapScreens(landing, disclaimer); // slow crossfade
});

// Disclaimer → Map
agreeBtn?.addEventListener('click', () => {
  sessionStorage.setItem(SESSION.sawDisclaimer, '1');
  hideScreen(disclaimer, { withFade: true });
  // reveal map (slow fade)
  document.body.classList.add('map-live');
  // float in FAB a bit later
  setTimeout(() => document.body.classList.add('fab-live'), TIMING.fabDelay);
});

// ---------- Load Lebanon boundary ----------
async function loadLebanonBoundary() {
  const res = await fetch('./geoBoundaries-LBN-ADM0.geojson');
  if (!res.ok) throw new Error('Failed to fetch boundary');
  const gj = await res.json();
  lebFeature = (gj.type === 'FeatureCollection') ? gj.features[0]
            : (gj.type === 'Feature') ? gj
            : { type: 'Feature', geometry: gj, properties: {} };

  // Draw on a dedicated data layer
  try { boundaryLayer.addGeoJson(gj); } catch { boundaryLayer.addGeoJson(lebFeature); }
  boundaryLayer.setStyle({ fillOpacity: 0, strokeWeight: 2, strokeColor: '#1a73e8' });
}
function isInsideLebanon(lat, lng) {
  if (!lebFeature) return false;
  const pt = turf.point([lng, lat]);
  return turf.booleanPointInPolygon(pt, lebFeature);
}

// ---------- Init Map + Places ----------
window.initMap = async () => {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 33.8938, lng: 35.5194 },
    zoom: 16,
    restriction: { latLngBounds: LEB_BOUNDS, strictBounds: true },
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

  // Click-through border layer; forward clicks to map handler
  boundaryLayer = new google.maps.Data({ map, clickable: true });
  boundaryLayer.addListener('click', (e) => {
    google.maps.event.trigger(map, 'click', { latLng: e.latLng });
  });

  // Places (legacy Autocomplete OK for existing keys)
  const LEB_BOUNDS_G = new google.maps.LatLngBounds(
    new google.maps.LatLng(33.05, 35.10),
    new google.maps.LatLng(34.70, 36.65)
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
      sessionToken = new google.maps.places.AutocompleteSessionToken();
      ac.setOptions({ sessionToken });
    });
  }

  // Load precise border
  try { await loadLebanonBoundary(); }
  catch (e) { console.error(e); alert('Could not load Lebanon boundary.'); }

  // Map click to place draft marker
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

    coordInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    roadSide.value = 'Middle';
    details.value = '';
    intensity.value = '3';
    intensityOut.textContent = '3';

    formPanel.classList.remove('hidden');
    document.body.classList.add('form-open');
  });

  // Load pins from DB
  const { data, error } = await supabase
    .from('pins').select('*')
    .order('created_at', { ascending: false });
  if (!error && data) data.forEach(addMarkerFromDB);
};

// ---------- DB markers ----------
function addMarkerFromDB(row) {
  if (!isInsideLebanon(row.lat, row.lng)) return;
  const pos = { lat: row.lat, lng: row.lng };
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

// ---------- Popup ----------
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
addPointBtn?.addEventListener('click', () => {
  const ok = confirm("Safety first: don't place pins while driving.\n\nContinue?");
  if (!ok) return;
  addingPoint = true;
  addPointBtn.disabled = true;      // avoid double-tap
  addPointBtn.classList.add('active');
  // keep 🕳️
});

intensity.addEventListener('input', () => {
  intensityOut.textContent = intensity.value;
  if (draftMarker) draftMarker.setIcon(iconForIntensity(Number(intensity.value)));
});

cancelPinBtn.addEventListener('click', () => {
  if (draftMarker) { draftMarker.setMap(null); draftMarker = null; }
  addingPoint = false;
  formPanel.classList.add('hidden');
  document.body.classList.remove('form-open');
  addPointBtn.disabled = false;
  addPointBtn.classList.remove('active');
});

savePinBtn.addEventListener('click', async () => {
  if (!draftMarker || isSaving) return;

  const ll = draftMarker.getPosition();
  const lat = ll.lat(), lng = ll.lng();

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
    .from('pins').insert(pin).select().single();

  if (error) {
    console.error('Save error:', error);
    alert('Could not save pin. Please try again.');
  } else {
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
    draftMarker.setIcon(iconForIntensity(Number(inserted.intensity)));
  }

  // reset UI
  formPanel.classList.add('hidden');
  document.body.classList.remove('form-open');
  addingPoint = false;
  addPointBtn.disabled = false;
  addPointBtn.classList.remove('active');
  draftMarker = null;

  isSaving = false;
  savePinBtn.disabled = false;
  savePinBtn.textContent = 'Save';
});
