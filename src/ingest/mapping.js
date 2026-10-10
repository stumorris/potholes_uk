import { gridToWgs84 } from '../lib/osgb.js';
import { inUK } from '../lib/geo.js';

// Shared helpers that turn a raw upstream record into our normalised report shape,
// driven by the `fields` / `statusMap` / `filter` settings in config/sources.json.

const get = (obj, path) => (path ? path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj) : undefined);

function toIso(v) {
  if (v == null || v === '') return undefined;
  // ArcGIS returns epoch milliseconds; others return ISO or "DD/MM/YYYY".
  if (typeof v === 'number') return new Date(v).toISOString();
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  const d = uk ? new Date(Date.UTC(+uk[3], +uk[2] - 1, +uk[1])) : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function mapStatus(raw, statusMap) {
  if (raw == null) return 'open';
  const s = String(raw).trim().toLowerCase();
  if (statusMap) {
    for (const [k, v] of Object.entries(statusMap)) if (k.toLowerCase() === s) return v;
  }
  if (/(fixed|repaired|complete|closed|resolved)/.test(s)) return 'fixed';
  return 'open';
}

export function passesFilter(props, filter) {
  if (!filter) return true;
  const value = String(get(props, filter.field) ?? '').toLowerCase();
  if (filter.values) return filter.values.some((v) => value === String(v).toLowerCase());
  if (filter.contains) return filter.contains.some((v) => value.includes(String(v).toLowerCase()));
  return true;
}

/**
 * @param props   record attributes
 * @param coords  { lat, lng } from geometry if present
 * @param cfg     source config
 */
export function normalise(props, coords, cfg) {
  const f = cfg.fields || {};
  let lat = coords?.lat;
  let lng = coords?.lng;
  if (f.lat && f.lng) {
    lat = Number(get(props, f.lat));
    lng = Number(get(props, f.lng));
  } else if (f.easting && f.northing) {
    const E = Number(get(props, f.easting));
    const N = Number(get(props, f.northing));
    if (Number.isFinite(E) && Number.isFinite(N) && E > 0 && N > 0) ({ lat, lng } = gridToWgs84(E, N));
  }
  if (!inUK(lat, lng)) return null;

  const externalId = get(props, f.id);
  if (externalId == null || externalId === '') return null;

  const title = get(props, f.title) ?? cfg.defaultTitle ?? 'Pothole';
  const url = f.url ? get(props, f.url) : cfg.recordUrl?.replace('{id}', encodeURIComponent(externalId));
  return {
    source: cfg.id,
    externalId: String(externalId),
    lat,
    lng,
    title: String(title).slice(0, 200),
    description: f.description ? String(get(props, f.description) ?? '').slice(0, 2000) || undefined : undefined,
    status: mapStatus(get(props, f.status), cfg.statusMap),
    reportedAt: toIso(get(props, f.reportedAt)),
    authority: cfg.authority,
    url,
  };
}
