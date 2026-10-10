import { fetchText } from '../lib/http.js';
import { normalise, passesFilter } from './mapping.js';

// CSV files (the most common format on data.gov.uk and council transparency pages).
// Locations can be lat/lng columns or OS grid easting/northing columns.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]?.trim()])));
}

export function createCsv(cfg, { fetchImpl } = {}) {
  return {
    id: cfg.id,
    mode: 'bulk',
    async fetchAll() {
      const records = parseCsv(await fetchText(cfg.url, { fetchImpl, timeoutMs: 60000 }));
      const out = [];
      for (const rec of records) {
        if (!passesFilter(rec, cfg.filter)) continue;
        const r = normalise(rec, undefined, cfg);
        if (r) out.push(r);
      }
      return out;
    },
  };
}
