import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, jpegWithExif } from './helpers.js';

let t;
before(async () => { t = await startApp(); });
after(async () => { await t.close(); });

const LONDON = { lat: 51.5007, lng: -0.1246 };
const LONDON_BBOX = '-0.2,51.45,0,51.55';

function reportForm(fields, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
  for (const f of files) fd.append('photos', new Blob([f.buffer], { type: f.type }), f.name);
  return fd;
}

test('creates a report with a photo, strips EXIF, and returns it in bbox queries', async () => {
  const res = await fetch(`${t.base}/api/reports`, {
    method: 'POST',
    body: reportForm({ ...LONDON, title: 'Big one', severity: 'severe', depthMm: 60, description: 'Near the kerb' },
      [{ buffer: jpegWithExif(), type: 'image/jpeg', name: 'p.jpg' }]),
  });
  assert.equal(res.status, 201);
  const report = await res.json();
  assert.equal(report.title, 'Big one');
  assert.equal(report.severity, 'severe');
  assert.equal(report.depth_mm, 60);
  assert.equal(report.authority, 'Test County Council');
  assert.equal(report.photos.length, 1);

  const saved = fs.readFileSync(path.join(t.uploadDir, path.basename(report.photos[0])));
  assert.ok(!saved.includes('GPS-SECRET-LOCATION'), 'EXIF should be stripped');
  assert.equal(saved[0], 0xff);

  const photoRes = await fetch(`${t.base}${report.photos[0]}`);
  assert.equal(photoRes.status, 200);

  const list = await (await fetch(`${t.base}/api/reports?bbox=${LONDON_BBOX}`)).json();
  assert.equal(list.type, 'FeatureCollection');
  const f = list.features.find((x) => x.id === report.id);
  assert.ok(f);
  assert.deepEqual(f.geometry.coordinates, [LONDON.lng, LONDON.lat]);
  assert.equal(f.properties.photo_count, 1);

  const elsewhere = await (await fetch(`${t.base}/api/reports?bbox=-3,53,-2,54`)).json();
  assert.ok(!elsewhere.features.some((x) => x.id === report.id));
});

test('rejects locations outside the UK and bad input', async () => {
  let res = await fetch(`${t.base}/api/reports`, { method: 'POST', body: reportForm({ lat: 48.85, lng: 2.35 }) });
  assert.equal(res.status, 400);
  res = await fetch(`${t.base}/api/reports`, { method: 'POST', body: reportForm({ ...LONDON, depthMm: -5 }) });
  assert.equal(res.status, 400);
  res = await fetch(`${t.base}/api/reports`, {
    method: 'POST',
    body: reportForm(LONDON, [{ buffer: Buffer.from('<svg onload=alert(1)>'), type: 'image/jpeg', name: 'x.jpg' }]),
  });
  assert.equal(res.status, 400);
  res = await fetch(`${t.base}/api/reports?bbox=nonsense`);
  assert.equal(res.status, 400);
});

test('confirm increments the count', async () => {
  const report = await (await fetch(`${t.base}/api/reports`, { method: 'POST', body: reportForm(LONDON) })).json();
  const res = await fetch(`${t.base}/api/reports/${report.id}/confirm`, { method: 'POST' });
  assert.deepEqual(await res.json(), { id: report.id, confirmations: 1 });
  assert.equal((await fetch(`${t.base}/api/reports/999999/confirm`, { method: 'POST' })).status, 404);
});

test('live stream pushes new reports', async () => {
  const ac = new AbortController();
  const stream = await fetch(`${t.base}/api/stream`, { signal: ac.signal });
  const reader = stream.body.getReader();
  const dec = new TextDecoder();
  await reader.read(); // retry preamble

  await fetch(`${t.base}/api/reports`, { method: 'POST', body: reportForm({ lat: 53.48, lng: -2.24, title: 'Manchester' }) });
  let text = '';
  while (!text.includes('Manchester')) text += dec.decode((await reader.read()).value);
  assert.match(text, /event: report/);
  ac.abort();
});

test('authority lookup validates input', async () => {
  assert.equal((await fetch(`${t.base}/api/authority?lat=0&lng=0`)).status, 400);
  const ok = await (await fetch(`${t.base}/api/authority?lat=51.5&lng=-0.12`)).json();
  assert.equal(ok.authority.name, 'Test County Council');
});

test('serves pages and vendor assets', async () => {
  for (const p of ['/', '/liability', '/sources', '/vendor/leaflet/leaflet.js', '/vendor/markercluster/leaflet.markercluster.js']) {
    assert.equal((await fetch(`${t.base}${p}`)).status, 200, p);
  }
});
