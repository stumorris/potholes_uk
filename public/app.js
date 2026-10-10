/* global L */
(() => {
  'use strict';

  const UK_CENTRE = [54.2, -2.5];
  const SOURCE_COLOURS = { user: '#d9480f', fixmystreet: '#1c7ed6' };
  const COUNCIL_COLOUR = '#7048e8';
  const colourFor = (source) => SOURCE_COLOURS[source] || COUNCIL_COLOUR;

  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const c of children) if (c != null) node.append(c);
    return node;
  };

  // ---------------------------------------------------------------- map
  const map = L.map('map', { zoomControl: true }).setView(UK_CENTRE, 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50, disableClusteringAtZoom: 17 });
  map.addLayer(cluster);

  const markers = new Map(); // report id → { marker, props }
  let sources = [];

  function icon(props) {
    const fixed = props.status !== 'open';
    const sev = props.severity === 'severe' ? ' sev-severe' : '';
    return L.divIcon({
      className: '',
      html: `<span class="pin${fixed ? ' pin-fixed' : ''}${sev}" style="--pin:${colourFor(props.source)}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -8],
    });
  }

  function activeFilters() {
    const srcs = [...document.querySelectorAll('input[name=source]:checked')].map((i) => i.value);
    const statuses = [...document.querySelectorAll('input[name=status]:checked')].map((i) => i.value);
    return { srcs, statuses };
  }

  function passes(props) {
    const { srcs, statuses } = activeFilters();
    return srcs.includes(props.source) && statuses.includes(props.status === 'open' ? 'open' : 'fixed');
  }

  function upsertMarker(props, { flash = false } = {}) {
    const existing = markers.get(props.id);
    if (existing) {
      Object.assign(existing.props, props);
      existing.marker.setIcon(icon(existing.props));
      return;
    }
    const marker = L.marker([props.lat, props.lng], { icon: icon(props), title: props.title || 'Pothole' });
    marker.bindPopup(() => popupContent(props.id), { minWidth: 240, maxWidth: 320 });
    marker.on('popupopen', () => loadPopup(props.id));
    markers.set(props.id, { marker, props });
    if (passes(props)) {
      cluster.addLayer(marker);
      if (flash) setTimeout(() => marker.getElement()?.querySelector('.pin')?.classList.add('pin-new'), 50);
    }
  }

  function applyFilters() {
    cluster.clearLayers();
    const layers = [];
    for (const { marker, props } of markers.values()) if (passes(props)) layers.push(marker);
    cluster.addLayers(layers);
    updateCount();
  }

  function updateCount() {
    const b = map.getBounds();
    let n = 0;
    for (const { props } of markers.values()) if (passes(props) && b.contains([props.lat, props.lng])) n++;
    $('count').textContent = `${n.toLocaleString('en-GB')} pothole${n === 1 ? '' : 's'} in view`;
  }

  // ---------------------------------------------------------------- data loading
  let loadTimer;
  let loadSeq = 0;
  async function loadVisible() {
    const seq = ++loadSeq;
    const params = new URLSearchParams({ bbox: map.getBounds().toBBoxString() });
    try {
      const res = await fetch(`/api/reports?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fc = await res.json();
      if (seq !== loadSeq) return;
      for (const f of fc.features) upsertMarker(f.properties);
      updateCount();
    } catch (err) {
      toast(`Couldn't load reports (${err.message})`);
    }
  }
  map.on('moveend', () => { clearTimeout(loadTimer); loadTimer = setTimeout(loadVisible, 250); updateCount(); });

  async function loadSources() {
    try {
      sources = await (await fetch('/api/sources')).json();
    } catch { sources = [{ id: 'user', name: 'Reports made on this site', enabled: true }]; }
    const box = $('source-filters');
    box.replaceChildren();
    for (const s of sources.filter((x) => x.enabled)) {
      const swatch = el('span', { className: 'swatch' });
      swatch.style.setProperty('--pin', colourFor(s.id));
      const input = el('input', { type: 'checkbox', name: 'source', value: s.id, checked: true });
      input.addEventListener('change', applyFilters);
      box.append(el('label', {}, input, swatch, s.id === 'user' ? 'Reported here' : s.name));
    }
  }
  document.querySelectorAll('input[name=status]').forEach((i) => i.addEventListener('change', applyFilters));

  // ---------------------------------------------------------------- popups
  function popupContent() { return el('div', { className: 'popup' }, el('p', { className: 'hint' }, 'Loading…')); }

  async function loadPopup(id) {
    const entry = markers.get(id);
    if (!entry) return;
    let r;
    try {
      r = await (await fetch(`/api/reports/${id}`)).json();
    } catch {
      entry.marker.setPopupContent(el('div', { className: 'popup' }, 'Could not load this report.'));
      return;
    }
    const sourceName = r.source === 'user' ? 'Reported on Potholes UK'
      : (sources.find((s) => s.id === r.source)?.name || r.source);
    const date = new Date(r.reported_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const node = el('div', { className: 'popup' },
      el('h3', {}, r.title || 'Pothole'),
      el('p', { className: 'meta' },
        el('span', { className: `badge badge-${r.status}` }, r.status === 'open' ? 'Open' : r.status === 'fixed' ? 'Fixed' : 'Closed'),
        ` ${sourceName} · ${date}`),
    );
    if (r.severity || r.depth_mm) {
      node.append(el('p', {}, [r.severity && `Severity: ${r.severity}`, r.depth_mm && `Depth: ~${r.depth_mm} mm`].filter(Boolean).join(' · ')));
    }
    if (r.description) node.append(el('p', { className: 'desc' }, r.description));
    if (r.photos?.length) {
      const gallery = el('div', { className: 'gallery' });
      for (const src of r.photos) gallery.append(el('a', { href: src, target: '_blank', rel: 'noopener' }, el('img', { src, alt: 'Photo of the pothole', loading: 'lazy' })));
      node.append(gallery);
    }
    if (r.authority) node.append(el('p', { className: 'small' }, `Highway authority: ${r.authority}`));

    const actions = el('div', { className: 'popup-actions' });
    if (r.url) actions.append(el('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'View original report ↗'));
    if (r.status === 'open') {
      const btn = el('button', { className: 'btn btn-small', type: 'button' }, `Still there (${r.confirmations})`);
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = await fetch(`/api/reports/${id}/confirm`, { method: 'POST' });
        if (res.ok) btn.textContent = `Thanks – ${(await res.json()).confirmations} confirmed`;
        else { btn.disabled = false; toast('Could not record that, try again later'); }
      });
      actions.append(btn);
    }
    actions.append(el('a', { href: '/liability' }, 'Damaged your vehicle?'));
    node.append(actions);
    entry.marker.setPopupContent(node);
  }

  // ---------------------------------------------------------------- live updates
  function connectLive() {
    const status = $('live-status');
    const es = new EventSource('/api/stream');
    es.onopen = () => { status.classList.add('on'); status.lastChild.textContent = 'Live – new reports appear automatically'; };
    es.onerror = () => { status.classList.remove('on'); status.lastChild.textContent = 'Reconnecting…'; };
    es.addEventListener('report', (e) => {
      const p = JSON.parse(e.data);
      const isNew = !markers.has(p.id);
      upsertMarker(p, { flash: isNew });
      if (isNew && p.source === 'user' && p.id !== lastSubmittedId && map.getBounds().contains([p.lat, p.lng])) {
        toast('New pothole reported nearby');
      }
      updateCount();
    });
    es.addEventListener('confirm', (e) => {
      const { id, confirmations } = JSON.parse(e.data);
      const m = markers.get(id);
      if (m) m.props.confirmations = confirmations;
    });
  }

  // ---------------------------------------------------------------- reporting
  let reporting = false;
  let draftMarker = null;
  let draftLatLng = null;
  let lastSubmittedId = null;
  const form = $('report-form');

  function setReporting(on) {
    reporting = on;
    $('browse').hidden = on;
    $('report-form-section').hidden = !on;
    document.body.classList.toggle('reporting', on);
    if (!on) {
      if (draftMarker) map.removeLayer(draftMarker);
      draftMarker = null; draftLatLng = null;
      form.reset(); $('previews').replaceChildren(); $('loc-readout').textContent = ''; $('authority').hidden = true;
      $('form-error').hidden = true;
    }
  }

  async function setDraftLocation(latlng) {
    draftLatLng = latlng;
    if (!draftMarker) {
      draftMarker = L.marker(latlng, { draggable: true, icon: L.divIcon({ className: '', html: '<span class="pin pin-draft"></span>', iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(map);
      draftMarker.on('dragend', () => setDraftLocation(draftMarker.getLatLng()));
    } else draftMarker.setLatLng(latlng);
    $('loc-readout').textContent = `📍 ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)} – drag the pin to adjust`;

    const auth = $('authority');
    auth.hidden = false;
    auth.textContent = 'Finding the responsible council…';
    try {
      const res = await fetch(`/api/authority?lat=${latlng.lat}&lng=${latlng.lng}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      auth.textContent = `Responsible: ${data.authority.name}`;
      if (data.trunkRoads) auth.append(el('span', { className: 'small block' }, `If this is a motorway or trunk road: ${data.trunkRoads.name}.`));
    } catch {
      auth.textContent = 'Could not look up the council right now – your report will still be saved.';
    }
  }

  map.on('click', (e) => { if (reporting) setDraftLocation(e.latlng); });
  $('start-report').addEventListener('click', () => {
    setReporting(true);
    if (map.getZoom() < 15) toast('Zoom in and tap the exact spot');
  });
  $('cancel-report').addEventListener('click', () => setReporting(false));

  $('use-location').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available in this browser');
    $('use-location').disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      $('use-location').disabled = false;
      const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      map.setView(ll, 18);
      setDraftLocation(ll);
    }, (err) => {
      $('use-location').disabled = false;
      toast(`Couldn't get your location: ${err.message}`);
    }, { enableHighAccuracy: true, timeout: 15000 });
  });

  $('photos').addEventListener('change', () => {
    const files = [...$('photos').files];
    const prev = $('previews');
    prev.replaceChildren();
    if (files.length > 4) { showError('Please choose up to 4 photos'); return; }
    for (const f of files) prev.append(el('img', { src: URL.createObjectURL(f), alt: f.name }));
  });

  function showError(msg) { const e = $('form-error'); e.textContent = msg; e.hidden = !msg; }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    showError('');
    if (!draftLatLng) return showError('Tap the map to mark where the pothole is.');
    if ($('photos').files.length > 4) return showError('Please choose up to 4 photos.');

    const fd = new FormData(form);
    fd.set('lat', draftLatLng.lat);
    fd.set('lng', draftLatLng.lng);
    const btn = $('submit-report');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const res = await fetch('/api/reports', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      lastSubmittedId = data.id;
      setReporting(false);
      upsertMarker({ ...data, photo_count: data.photos.length }, { flash: true });
      toast('Thanks! Your report is on the map. Remember to also report it to the council so they are formally on notice.', 7000);
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Submit report';
    }
  });

  // ---------------------------------------------------------------- toast
  let toastTimer;
  function toast(msg, ms = 4000) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------------------------------------------------------------- boot
  loadSources().then(() => { loadVisible(); connectLive(); });
})();
