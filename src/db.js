import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT    NOT NULL,             -- 'user', 'fixmystreet', or a council connector id
  external_id  TEXT,                         -- id in the upstream system (NULL for user reports)
  lat          REAL    NOT NULL,
  lng          REAL    NOT NULL,
  title        TEXT,
  description  TEXT,
  severity     TEXT,                         -- 'minor' | 'moderate' | 'severe' (user reports)
  depth_mm     INTEGER,
  status       TEXT    NOT NULL DEFAULT 'open', -- 'open' | 'fixed' | 'closed'
  authority    TEXT,                         -- responsible highway authority, if known
  url          TEXT,                         -- link to the upstream record
  confirmations INTEGER NOT NULL DEFAULT 0,  -- "still there" votes
  reported_at  TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS reports_lat_lng ON reports (lat, lng);
CREATE INDEX IF NOT EXISTS reports_source ON reports (source);

CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  filename   TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_report ON photos (report_id);

CREATE TABLE IF NOT EXISTS source_status (
  source       TEXT PRIMARY KEY,
  last_run_at  TEXT,
  last_ok_at   TEXT,
  last_error   TEXT,
  last_count   INTEGER
);
`;

export function openDb(file = process.env.DB_FILE || 'data/potholes.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

const now = () => new Date().toISOString();

export function createReport(db, r) {
  const ts = now();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO reports (source, lat, lng, title, description, severity, depth_mm, authority, reported_at, updated_at)
    VALUES ('user', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.lat, r.lng, r.title ?? null, r.description ?? null, r.severity ?? null,
      r.depthMm ?? null, r.authority ?? null, ts, ts);
  return Number(lastInsertRowid);
}

export function addPhoto(db, reportId, filename) {
  db.prepare('INSERT INTO photos (report_id, filename, created_at) VALUES (?, ?, ?)').run(reportId, filename, now());
}

/** Insert or update a report from an external source. Returns 'inserted' | 'updated' | 'unchanged'. */
export function upsertExternal(db, r) {
  const existing = db.prepare('SELECT id, status, title, lat, lng FROM reports WHERE source = ? AND external_id = ?')
    .get(r.source, String(r.externalId));
  const ts = now();
  if (!existing) {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO reports (source, external_id, lat, lng, title, description, status, authority, url, reported_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(r.source, String(r.externalId), r.lat, r.lng, r.title ?? null, r.description ?? null,
        r.status ?? 'open', r.authority ?? null, r.url ?? null, r.reportedAt ?? ts, ts);
    return { change: 'inserted', id: Number(lastInsertRowid) };
  }
  if (existing.status === (r.status ?? 'open') && existing.title === (r.title ?? null)
      && existing.lat === r.lat && existing.lng === r.lng) {
    return { change: 'unchanged', id: existing.id };
  }
  db.prepare(`UPDATE reports SET lat = ?, lng = ?, title = ?, description = COALESCE(?, description),
      status = ?, url = COALESCE(?, url), updated_at = ? WHERE id = ?`)
    .run(r.lat, r.lng, r.title ?? null, r.description ?? null, r.status ?? 'open', r.url ?? null, ts, existing.id);
  return { change: 'updated', id: existing.id };
}

export function getReport(db, id) {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  if (!report) return null;
  report.photos = db.prepare('SELECT filename FROM photos WHERE report_id = ? ORDER BY id').all(id)
    .map((p) => `/uploads/${p.filename}`);
  return { ...report };
}

export function queryReports(db, { bbox, sources, statuses, limit = 3000 }) {
  const where = ['lng BETWEEN ? AND ?', 'lat BETWEEN ? AND ?'];
  const args = [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat];
  if (sources?.length) {
    where.push(`source IN (${sources.map(() => '?').join(',')})`);
    args.push(...sources);
  }
  if (statuses?.length) {
    where.push(`status IN (${statuses.map(() => '?').join(',')})`);
    args.push(...statuses);
  }
  return db.prepare(`
    SELECT r.id, r.source, r.lat, r.lng, r.title, r.severity, r.status, r.reported_at, r.confirmations,
           (SELECT COUNT(*) FROM photos p WHERE p.report_id = r.id) AS photo_count
    FROM reports r WHERE ${where.join(' AND ')}
    ORDER BY r.reported_at DESC LIMIT ?`).all(...args, limit);
}

export function confirmReport(db, id) {
  const res = db.prepare('UPDATE reports SET confirmations = confirmations + 1, updated_at = ? WHERE id = ?').run(now(), id);
  return res.changes > 0;
}

export function recordSourceRun(db, source, { ok, error, count }) {
  const ts = now();
  db.prepare(`
    INSERT INTO source_status (source, last_run_at, last_ok_at, last_error, last_count) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (source) DO UPDATE SET
      last_run_at = excluded.last_run_at,
      last_ok_at  = COALESCE(excluded.last_ok_at, source_status.last_ok_at),
      last_error  = excluded.last_error,
      last_count  = COALESCE(excluded.last_count, source_status.last_count)`)
    .run(source, ts, ok ? ts : null, ok ? null : String(error ?? 'unknown error'), ok ? count : null);
}

export function sourceStatuses(db) {
  const rows = db.prepare('SELECT * FROM source_status').all();
  const counts = db.prepare('SELECT source, COUNT(*) AS n FROM reports GROUP BY source').all();
  const countBy = Object.fromEntries(counts.map((c) => [c.source, c.n]));
  return { rows: rows.map((r) => ({ ...r })), countBy };
}
