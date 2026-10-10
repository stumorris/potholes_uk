import { fetchJson } from './http.js';

// Work out which highway authority is responsible for a location, using the
// free postcodes.io reverse-geocoder (ONS data, Open Government Licence).
//
// In England's two-tier areas the *county* council is the highway authority;
// everywhere else (unitaries, London boroughs, metropolitan districts, Welsh
// and Scottish councils) it's the district-level council. Northern Ireland's
// roads are all run by DfI Roads. Motorways and trunk roads are run nationally
// - we can't tell road class from a postcode, so we always mention that.

const TRUNK = {
  England: { name: 'National Highways', url: 'https://nationalhighways.co.uk/', note: 'Motorways and major A roads (the strategic road network) in England are managed by National Highways, not the council.' },
  Scotland: { name: 'Transport Scotland', url: 'https://www.transport.gov.scot/', note: 'Motorways and trunk roads in Scotland are managed by Transport Scotland via its operating companies.' },
  Wales: { name: 'Welsh Government trunk road agents', url: 'https://traffic.wales/', note: 'Motorways and trunk roads in Wales are managed for the Welsh Government by the North & Mid Wales and South Wales trunk road agents.' },
  'Northern Ireland': null,
};

const cache = new Map();
const CACHE_MAX = 5000;

export async function lookupAuthority(lat, lng, { fetchImpl } = {}) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);

  const base = process.env.POSTCODES_API || 'https://api.postcodes.io';
  const data = await fetchJson(`${base}/postcodes?lon=${lng}&lat=${lat}&limit=1&radius=2000`, { fetchImpl, timeoutMs: 8000 });
  const pc = data?.result?.[0];
  if (!pc) return null;

  const country = pc.country;
  let authority;
  if (country === 'Northern Ireland') {
    authority = { name: 'Department for Infrastructure (DfI Roads)', url: 'https://www.nidirect.gov.uk/articles/report-pothole' };
  } else {
    authority = { name: pc.admin_county || pc.admin_district, url: null };
  }
  const result = {
    postcode: pc.postcode,
    country,
    authority,
    district: pc.admin_district,
    trunkRoads: TRUNK[country] ?? null,
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
