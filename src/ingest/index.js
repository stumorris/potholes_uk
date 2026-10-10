import fs from 'node:fs';
import { upsertExternal, recordSourceRun } from '../db.js';
import { bboxArea, tilesCovering, tileBbox } from '../lib/geo.js';
import { createFixMyStreet } from './fixmystreet.js';
import { createArcGis } from './arcgis.js';
import { createGeoJson } from './geojson.js';
import { createCsv } from './csv.js';

const FACTORIES = { fixmystreet: createFixMyStreet, arcgis: createArcGis, geojson: createGeoJson, csv: createCsv };

export function loadSourceConfig(file = process.env.SOURCES_FILE || 'config/sources.json') {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return json.sources ?? [];
}

/** Public description of a source, safe to send to browsers. */
export function describeSource(cfg) {
  const { id, name, type, enabled, licence, attribution, homepage, authority } = cfg;
  return { id, name, type, enabled: enabled !== false, licence, attribution, homepage, authority };
}

/**
 * Coordinates every external data source.
 *  - "bulk" sources (council datasets) are re-synced on a timer.
 *  - "bbox" sources (FixMyStreet) are fetched on demand for the area being
 *    viewed, cached per map tile, so we never hammer upstream for the whole UK.
 */
export function createIngestor(db, configs, { publish = () => {}, fetchImpl, log = console } = {}) {
  const sources = configs
    .filter((c) => c.enabled !== false && FACTORIES[c.type])
    .map((c) => ({ cfg: c, conn: FACTORIES[c.type](c, { fetchImpl }) }));

  function store(sourceId, records) {
    let inserted = 0;
    let updated = 0;
    for (const r of records) {
      const { change, id } = upsertExternal(db, r);
      if (change === 'unchanged') continue;
      change === 'inserted' ? inserted++ : updated++;
      publish('report', {
        id, source: r.source, lat: r.lat, lng: r.lng, title: r.title, status: r.status,
        reported_at: r.reportedAt ?? new Date().toISOString(), photo_count: 0, confirmations: 0,
      });
    }
    return { inserted, updated, total: records.length };
  }

  async function syncBulk(s) {
    try {
      const records = await s.conn.fetchAll();
      const res = store(s.cfg.id, records);
      recordSourceRun(db, s.cfg.id, { ok: true, count: records.length });
      log.info?.(`[ingest] ${s.cfg.id}: ${records.length} records (${res.inserted} new, ${res.updated} updated)`);
      return res;
    } catch (err) {
      recordSourceRun(db, s.cfg.id, { ok: false, error: err.message });
      log.warn?.(`[ingest] ${s.cfg.id} failed: ${err.message}`);
      return { error: err.message };
    }
  }

  async function syncAllBulk() {
    const results = {};
    for (const s of sources.filter((x) => x.conn.mode === 'bulk')) results[s.cfg.id] = await syncBulk(s);
    return results;
  }

  // ---- on-demand bbox sources -------------------------------------------
  const TILE_ZOOM = 13;                 // ~5km tiles in the UK
  const TILE_TTL_MS = 15 * 60 * 1000;
  const MAX_AREA = 0.5;                 // deg²: skip when zoomed out to region/country level
  const tileFetchedAt = new Map();      // `${source}/${z}/${x}/${y}` → ms
  const inFlight = new Map();

  function refreshTile(s, tile) {
    const key = `${s.cfg.id}/${tile.z}/${tile.x}/${tile.y}`;
    const last = tileFetchedAt.get(key);
    if (last && Date.now() - last < TILE_TTL_MS) return null;
    if (inFlight.has(key)) return inFlight.get(key);
    const p = s.conn.fetchBbox(tileBbox(tile))
      .then((records) => {
        tileFetchedAt.set(key, Date.now());
        recordSourceRun(db, s.cfg.id, { ok: true, count: records.length });
        return store(s.cfg.id, records);
      })
      .catch((err) => {
        // Back off for a minute before retrying a failing tile.
        tileFetchedAt.set(key, Date.now() - TILE_TTL_MS + 60_000);
        recordSourceRun(db, s.cfg.id, { ok: false, error: err.message });
        log.warn?.(`[ingest] ${s.cfg.id} tile ${key} failed: ${err.message}`);
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  /** Kick off (non-blocking) refreshes for the visible area. Returns the pending promises. */
  function ensureFresh(bbox) {
    if (bboxArea(bbox) > MAX_AREA) return [];
    const pending = [];
    for (const s of sources.filter((x) => x.conn.mode === 'bbox')) {
      for (const tile of tilesCovering(bbox, TILE_ZOOM, 12)) {
        const p = refreshTile(s, tile);
        if (p) pending.push(p);
      }
    }
    return pending;
  }

  let timer;
  function start() {
    const hours = Number(process.env.BULK_SYNC_HOURS || 6);
    syncAllBulk();
    timer = setInterval(syncAllBulk, hours * 3600 * 1000);
    timer.unref?.();
  }
  function stop() { clearInterval(timer); }

  return { sources, syncAllBulk, ensureFresh, start, stop };
}
