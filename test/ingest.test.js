import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, queryReports } from '../src/db.js';
import { createIngestor } from '../src/ingest/index.js';
import { parsePins } from '../src/ingest/fixmystreet.js';
import { parseGeoJson } from '../src/ingest/geojson.js';
import { parseCsv } from '../src/ingest/csv.js';
import { stripJpegMetadata } from '../src/lib/jpeg.js';
import { gridToOsgb36, gridToWgs84 } from '../src/lib/osgb.js';
import { jpegWithExif, quietLog } from './helpers.js';

const UK = { minLng: -9, minLat: 49, maxLng: 2, maxLat: 61 };
const jsonResponse = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

test('FixMyStreet pins are parsed and mapped to statuses', () => {
  const recs = parsePins({ pins: [
    [51.5, -0.12, 'yellow', 101, 'Pothole on High St', 'normal', false],
    [51.51, -0.13, 'green', 102, 'Fixed pothole', 'normal', false],
    [48.0, 2.0, 'red', 103, 'Not in UK'],
  ] }, { id: 'fixmystreet', baseUrl: 'https://www.fixmystreet.com/' });
  assert.equal(recs.length, 2);
  assert.equal(recs[0].status, 'open');
  assert.equal(recs[1].status, 'fixed');
  assert.equal(recs[0].url, 'https://www.fixmystreet.com/report/101');
});

test('bbox sources are fetched per tile, cached, and stored', async () => {
  const db = openDb(':memory:');
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse({ pins: [[51.5007, -0.1246, 'yellow', 7, 'Pothole']] });
  };
  const published = [];
  const ing = createIngestor(db, [{ id: 'fixmystreet', type: 'fixmystreet', baseUrl: 'https://fms.test', categories: ['Potholes'] }],
    { fetchImpl, publish: (e, d) => published.push(d), log: quietLog });

  const bbox = { minLng: -0.13, minLat: 51.495, maxLng: -0.12, maxLat: 51.505 };
  await Promise.all(ing.ensureFresh(bbox));
  assert.ok(urls.length >= 1);
  assert.match(urls[0], /\/around\?ajax=1&bbox=/);
  assert.match(urls[0], /filter_category=Potholes/);
  assert.equal(queryReports(db, { bbox: UK }).length, 1);
  assert.equal(published.length, 1, 'duplicate pins from neighbouring tiles are only published once');

  const before = urls.length;
  await Promise.all(ing.ensureFresh(bbox));
  assert.equal(urls.length, before, 'second call within TTL uses cache');

  assert.deepEqual(ing.ensureFresh(UK), [], 'country-wide view does not hit upstream');
});

test('ArcGIS bulk source pages through results and applies mapping', async () => {
  const db = openDb(':memory:');
  const pages = [
    { features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-1.55, 53.8] }, properties: { OBJECTID: 1, LOCATION: 'Briggate', STATUS: 'Repaired', REPORTED: 1700000000000 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-1.56, 53.81] }, properties: { OBJECTID: 2, LOCATION: 'Headrow', STATUS: 'Logged', REPORTED: 1700000000000 } },
    ], properties: { exceededTransferLimit: true } },
    { features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-1.57, 53.82] }, properties: { OBJECTID: 3, LOCATION: 'Kirkgate', STATUS: 'Logged' } },
    ] },
  ];
  let call = 0;
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/FeatureServer\/0\/query\?/);
    return jsonResponse(pages[call++]);
  };
  const ing = createIngestor(db, [{
    id: 'leeds', type: 'arcgis', url: 'https://arcgis.test/FeatureServer/0', pageSize: 2, authority: 'Leeds City Council',
    fields: { id: 'OBJECTID', title: 'LOCATION', status: 'STATUS', reportedAt: 'REPORTED' },
  }], { fetchImpl, log: quietLog });
  const res = await ing.syncAllBulk();
  assert.equal(res.leeds.inserted, 3);
  const rows = queryReports(db, { bbox: UK });
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.title === 'Briggate').status, 'fixed');

  // re-sync with nothing changed → no updates
  call = 0;
  const again = await ing.syncAllBulk();
  assert.equal(again.leeds.inserted, 0);
  assert.equal(again.leeds.updated, 0);
});

test('failed sources are recorded, not thrown', async () => {
  const db = openDb(':memory:');
  const ing = createIngestor(db, [{ id: 'broken', type: 'geojson', url: 'https://x.test/a.geojson', fields: {} }],
    { fetchImpl: async () => new Response('nope', { status: 503 }), log: quietLog });
  const res = await ing.syncAllBulk();
  assert.match(res.broken.error, /503/);
  const row = db.prepare('SELECT * FROM source_status WHERE source = ?').get('broken');
  assert.match(row.last_error, /503/);
});

test('GeoJSON filter and British National Grid detection', () => {
  const recs = parseGeoJson({ features: [
    { id: 'a', geometry: { type: 'Point', coordinates: [530000, 180500] }, properties: { category: 'Pothole' } },
    { id: 'b', geometry: { type: 'Point', coordinates: [-0.1, 51.5] }, properties: { category: 'Streetlight', ref: 'b' } },
  ] }, { id: 'g', fields: { id: 'ref' }, filter: { field: 'category', values: ['pothole'] } });
  assert.equal(recs.length, 0, 'BNG record has no ref id; streetlight is filtered');

  const ok = parseGeoJson({ features: [
    { id: 'a', geometry: { type: 'Point', coordinates: [530000, 180500] }, properties: { category: 'Pothole', ref: 'a' } },
  ] }, { id: 'g', fields: { id: 'ref' }, filter: { field: 'category', values: ['pothole'] } });
  assert.equal(ok.length, 1);
  assert.ok(Math.abs(ok[0].lat - 51.5085) < 0.001 && Math.abs(ok[0].lng + 0.1282) < 0.001);
});

test('CSV parser handles quotes, commas and BOM', () => {
  const rows = parseCsv('﻿Job,Street,Notes\r\n1,"High St, North","Said ""deep"""\r\n2,Low Rd,\n');
  assert.deepEqual(rows, [
    { Job: '1', Street: 'High St, North', Notes: 'Said "deep"' },
    { Job: '2', Street: 'Low Rd', Notes: '' },
  ]);
});

test('OS grid conversion matches Ordnance Survey worked example', () => {
  const o = gridToOsgb36(651409.903, 313177.270);
  assert.ok(Math.abs(o.lat - 52.657570) < 1e-6);
  assert.ok(Math.abs(o.lng - 1.717922) < 1e-6);
  const w = gridToWgs84(651409.903, 313177.270);
  assert.ok(Math.abs(w.lat - 52.65798) < 2e-5 && Math.abs(w.lng - 1.71605) < 2e-5);
});

test('JPEG metadata stripping keeps image data', () => {
  const src = jpegWithExif();
  const out = stripJpegMetadata(src);
  assert.ok(!out.includes('GPS-SECRET-LOCATION'));
  assert.ok(out.length < src.length);
  assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(stripJpegMetadata(png), png);
});
