// Generous bounding box around the UK (incl. Northern Ireland, Shetland, Scilly).
export const UK_BOUNDS = { minLat: 49.8, maxLat: 60.95, minLng: -8.7, maxLng: 1.9 };

export function inUK(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= UK_BOUNDS.minLat && lat <= UK_BOUNDS.maxLat
    && lng >= UK_BOUNDS.minLng && lng <= UK_BOUNDS.maxLng;
}

/** Parse "minLng,minLat,maxLng,maxLat" (the Leaflet toBBoxString() order). */
export function parseBbox(str) {
  if (typeof str !== 'string') return null;
  const parts = str.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  return { minLng, minLat, maxLng, maxLat };
}

export function bboxArea(b) {
  return (b.maxLng - b.minLng) * (b.maxLat - b.minLat);
}

/** Slippy-map tile coordinates for a point. */
export function tileFor(lat, lng, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y, z };
}

export function tileBbox({ x, y, z }) {
  const n = 2 ** z;
  const lng = (tx) => (tx / n) * 360 - 180;
  const lat = (ty) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return { minLng: lng(x), maxLng: lng(x + 1), minLat: lat(y + 1), maxLat: lat(y) };
}

/** All tiles at zoom z that cover a bbox (capped to avoid runaway requests). */
export function tilesCovering(b, z, max = 16) {
  const a = tileFor(b.maxLat, b.minLng, z);
  const c = tileFor(b.minLat, b.maxLng, z);
  const tiles = [];
  for (let x = a.x; x <= c.x; x++) {
    for (let y = a.y; y <= c.y; y++) {
      tiles.push({ x, y, z });
      if (tiles.length >= max) return tiles;
    }
  }
  return tiles;
}
