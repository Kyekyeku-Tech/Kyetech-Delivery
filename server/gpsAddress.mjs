import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { validCoordinates } from '../src/lib/location.js';

export function formatGpsAddress(result) {
  const a = result?.address || {};
  const road = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' ');
  const parts = [road, a.neighbourhood || a.suburb || a.quarter, a.city || a.town || a.village || a.municipality, a.state || a.region, a.country];
  const address = [...new Set(parts.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].join(', ');
  const fallback = typeof result?.display_name === 'string' ? result.display_name.trim() : '';
  return (address || fallback).slice(0, 250);
}

export function formatGpsLocality(result) {
  const a = result?.address || {};
  const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const first = keys => keys.map(key => clean(a[key])).find(Boolean) || '';
  const area = first(['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet']);
  const town = first(['town', 'city', 'municipality']);
  const parts = [area, town].filter(Boolean);
  if (!parts.length) {
    // A geocoder name can be a shop or road; only use it when the provider identifies a place.
    const placeTypes = new Set(['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet', 'town', 'city', 'municipality', 'city_district', 'district', 'county', 'state_district', 'state', 'region']);
    if (placeTypes.has(result?.addresstype || result?.type)) {
      const displayName = typeof result?.display_name === 'string' ? result.display_name : '';
      const name = clean(result?.name) || clean(displayName.split(',')[0]);
      if (name) parts.push(name);
    }
  }
  if (!parts.length) {
    const district = first(['city_district', 'district', 'county', 'state_district', 'state', 'region']);
    if (district) parts.push(district);
  }
  return parts.filter((part, index) => parts.findIndex(value => value.toLowerCase() === part.toLowerCase()) === index).join(', ').slice(0, 250);
}

async function verifyGpsToken(token, projectId) {
  const name = 'kyetech-gps-auth';
  const app = getApps().find(candidate => candidate.name === name) || initializeApp({ projectId }, name);
  return getAuth(app).verifyIdToken(token);
}

// Reuse nearby lookups, and keep this worker below the public geocoder's rate limit.
export function createGpsAddressLookup({ fetchImpl = fetch, minimumInterval = 1100 } = {}) {
  const cache = new Map();
  let queue = Promise.resolve(), lastRequest = 0;
  return (location, { locality = false } = {}) => {
    if (!validCoordinates(location)) return Promise.reject(new Error('Invalid GPS pin.'));
    const key = (locality ? 'locality:' : 'address:') + location.latitude.toFixed(4) + ',' + location.longitude.toFixed(4);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < 86400000) return Promise.resolve(cached.address);
    const pending = queue.then(async () => {
      const previous = cache.get(key);
      if (previous && Date.now() - previous.at < 86400000) return previous.address;
      const delay = Math.max(0, lastRequest + minimumInterval - Date.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      lastRequest = Date.now();
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.search = new URLSearchParams({ format: 'jsonv2', lat: location.latitude, lon: location.longitude, zoom: '18', addressdetails: '1', 'accept-language': 'en' });
      const response = await fetchImpl(url, { headers: { 'User-Agent': 'KyeTechDelivery/1.0 (https://kyetechdelivery.site)', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Address lookup unavailable.');
      const result = await response.json();
      const address = locality ? formatGpsLocality(result) : formatGpsAddress(result);
      if (!address) throw new Error(locality ? 'No town or area found.' : 'No street address found.');
      if (cache.size >= 1000) cache.delete(cache.keys().next().value);
      cache.set(key, { at: Date.now(), address });
      return address;
    });
    queue = pending.catch(() => {});
    return pending;
  };
}

export function createGpsAddressMiddleware({ projectId, verify = verifyGpsToken, lookup = createGpsAddressLookup() } = {}) {
  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = (status, message) => { response.statusCode = status; response.end(JSON.stringify({ message })); };
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return fail(405, 'Use GET for GPS addresses.'); }
    const url = new URL(request.url, 'http://localhost');
    const latitude = url.searchParams.get('latitude'), longitude = url.searchParams.get('longitude');
    const locality = url.searchParams.get('locality') === '1';
    const location = { latitude: Number(latitude), longitude: Number(longitude) };
    if (latitude === null || longitude === null || !latitude.trim() || !longitude.trim() || !validCoordinates(location)) return fail(400, 'Choose a valid GPS pin.');
    const token = /^Bearer (\S+)$/.exec(request.headers.authorization || '')?.[1];
    if (!token) return fail(401, 'Sign in to look up your GPS address.');
    if (!projectId) return fail(503, 'GPS address lookup is unavailable.');
    try { await verify(token, projectId); }
    catch { return fail(401, 'Sign in again to look up your GPS address.'); }
    try {
      const address = locality ? await lookup(location, { locality: true }) : await lookup(location);
      response.statusCode = 200;
      response.end(JSON.stringify({ address }));
    } catch { return fail(503, locality ? 'GPS pin captured, but the town or area could not be found yet.' : 'GPS pin captured, but the street address could not be found. Enter an address or landmark.'); }
  };
}
