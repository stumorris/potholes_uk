import { fetchJson } from '../lib/http.js';
import { inUK } from '../lib/geo.js';

// FixMyStreet (mySociety) is where most UK members of the public report potholes,
// and it forwards those reports to the right council. Its map uses an "around"
// endpoint that returns pins for a bounding box; we query it on demand for the
// area people are looking at, filtered to pothole categories.
//
// Pin format: [lat, lng, colour, id, title, size, draggable]
//   colour: green = fixed, grey = closed/not council's responsibility, else open.

const STATUS_BY_COLOUR = { green: 'fixed', grey: 'closed' };

export function parsePins(json, cfg) {
  const pins = Array.isArray(json?.pins) ? json.pins : [];
  const base = cfg.baseUrl.replace(/\/$/, '');
  const out = [];
  for (const pin of pins) {
    const [lat, lng, colour, id, title] = Array.isArray(pin)
      ? pin
      : [pin.lat, pin.lon ?? pin.lng, pin.colour, pin.id, pin.title];
    const la = Number(lat);
    const ln = Number(lng);
    if (!inUK(la, ln) || id == null) continue;
    out.push({
      source: cfg.id,
      externalId: String(id),
      lat: la,
      lng: ln,
      title: title ? String(title).slice(0, 200) : 'Pothole',
      status: STATUS_BY_COLOUR[colour] ?? 'open',
      url: `${base}/report/${id}`,
    });
  }
  return out;
}

export function createFixMyStreet(cfg, { fetchImpl } = {}) {
  return {
    id: cfg.id,
    mode: 'bbox',
    async fetchBbox(b) {
      const params = new URLSearchParams({
        ajax: '1',
        bbox: [b.minLng, b.minLat, b.maxLng, b.maxLat].map((n) => n.toFixed(5)).join(','),
        status: 'all',
      });
      for (const cat of cfg.categories ?? ['Potholes']) params.append('filter_category', cat);
      const json = await fetchJson(`${cfg.baseUrl.replace(/\/$/, '')}/around?${params}`, { fetchImpl });
      return parsePins(json, cfg);
    },
  };
}
