import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, sourceStatuses } from './db.js';
import { createLiveHub } from './live.js';
import { reportsRouter } from './routes/reports.js';
import { createIngestor, loadSourceConfig, describeSource } from './ingest/index.js';
import { lookupAuthority as defaultLookup } from './lib/authority.js';
import { inUK } from './lib/geo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({
  db = openDb(),
  sourceConfigs = loadSourceConfig(path.join(root, 'config/sources.json')),
  uploadDir = process.env.UPLOAD_DIR || path.join(root, 'data/uploads'),
  lookupAuthority = defaultLookup,
  fetchImpl,
  log = console,
} = {}) {
  const app = express();
  const live = createLiveHub();
  const ingestor = createIngestor(db, sourceConfigs, { publish: live.publish, fetchImpl, log });

  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': [
        "default-src 'self'",
        "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    next();
  });

  app.use('/api/reports', reportsRouter({ db, live, ingestor, uploadDir, lookupAuthority }));
  app.get('/api/stream', live.handler);

  app.get('/api/sources', (req, res) => {
    const { rows, countBy } = sourceStatuses(db);
    const statusBy = Object.fromEntries(rows.map((r) => [r.source, r]));
    res.json([
      { id: 'user', name: 'Reports made on this site', enabled: true, count: countBy.user ?? 0 },
      ...sourceConfigs.map((c) => ({ ...describeSource(c), count: countBy[c.id] ?? 0, status: statusBy[c.id] ?? null })),
    ]);
  });

  app.get('/api/authority', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!inUK(lat, lng)) return res.status(400).json({ error: 'lat/lng must be a point in the UK' });
    try {
      const result = await lookupAuthority(lat, lng);
      if (!result) return res.status(404).json({ error: 'No council found for that location' });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: `Council lookup unavailable: ${err.message}` });
    }
  });

  app.use('/uploads', express.static(uploadDir, { maxAge: '7d', immutable: true }));
  app.use('/vendor/leaflet', express.static(path.join(root, 'node_modules/leaflet/dist')));
  app.use('/vendor/markercluster', express.static(path.join(root, 'node_modules/leaflet.markercluster/dist')));
  app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

  app.use((err, req, res, next) => {
    log.error?.(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return { app, db, live, ingestor };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { app, ingestor } = createApp();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Potholes UK running at http://localhost:${port}`));
  ingestor.start();
}
