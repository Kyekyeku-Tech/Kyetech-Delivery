import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCoordinates, locationMapUrl, locationIsFresh, lookupGpsAddress } from '../src/lib/location.js';
import { createGpsAddressLookup, createGpsAddressMiddleware, formatGpsAddress } from '../server/gpsAddress.mjs';

const pin = { latitude: 4.8917, longitude: -1.7554 };
test('GPS pins keep exact directions separate from the readable address', () => {
  assert.deepEqual(cleanCoordinates({ ...pin, accuracy: 20 }), pin);
  assert.equal(new URL(locationMapUrl('Market Circle, Takoradi', pin)).searchParams.get('query'), '4.891700, -1.755400');
  for (const value of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: Infinity }, { latitude: '4.8', longitude: 0 }]) assert.throws(() => cleanCoordinates(value));
});
test('GPS addresses include street, area, town, region and country without duplicates', () => {
  assert.equal(formatGpsAddress({ address: { house_number: '12', road: 'Market Circle', suburb: 'Takoradi', city: 'Takoradi', state: 'Western Region', country: 'Ghana' } }), '12 Market Circle, Takoradi, Western Region, Ghana');
  assert.equal(formatGpsAddress({ display_name: 'Effia, Ghana' }), 'Effia, Ghana');
  assert.equal(formatGpsAddress({}), '');
  assert.equal(formatGpsAddress({ display_name: 'x'.repeat(300) }).length, 250);
});
test('Address lookups reuse nearby results and recover after provider failures', async () => {
  let calls = 0, fail = true;
  const lookup = createGpsAddressLookup({ minimumInterval: 0, fetchImpl: async url => {
    calls += 1;
    assert.equal(url.origin, 'https://nominatim.openstreetmap.org');
    if (fail) { fail = false; return { ok: false }; }
    return { ok: true, json: async () => ({ address: { road: 'Market Circle', city: 'Takoradi', country: 'Ghana' } }) };
  } });
  await assert.rejects(lookup(pin));
  const values = await Promise.all([lookup(pin), lookup(pin)]);
  assert.deepEqual(values, ['Market Circle, Takoradi, Ghana', 'Market Circle, Takoradi, Ghana']);
  assert.equal(calls, 2);
  await assert.rejects(lookup({ latitude: NaN, longitude: 0 }));
});
test('GPS address API requires authentication and valid pins before contacting the geocoder', async () => {
  let calls = 0;
  const handler = createGpsAddressMiddleware({ projectId: 'demo-kyetech', verify: async token => { if (token !== 'valid') throw new Error(); }, lookup: async location => { calls += 1; assert.deepEqual(location, pin); return 'Market Circle, Takoradi'; } });
  async function request(url, token, method = 'GET') {
    const headers = {}, response = { setHeader: (key, value) => { headers[key] = value; }, end(body) { this.body = JSON.parse(body); } };
    await handler({ method, url, headers: { authorization: token ? 'Bearer ' + token : '' } }, response);
    assert.equal(headers['Cache-Control'], 'no-store');
    return response;
  }
  const url = '/api/gps-address?latitude=4.8917&longitude=-1.7554';
  assert.equal((await request(url)).statusCode, 401);
  assert.equal((await request(url, 'invalid')).statusCode, 401);
  assert.equal((await request('/api/gps-address?latitude=91&longitude=0', 'valid')).statusCode, 400);
  assert.equal((await request('/api/gps-address?latitude=&longitude=', 'valid')).statusCode, 400);
  assert.equal((await request(url, 'valid', 'POST')).statusCode, 405);
  assert.equal(calls, 0);
  assert.equal((await request(url, 'valid')).body.address, 'Market Circle, Takoradi');
  assert.equal(calls, 1);
});
test('Browser GPS address lookup uses the signed-in token and fails safely', async () => {
  const account = { getIdToken: async () => 'fixture-token' };
  assert.equal(await lookupGpsAddress(pin, account, { fetchImpl: async (url, options) => {
    assert.equal(new URL(url, 'https://example.invalid').pathname, '/api/gps-address');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    return { ok: true, json: async () => ({ address: 'Market Circle, Takoradi' }) };
  } }), 'Market Circle, Takoradi');
  await assert.rejects(lookupGpsAddress(pin, null));
  await assert.rejects(lookupGpsAddress(pin, account, { fetchImpl: async () => ({ ok: false }) }));
});
test('Stopped, invalid, old or future rider positions never appear live', () => {
  const now = 200000, location = { ...pin, sharing: true, updatedAt: now - 15000 };
  assert.ok(locationIsFresh(location, now));
  assert.equal(locationIsFresh({ ...location, sharing: false }, now), false);
  assert.equal(locationIsFresh({ ...location, updatedAt: now - 90000 }, now), false);
  assert.equal(locationIsFresh({ ...location, updatedAt: now + 60000 }, now), false);
  assert.equal(locationIsFresh({ ...location, latitude: Infinity }, now), false);
});
