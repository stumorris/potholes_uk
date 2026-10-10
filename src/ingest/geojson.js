import { fetchJson } from '../lib/http.js';
import { normalise, passesFilter } from './mapping.js';

// Any URL serving a GeoJSON FeatureCollection of points (CKAN / data.gov.uk
// resources, council open-data portals, Socrata `.geojson` exports, ...).

export function parseGeoJson(json, cfg) {
  const out = [];
  for (const feat of json?.features ?? []) {
    const props = feat.properties ?? {};
    if (!passesFilter(props, cfg.filter)) continue;
    const g = feat.geometry;
    let coords;
    if (g?.type === 'Point') {
      const [x, y] = g.coordinates;
      // Some council GeoJSON is (wrongly) in British National Grid; detect and convert.
      coords = Math.abs(x) > 180 ? null : { lng: x, lat: y };
      if (coords === null) {
        const r = normalise({ ...props, __e: x, __n: y }, undefined,
          { ...cfg, fields: { ...cfg.fields, easting: '__e', northing: '__n' } });
        if (r) out.push(r);
        continue;
      }
    }
    if (feat.id != null && props.__id == null) props.__id = feat.id;
    const r = normalise(props, coords, { ...cfg, fields: { id: '__id', ...cfg.fields } });
    if (r) out.push(r);
  }
  return out;
}

export function createGeoJson(cfg, { fetchImpl } = {}) {
  return {
    id: cfg.id,
    mode: 'bulk',
    async fetchAll() {
      return parseGeoJson(await fetchJson(cfg.url, { fetchImpl, timeoutMs: 60000 }), cfg);
    },
  };
}
