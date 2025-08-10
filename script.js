// ---------- Supabase ----------
const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON);

// ---------- UI refs ----------
const addPointBtn  = document.getElementById('addPointBtn');
const formPanel    = document.getElementById('formPanel');
const coordInput   = document.getElementById('coord');
const roadSide     = document.getElementById('roadSide');
const descriptor   = document.getElementById('descriptor');
const intensity    = document.getElementById('intensity');
const intensityOut = document.getElementById('intensityOut');
const savePinBtn   = document.getElementById('savePin');
const cancelPinBtn = document.getElementById('cancelPin');
const searchInput  = document.getElementById('searchInput');

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

// ---------- Voter identity (anonymous) ----------
const VOTER_KEY = 'joora_voter_id';
let VOTER_ID = localStorage.getItem(VOTER_KEY);
if (!VOTER_ID) {
  VOTER_ID = (crypto?.randomUUID?.() || String(Math.random()).slice(2) + Date.now());
  localStorage.setItem(VOTER_KEY, VOTER_ID);
}

// ---------- Timings (ms) ----------
const TIMING = { screen: 1200, swapOverlap: 300, fabDelay: 1200 };

// ---------- Theme toggle: ONLY affects map ----------
const themeToggle = document.getElementById('themeToggle');
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1b1f27" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e141b" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#1b1f27" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#252b36" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#333a48" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#182026" }] }
];

function applyMapTheme(theme) {
  localStorage.setItem('joora_theme', theme);
  if (themeToggle) themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  if (window.google && map) {
    map.setOptions({ styles: theme === 'dark' ? DARK_MAP_STYLE : null });
  }
}
(function initMapTheme() {
  const saved = localStorage.getItem('joora_theme') || 'light';
  if (themeToggle) themeToggle.textContent = saved === 'dark' ? '☀️' : '🌙';
})();
themeToggle?.addEventListener('click', () => {
  const current = localStorage.getItem('joora_theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyMapTheme(next);
});

// ---------- Map globals ----------
let map, draftMarker = null, addingPoint = false, isSaving = false;
let infoWindow;
let boundaryLayer = null;

// Keep markers by pin id for realtime refresh
window.markersById = {};

// ---------- Bounds for Lebanon border drawing (not camera restriction) ----------
const LEB_BOUNDS = { north: 34.70, south: 33.05, west: 35.10, east: 36.65 };

// ---------- Border & Turf ----------
let lebFeature = null;

// Colors for intensity 1..5
const INTENSITY_COLORS = { 1:'#22c55e', 2:'#a3e635', 3:'#facc15', 4:'#f97316', 5:'#ef4444' };

// Glowing SVG icon for pins
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
  return glowingPin(c, 40);
}

// Utility
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Popup HTML with voting
function renderPopupWithVoting(d) {
  const stars = '★'.repeat(d.intensity) + '☆'.repeat(5 - d.intensity);
  return `
    <div style="max-width:260px">
      <strong>${escapeHtml(d.descriptor)}</strong> — ${escapeHtml(d.roadSide)}
      <div>Intensity: ${stars} (${d.intensity}/5)</div>
      <div style="margin-top:6px;color:#666;font-size:12px">
        ${Number(d.coords.lat).toFixed(5)}, ${Number(d.coords.lng).toFixed(5)}
      </div>

      <div style="margin-top:10px; display:flex; align-items:center; gap:8px;">
        <button id="up_${d.id}" style="border:0; padding:6px 10px; border-radius:8px; cursor:pointer; background:#e8f5e9;">👍</button>
        <span id="upcount_${d.id}">${d.upvotes || 0}</span>
        <button id="down_${d.id}" style="border:0; padding:6px 10px; border-radius:8px; cursor:pointer; background:#fdecea;">👎</button>
        <span id="downcount_${d.id}">${d.downvotes || 0}</span>
        <span style="margin-left:auto; font-weight:700;" id="score_${d.id}">Score: ${d.score || 0}</span>
      </div>
    </div>
  `;
}

// ---------- Screens helpers ----------
function showScreen(el) { if (!el) return; el.classList.remove('hidden'); }
function hideScreen(el) { if (!el) return; el.classList.add('hidden'); }

// ---------- Safety notice ----------
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
  } else {
    landing.classList.add('hidden');
    disclaimer.classList.add('hidden');
  }
}
bootstrapScreens();

landingContinue?.addEventListener('click', () => {
  hideScreen(landing);
  showScreen(disclaimer);
});
agreeBtn?.addEventListener('click', () => {
  sessionStorage.setItem(SESSION.sawDisclaimer, '1');
  hideScreen(disclaimer);
});

// ---------- Load Lebanon boundary ----------
async function loadLebanonBoundary() {
  const res = await fetch('./geoBoundaries-LBN-ADM0.geojson');
  if (!res.ok) throw new Error('Failed to fetch boundary');
  const gj = await res.json();
  lebFeature = (gj.type === 'FeatureCollection') ? gj.features[0]
            : (gj.type === 'Feature') ? gj
            : { type: 'Feature', geometry: gj, properties: {} };

  boundaryLayer = new google.maps.Data({ map, clickable: true });
  try { boundaryLayer.addGeoJson(gj); } catch { boundaryLayer.addGeoJson(lebFeature); }
  boundaryLayer.setStyle({ fillOpacity: 0, strokeWeight: 2, strokeColor: '#1a73e8' });

  // Forward clicks through the data layer to the map's click handler
  boundaryLayer.addListener('click', (e) => {
    google.maps.event.trigger(map, 'click', { latLng: e.latLng });
  });
}
function isInsideLebanon(lat, lng) {
  if (!lebFeature) return false;
  const pt = turf.point([lng, lat]);
  return turf.booleanPointInPolygon(pt, lebFeature);
}

// ---------- Init Map ----------
window.initMap = async () => {
  // Build LatLngBounds FIRST (google.* is available inside initMap)
  const LEB_BOUNDS_G = new google.maps.LatLngBounds(
    new google.maps.LatLng(LEB_BOUNDS.south, LEB_BOUNDS.west),
    new google.maps.LatLng(LEB_BOUNDS.north, LEB_BOUNDS.east)
  );

  map = new google.maps.Map(document.getElementById('map'), {
    // Start inside Lebanon right away
    center: LEB_BOUNDS_G.getCenter(),
    zoom: 8, // temporary; we'll fit and then lock minZoom
    streetViewControl: false,
    fullscreenControl: false,
    mapTypeControl: true,
    rotateControl: true,      // rotation control visible
    gestureHandling: 'greedy',
    restriction: {            // 🔒 hard panning restriction
      latLngBounds: LEB_BOUNDS_G,
      strictBounds: true
    },
    // Optional: keep 2D—if you want tilt gestures, remove this
    tilt: 0
  });

  infoWindow = new google.maps.InfoWindow();

  // Apply saved theme (base geometry only, labels are untouched)
  const currentTheme = localStorage.getItem('joora_theme') || 'light';
  map.setOptions({ styles: currentTheme === 'dark' ? DARK_MAP_STYLE : null });

  // Fit to Lebanon, then lock minZoom so you can't zoom further out
  map.fitBounds(LEB_BOUNDS_G);
  google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
    const z = map.getZoom();
    map.setOptions({ minZoom: z, maxZoom: 19 });
  });

  // Places Autocomplete (use the SAME bounds)
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

  // Map click to place draft marker (inside border only)
map.addListener('click', (e) => {
  // If we're placing a pin, keep your existing placement logic
  if (addingPoint) {
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
    descriptor.value = 'Joora';
    intensity.value = '3';
    intensityOut.textContent = '3';

    formPanel.classList.remove('hidden');
    return; // <— important: don’t fall through
  }

  // Not adding a pin? Treat map click as "dismiss the card"
  infoWindow?.close();
});


  // Load pins with vote totals
  const { data, error } = await supabase
    .from('pins_with_scores')
    .select('id, lat, lng, roadside, descriptor, intensity, created_at, upvotes, downvotes, score')
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
    id        : row.id,
    roadSide  : row.roadside || 'Middle',
    descriptor: row.descriptor || row.details || 'Joora',
    intensity : row.intensity ?? 3,
    coords    : pos,
    createdAt : row.created_at,
    upvotes   : row.upvotes ?? 0,
    downvotes : row.downvotes ?? 0,
    score     : row.score ?? 0
  };

  // keep reference for realtime refresh
  window.markersById[row.id] = marker;

  marker.addListener('click', () => {
    infoWindow.setContent(renderPopupWithVoting(marker.customData));
    infoWindow.open({ map, anchor: marker });
    wireVoteButtons(marker); // attach click handlers
  });
}

// ---------- UI actions ----------
addPointBtn?.addEventListener('click', () => {
  const ok = confirm("Safety first: don't place pins while driving.\n\nContinue?");
  if (!ok) return;
  addingPoint = true;
  addPointBtn.disabled = true;
  addPointBtn.classList.add('active'); // stays 🕳️, just turns green
});

intensity.addEventListener('input', () => {
  intensityOut.textContent = intensity.value;
  if (draftMarker) draftMarker.setIcon(iconForIntensity(Number(intensity.value)));
});

cancelPinBtn.addEventListener('click', () => {
  if (draftMarker) { draftMarker.setMap(null); draftMarker = null; }
  addingPoint = false;
  formPanel.classList.add('hidden');
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
    roadside  : roadSide.value,
    descriptor: descriptor.value,      // using descriptor column
    intensity : Number(intensity.value)
  };

  const { data: inserted, error } = await supabase
    .from('pins').insert(pin).select().single();

  if (error) {
    console.error('Save error:', error);
    if (error.code === '23505') {
      alert('That exact pin already exists here with the same settings.');
    } else {
      alert(error.message || 'Could not save pin. Please try again.');
    }
} else {
  // capture the marker reference BEFORE resetting draftMarker later
  const newMarker = draftMarker;

  // store full data including the ID we need for voting
  newMarker.customData = {
    id        : inserted.id,
    roadSide  : inserted.roadside,
    descriptor: inserted.descriptor ?? descriptor.value,
    intensity : inserted.intensity,
    coords    : { lat: inserted.lat, lng: inserted.lng },
    createdAt : inserted.created_at,
    upvotes   : 0,
    downvotes : 0,
    score     : 0
  };

  // register in the lookup map for realtime updates
  window.markersById[inserted.id] = newMarker;

  // attach a click handler that uses the captured reference (not draftMarker)
  newMarker.addListener('click', function () {
    infoWindow.setContent(renderPopupWithVoting(newMarker.customData));
    infoWindow.open({ map, anchor: newMarker });
    wireVoteButtons(newMarker);
  });

  // open immediately so no refresh/click needed
  infoWindow.setContent(renderPopupWithVoting(newMarker.customData));
  infoWindow.open({ map, anchor: newMarker });
  wireVoteButtons(newMarker);

  newMarker.setIcon(iconForIntensity(Number(inserted.intensity)));
}



  // reset UI
  formPanel.classList.add('hidden');
  addingPoint = false;
  addPointBtn.disabled = false;
  addPointBtn.classList.remove('active');
  draftMarker = null;

  isSaving = false;
  savePinBtn.disabled = false;
  savePinBtn.textContent = 'Save';
});

// ---------- Voting wiring ----------
function wireVoteButtons(marker) {
  const id = marker.customData.id;
  const upBtn = document.getElementById(`up_${id}`);
  const dnBtn = document.getElementById(`down_${id}`);

  upBtn?.addEventListener('click', () => castVote(id, +1, marker));
  dnBtn?.addEventListener('click', () => castVote(id, -1, marker));
}

async function castVote(pinId, value, marker) {
  const upBtn = document.getElementById(`up_${pinId}`);
  const dnBtn = document.getElementById(`down_${pinId}`);
  upBtn && (upBtn.disabled = true);
  dnBtn && (dnBtn.disabled = true);

  const { error } = await supabase
    .from('pin_votes')
    .upsert({ pin_id: pinId, voter_id: VOTER_ID, value }, { onConflict: 'pin_id,voter_id' })
    .select()
    .single();

  if (error) {
    console.error('Vote error', error);
    alert(error.message || 'Could not register vote.');
  } else {
    await refreshPinCounts(pinId, marker);
  }

  upBtn && (upBtn.disabled = false);
  dnBtn && (dnBtn.disabled = false);
}

async function refreshPinCounts(pinId, marker) {
  const { data, error } = await supabase
    .from('pins_with_scores')
    .select('id, upvotes, downvotes, score')
    .eq('id', pinId)
    .single();

  if (error || !data) return;

  marker.customData.upvotes = data.upvotes;
  marker.customData.downvotes = data.downvotes;
  marker.customData.score = data.score;

  // Update popup labels if it’s open
  const upEl   = document.getElementById(`upcount_${pinId}`);
  const downEl = document.getElementById(`downcount_${pinId}`);
  const scoreEl= document.getElementById(`score_${pinId}`);
  if (upEl)   upEl.textContent   = data.upvotes;
  if (downEl) downEl.textContent = data.downvotes;
  if (scoreEl)scoreEl.textContent= `Score: ${data.score}`;
}

// ---------- Realtime votes -> refresh affected marker ----------
const votesChannel = supabase
  .channel('votes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'pin_votes' }, async (payload) => {
    const pinId = payload.new?.pin_id || payload.old?.pin_id;
    const marker = window.markersById?.[pinId];
    if (marker) {
      await refreshPinCounts(pinId, marker);
    }
  })
  .subscribe();
