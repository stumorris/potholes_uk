import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createReport, addPhoto, getReport, queryReports, confirmReport } from '../db.js';
import { parseBbox, inUK } from '../lib/geo.js';
import { stripJpegMetadata } from '../lib/jpeg.js';
import { rateLimit } from '../lib/rateLimit.js';

const SEVERITIES = new Set(['minor', 'moderate', 'severe']);
const STATUSES = new Set(['open', 'fixed', 'closed']);
const MAX_PHOTOS = 4;

// Identify images by their magic bytes rather than trusting the client's MIME type.
function sniffImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) || undefined : undefined);

export function reportsRouter({ db, live, ingestor, uploadDir, lookupAuthority }) {
  const router = express.Router();
  fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: MAX_PHOTOS, fields: 20 },
  });

  // GET /api/reports?bbox=minLng,minLat,maxLng,maxLat&sources=user,fixmystreet&status=open
  router.get('/', (req, res) => {
    const bbox = parseBbox(req.query.bbox);
    if (!bbox) return res.status(400).json({ error: 'bbox=minLng,minLat,maxLng,maxLat is required' });
    const list = (v) => (typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
    const statuses = list(req.query.status)?.filter((s) => STATUSES.has(s));
    const rows = queryReports(db, { bbox, sources: list(req.query.sources), statuses });
    ingestor?.ensureFresh(bbox); // new upstream reports arrive over the live stream
    res.json({
      type: 'FeatureCollection',
      features: rows.map((r) => ({
        type: 'Feature',
        id: r.id,
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: { ...r },
      })),
    });
  });

  router.get('/:id', (req, res) => {
    const report = getReport(db, Number(req.params.id));
    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json(report);
  });

  router.post('/', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }), upload.array('photos', MAX_PHOTOS), async (req, res) => {
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (!inUK(lat, lng)) return res.status(400).json({ error: 'Location must be a valid point in the UK' });

    const severity = SEVERITIES.has(req.body.severity) ? req.body.severity : undefined;
    let depthMm = req.body.depthMm === undefined || req.body.depthMm === '' ? undefined : Math.round(Number(req.body.depthMm));
    if (depthMm !== undefined && !(depthMm > 0 && depthMm < 1000)) return res.status(400).json({ error: 'Depth must be between 1 and 999 mm' });

    const photos = [];
    for (const file of req.files ?? []) {
      const ext = sniffImage(file.buffer);
      if (!ext) return res.status(400).json({ error: `${file.originalname} is not a JPEG, PNG or WebP image` });
      photos.push({ ext, buffer: ext === 'jpg' ? stripJpegMetadata(file.buffer) : file.buffer });
    }

    let authority;
    try { authority = (await lookupAuthority?.(lat, lng))?.authority?.name; } catch { /* offline: leave blank */ }

    const id = createReport(db, {
      lat, lng, severity, depthMm, authority,
      title: cleanText(req.body.title, 120) ?? 'Pothole',
      description: cleanText(req.body.description, 2000),
    });
    for (const p of photos) {
      const filename = `${id}-${crypto.randomBytes(8).toString('hex')}.${p.ext}`;
      fs.writeFileSync(path.join(uploadDir, filename), p.buffer);
      addPhoto(db, id, filename);
    }

    const report = getReport(db, id);
    live.publish('report', {
      id, source: 'user', lat, lng, title: report.title, severity, status: 'open',
      reported_at: report.reported_at, photo_count: photos.length, confirmations: 0,
    });
    res.status(201).json(report);
  });

  // "I've seen it too" – strengthens the record that the authority was on notice.
  router.post('/:id/confirm', rateLimit({ windowMs: 60 * 60 * 1000, max: 60 }), (req, res) => {
    const id = Number(req.params.id);
    if (!confirmReport(db, id)) return res.status(404).json({ error: 'Not found' });
    const report = getReport(db, id);
    live.publish('confirm', { id, confirmations: report.confirmations });
    res.json({ id, confirmations: report.confirmations });
  });

  router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each photo must be under 10 MB'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Up to ${MAX_PHOTOS} photos per report` : err.message;
      return res.status(400).json({ error: msg });
    }
    next(err);
  });

  return router;
}
