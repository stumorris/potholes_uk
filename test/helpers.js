import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createApp } from '../src/server.js';

export const quietLog = { info() {}, warn() {}, error() {} };

export async function startApp(opts = {}) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'potholes-test-'));
  const ctx = createApp({
    db: openDb(':memory:'),
    sourceConfigs: [],
    uploadDir,
    lookupAuthority: async () => ({ authority: { name: 'Test County Council' }, country: 'England' }),
    log: quietLog,
    ...opts,
  });
  const server = await new Promise((resolve) => { const s = ctx.app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...ctx, base, uploadDir,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}

/** A minimal JPEG containing an EXIF APP1 segment with a fake GPS marker. */
export function jpegWithExif() {
  const soi = Buffer.from([0xff, 0xd8]);
  const exifPayload = Buffer.from('Exif\0\0GPS-SECRET-LOCATION');
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exifPayload.length + 2), exifPayload]);
  const dqt = Buffer.concat([Buffer.from([0xff, 0xdb]), u16(4), Buffer.from([0, 1])]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
  return Buffer.concat([soi, app1, dqt, sos]);
}
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
