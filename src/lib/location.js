export function validCoordinates(value) {
  return Boolean(value && typeof value === 'object' && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180);
}

export function cleanCoordinates(value) {
  if (value == null) return null;
  if (!validCoordinates(value)) throw new Error('Choose a valid GPS location.');
  return { latitude: value.latitude, longitude: value.longitude };
}

export function locationQuery(address, location) {
  return validCoordinates(location) ? location.latitude.toFixed(6) + ', ' + location.longitude.toFixed(6) : String(address || '');
}

export function locationMapUrl(address, location) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(locationQuery(address, location));
}

export const LIVE_LOCATION_MAX_AGE = 90000;
export const LIVE_LOCATION_INTERVAL = 15000;

export function locationIsFresh(location, now = Date.now()) {
  const updated = typeof location?.updatedAt?.toMillis === 'function' ? location.updatedAt.toMillis() : location?.updatedAt;
  return Boolean(location?.sharing && validCoordinates(location) && Number.isFinite(updated) && now - updated >= -10000 && now - updated < LIVE_LOCATION_MAX_AGE);
}

export async function lookupGpsAddress(location, account, { signal, fetchImpl = fetch } = {}) {
  const pin = cleanCoordinates(location);
  if (!pin || !account?.getIdToken) throw new Error('Sign in to look up your GPS address.');
  const token = await account.getIdToken();
  const timeout = AbortSignal.timeout(12000);
  const response = await fetchImpl('/api/gps-address?latitude=' + pin.latitude + '&longitude=' + pin.longitude, {
    headers: { Authorization: 'Bearer ' + token }, signal: signal && AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal || timeout,
  });
  if (!response.ok) throw new Error('The GPS address could not be found.');
  const result = await response.json();
  if (typeof result.address !== 'string' || !result.address.trim() || result.address.length > 250) throw new Error('The GPS address could not be found.');
  return result.address.trim();
}
