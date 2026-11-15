import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCoordinates, locationMapUrl, locationIsFresh, lookupGpsAddress } from '../src/lib/location.js';
import { createGpsAddressLookup, createGpsAddressMiddleware, formatGpsAddress, formatGpsLocality } from '../server/gpsAddress.mjs';

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
test('Live locality uses area and town names without streets, building numbers or countries', () => {
  assert.equal(formatGpsLocality({ address: { house_number: '12', road: 'Market Circle', suburb: ' Effiakuma ', city: 'Takoradi', state: 'Western Region', country: 'Ghana' } }), 'Effiakuma, Takoradi');
  assert.equal(formatGpsLocality({ address: { quarter: 'Anaji', neighbourhood: 'Other neighbourhood', town: 'Takoradi' } }), 'Anaji, Takoradi');
  assert.equal(formatGpsLocality({ address: { neighbourhood: 'New  Takoradi', city: 'Takoradi' } }), 'New Takoradi, Takoradi');
  assert.equal(formatGpsLocality({ address: { village: 'Agona Nkwanta', municipality: 'Ahanta West' } }), 'Agona Nkwanta, Ahanta West');
  assert.equal(formatGpsLocality({ address: { hamlet: 'Eshiem' } }), 'Eshiem');
  assert.equal(formatGpsLocality({ address: { suburb: 'takoradi', city: 'Takoradi' } }), 'takoradi');
});
test('Live locality falls back only to actual area or provider-identified place names', () => {
  assert.equal(formatGpsLocality({ address: { city_district: 'Sekondi-Takoradi' } }), 'Sekondi-Takoradi');
  assert.equal(formatGpsLocality({ address: { state: 'Western Region', country: 'Ghana' } }), 'Western Region');
  assert.equal(formatGpsLocality({ addresstype: 'town', name: 'Sekondi' }), 'Sekondi');
  assert.equal(formatGpsLocality({ address: { state: 'Western Region', country: 'Ghana' }, addresstype: 'town', name: 'Sekondi' }), 'Sekondi');
  assert.equal(formatGpsLocality({ address: { region: 'Western Region' }, addresstype: 'city', display_name: 'Takoradi, Western Region, Ghana' }), 'Takoradi');
  assert.equal(formatGpsLocality({ type: 'village', display_name: 'Eshiem, Western Region, Ghana' }), 'Eshiem');
  for (const result of [{}, { address: { road: 'Market Circle', country: 'Ghana' } }, { name: 'A shop', display_name: 'A shop, Takoradi, Ghana', addresstype: 'shop' }, { display_name: '12 Road, Takoradi, Ghana' }, { addresstype: 'town', display_name: 42, name: null }]) assert.equal(formatGpsLocality(result), '');
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
test('Locality and full address lookups keep separate caches for the same GPS pin', async () => {
  let calls = 0;
  const lookup = createGpsAddressLookup({ minimumInterval: 0, fetchImpl: async () => {
    calls += 1;
    return { ok: true, json: async () => ({ address: { house_number: '12', road: 'Market Circle', suburb: 'Effiakuma', city: 'Takoradi', country: 'Ghana' } }) };
  } });
  assert.equal(await lookup(pin), '12 Market Circle, Effiakuma, Takoradi, Ghana');
  assert.equal(await lookup(pin, { locality: true }), 'Effiakuma, Takoradi');
  assert.equal(await lookup(pin), '12 Market Circle, Effiakuma, Takoradi, Ghana');
  assert.equal(await lookup(pin, { locality: true }), 'Effiakuma, Takoradi');
  assert.equal(calls, 2);
});
test('Missing locality never returns a street address as the rider town', async () => {
  const lookup = createGpsAddressLookup({ minimumInterval: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ address: { road: 'Market Circle', country: 'Ghana' }, display_name: 'Market Circle, Ghana' }) }) });
  await assert.rejects(lookup(pin, { locality: true }), /No town or area found/);
  assert.equal(await lookup(pin), 'Market Circle, Ghana');
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
test('GPS API selects locality mode only when requested and preserves full address default', async () => {
  const calls = [];
  const handler = createGpsAddressMiddleware({ projectId: 'demo-kyetech', verify: async () => {}, lookup: async (location, options) => {
    calls.push({ location, options });
    return options?.locality ? 'Takoradi' : 'Market Circle, Takoradi, Ghana';
  } });
  async function request(suffix) {
    const response = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
    await handler({ method: 'GET', url: '/api/gps-address?latitude=4.8917&longitude=-1.7554' + suffix, headers: { authorization: 'Bearer fixture-token' } }, response);
    assert.equal(response.statusCode, 200);
    return response.body;
  }
  assert.deepEqual(await request('&locality=1'), { address: 'Takoradi' });
  assert.deepEqual(await request(''), { address: 'Market Circle, Takoradi, Ghana' });
  assert.deepEqual(await request('&locality=0'), { address: 'Market Circle, Takoradi, Ghana' });
  assert.deepEqual(calls[0], { location: pin, options: { locality: true } });
  assert.equal(calls[1].options, undefined);
  assert.equal(calls[2].options, undefined);
});
test('Browser GPS address lookup uses the signed-in token and fails safely', async () => {
  const account = { getIdToken: async () => 'fixture-token' };
  assert.equal(await lookupGpsAddress(pin, account, { fetchImpl: async (url, options) => {
    assert.equal(new URL(url, 'https://example.invalid').pathname, '/api/gps-address');
    assert.equal(new URL(url, 'https://example.invalid').searchParams.has('locality'), false);
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    return { ok: true, json: async () => ({ address: 'Market Circle, Takoradi' }) };
  } }), 'Market Circle, Takoradi');
  await assert.rejects(lookupGpsAddress(pin, null));
  await assert.rejects(lookupGpsAddress(pin, account, { fetchImpl: async () => ({ ok: false }) }));
});
test('Browser live-area lookups request locality while preserving the authenticated exact GPS pin', async () => {
  const account = { getIdToken: async () => 'fixture-token' };
  assert.equal(await lookupGpsAddress(pin, account, { locality: true, fetchImpl: async (url, options) => {
    const query = new URL(url, 'https://example.invalid').searchParams;
    assert.equal(query.get('locality'), '1');
    assert.equal(query.get('latitude'), '4.8917');
    assert.equal(query.get('longitude'), '-1.7554');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    return { ok: true, json: async () => ({ address: 'Takoradi' }) };
  } }), 'Takoradi');
});
test('Stopped, invalid, old or future rider positions never appear live', () => {
  const now = 200000, location = { ...pin, sharing: true, updatedAt: now - 15000 };
  assert.ok(locationIsFresh(location, now));
  assert.equal(locationIsFresh({ ...location, sharing: false }, now), false);
  assert.equal(locationIsFresh({ ...location, updatedAt: now - 90000 }, now), false);
  assert.equal(locationIsFresh({ ...location, updatedAt: now + 60000 }, now), false);
  assert.equal(locationIsFresh({ ...location, latitude: Infinity }, now), false);
});
