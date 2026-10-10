// Convert Ordnance Survey National Grid eastings/northings (EPSG:27700) to WGS84
// latitude/longitude. Many UK council datasets publish locations this way.
// Uses the OS inverse Transverse Mercator projection followed by a 7-parameter
// Helmert transform: accurate to a few metres, plenty for plotting potholes.

const AIRY = { a: 6377563.396, b: 6356256.909 };
const GRS80 = { a: 6378137.0, b: 6356752.3141 };
const F0 = 0.9996012717;
const LAT0 = (49 * Math.PI) / 180;
const LON0 = (-2 * Math.PI) / 180;
const N0 = -100000;
const E0 = 400000;

/** Easting/northing → OSGB36 lat/lng in degrees. */
export function gridToOsgb36(E, N) {
  const { a, b } = AIRY;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n;
  const n3 = n2 * n;

  let lat = LAT0;
  let M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - LAT0);
    const Mb = (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(lat - LAT0) * Math.cos(lat + LAT0);
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (lat - LAT0)) * Math.cos(2 * (lat + LAT0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (lat - LAT0)) * Math.cos(3 * (lat + LAT0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(N - N0 - M) >= 0.00001);

  const sin = Math.sin(lat);
  const cos = Math.cos(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin * sin);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5);
  const eta2 = nu / rho - 1;
  const tan = Math.tan(lat);
  const tan2 = tan * tan;
  const tan4 = tan2 * tan2;
  const tan6 = tan4 * tan2;
  const sec = 1 / cos;
  const nu3 = nu * nu * nu;
  const nu5 = nu3 * nu * nu;
  const nu7 = nu5 * nu * nu;

  const VII = tan / (2 * rho * nu);
  const VIII = (tan / (24 * rho * nu3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
  const IX = (tan / (720 * rho * nu5)) * (61 + 90 * tan2 + 45 * tan4);
  const X = sec / nu;
  const XI = (sec / (6 * nu3)) * (nu / rho + 2 * tan2);
  const XII = (sec / (120 * nu5)) * (5 + 28 * tan2 + 24 * tan4);
  const XIIA = (sec / (5040 * nu7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);

  const dE = E - E0;
  const latR = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
  const lonR = LON0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;
  return { lat: (latR * 180) / Math.PI, lng: (lonR * 180) / Math.PI };
}

function toCartesian(latDeg, lngDeg, { a, b }) {
  const lat = (latDeg * Math.PI) / 180;
  const lng = (lngDeg * Math.PI) / 180;
  const e2 = 1 - (b * b) / (a * a);
  const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return {
    x: nu * Math.cos(lat) * Math.cos(lng),
    y: nu * Math.cos(lat) * Math.sin(lng),
    z: nu * (1 - e2) * Math.sin(lat),
  };
}

function fromCartesian({ x, y, z }, { a, b }) {
  const e2 = 1 - (b * b) / (a * a);
  const p = Math.sqrt(x * x + y * y);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(z + e2 * nu * Math.sin(lat), p);
  }
  return { lat: (lat * 180) / Math.PI, lng: (Math.atan2(y, x) * 180) / Math.PI };
}

// OSGB36 → WGS84 Helmert parameters (inverse of the published WGS84 → OSGB36 set).
const TX = 446.448, TY = -125.157, TZ = 542.06; // metres
const S = -20.4894e-6;                           // scale (ppm → unitless)
const arcsec = Math.PI / (180 * 3600);
const RX = 0.1502 * arcsec, RY = 0.247 * arcsec, RZ = 0.8421 * arcsec;

/** Easting/northing → WGS84 { lat, lng } in degrees. */
export function gridToWgs84(E, N) {
  const osgb = gridToOsgb36(E, N);
  const c = toCartesian(osgb.lat, osgb.lng, AIRY);
  const out = {
    x: TX + (1 + S) * c.x - RZ * c.y + RY * c.z,
    y: TY + RZ * c.x + (1 + S) * c.y - RX * c.z,
    z: TZ - RY * c.x + RX * c.y + (1 + S) * c.z,
  };
  const r = fromCartesian(out, GRS80);
  return { lat: Math.round(r.lat * 1e6) / 1e6, lng: Math.round(r.lng * 1e6) / 1e6 };
}
