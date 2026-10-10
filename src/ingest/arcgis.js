import { fetchJson } from '../lib/http.js';
import { normalise, passesFilter } from './mapping.js';

// Many councils publish open data through ArcGIS Hub / ArcGIS Online.
// Point this at a FeatureServer or MapServer *layer* URL (ending in /0, /1, ...)
// and we page through it as GeoJSON in WGS84.

export function createArcGis(cfg, { fetchImpl } = {}) {
  const pageSize = cfg.pageSize ?? 1000;
  const maxRecords = cfg.maxRecords ?? 50000;
  return {
    id: cfg.id,
    mode: 'bulk',
    async fetchAll() {
      const out = [];
      for (let offset = 0; offset < maxRecords; offset += pageSize) {
        const params = new URLSearchParams({
          where: cfg.where ?? '1=1',
          outFields: '*',
          outSR: '4326',
          f: 'geojson',
          resultOffset: String(offset),
          resultRecordCount: String(pageSize),
        });
        const json = await fetchJson(`${cfg.url.replace(/\/$/, '')}/query?${params}`, { fetchImpl, timeoutMs: 60000 });
        if (json.error) throw new Error(`ArcGIS error: ${json.error.message ?? JSON.stringify(json.error)}`);
        const feats = json.features ?? [];
        for (const feat of feats) {
          const props = feat.properties ?? {};
          if (!passesFilter(props, cfg.filter)) continue;
          const g = feat.geometry;
          const coords = g?.type === 'Point' ? { lng: g.coordinates[0], lat: g.coordinates[1] } : undefined;
          const r = normalise(props, coords, cfg);
          if (r) out.push(r);
        }
        if (feats.length < pageSize && !json.properties?.exceededTransferLimit && !json.exceededTransferLimit) break;
      }
      return out;
    },
  };
}
