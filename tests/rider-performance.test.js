import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTripTime, getRiderPerformance } from '../src/lib/riderPerformance.js';

const now = Date.parse('2026-11-14T18:30:00Z');
const trip = (id, patch = {}) => ({ id, riderId: 'rider-one', status: 'delivered', fee: 25, ...patch });

test('weekly earnings use Ghana Monday-to-Sunday dates, completed trips and exact cents', () => {
  const records = [
    trip('previous-week', { deliveredAt: Date.parse('2026-11-08T23:59:59Z'), fee: 999 }),
    trip('monday', { deliveredAt: { seconds: Date.parse('2026-11-09T00:00:00Z') / 1000 }, fee: 15.25 }),
    trip('tuesday-one', { deliveredAt: Date.parse('2026-11-10T12:00:00Z'), fee: 15.1 }),
    trip('tuesday-two', { deliveredAt: Date.parse('2026-11-10T23:59:59Z'), fee: 15.2 }),
    trip('saturday', { deliveredAt: now, fee: 320 }),
    trip('future-today', { deliveredAt: now + 60000, fee: 500 }),
    trip('sunday', { deliveredAt: Date.parse('2026-11-15T00:00:00Z'), fee: 500 }),
    trip('next-week', { deliveredAt: Date.parse('2026-11-16T00:00:00Z'), fee: 500 }),
    trip('active', { status: 'picked_up', deliveredAt: now, fee: 500 }),
    trip('cancelled', { status: 'cancelled', deliveredAt: now, fee: 500 }),
    trip('foreign', { riderId: 'another-rider', deliveredAt: now, fee: 10000 }),
    trip('missing-date', { fee: 500 }),
    trip('invalid-fee', { deliveredAt: now, fee: NaN }),
  ];
  const result = getRiderPerformance(records, 'rider-one', now);
  assert.equal(result.weekStart, Date.parse('2026-11-09T00:00:00Z'));
  assert.equal(result.weekEnd, Date.parse('2026-11-16T00:00:00Z'));
  assert.equal(result.todayIndex, 5);
  assert.deepEqual(result.days.map(day => day.fees), [15.25, 30.3, 0, 0, 0, 320, 0]);
  assert.equal(result.weeklyFees, 365.55);
});

test('completion, pickup-to-drop-off duration, and reviews use the assigned rider’s actual records', () => {
  const records = [
    trip('one', { assignedAt: now - 40 * 60000, pickedUpAt: now - 18 * 60000, deliveredAt: now, customerRating: 5, customerRatedAt: now - 1000 }),
    trip('two', { pickedUpAt: { seconds: (now - 22 * 60000) / 1000 }, deliveredAt: { seconds: now / 1000 }, customerRating: 4, customerRatedAt: now }),
    trip('bad-duration', { pickedUpAt: now, deliveredAt: now - 1000, customerRating: 99 }),
    trip('missing-duration'),
    trip('cancelled', { status: 'cancelled' }),
    trip('still-active', { status: 'accepted' }),
    trip('foreign', { riderId: 'another-rider', customerRating: 1, pickedUpAt: now - 600 * 60000, deliveredAt: now }),
  ];
  const result = getRiderPerformance(records, 'rider-one', now);
  assert.equal(result.closedCount, 5);
  assert.equal(result.completionRate, 80);
  assert.equal(result.averageMinutes, 20);
  assert.equal(result.rating, 4.5);
  assert.equal(result.ratingCount, 2);
  assert.deepEqual(result.reviews.map(order => order.id), ['two', 'one']);
});

test('week boundaries remain correct on Sunday, Monday and across a year change', () => {
  for (const [date, start, index] of [
    ['2026-01-01T12:00:00Z', '2025-12-29T00:00:00Z', 3],
    ['2026-01-04T23:59:59Z', '2025-12-29T00:00:00Z', 6],
    ['2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z', 0],
  ]) {
    const result = getRiderPerformance([], 'rider-one', Date.parse(date));
    assert.equal(result.weekStart, Date.parse(start));
    assert.equal(result.todayIndex, index);
  }
});

test('empty records show unavailable metrics, zero weekly fees and compact duration units', () => {
  const result = getRiderPerformance([], 'rider-one', now);
  assert.equal(result.completionRate, null);
  assert.equal(result.averageMinutes, null);
  assert.equal(result.rating, null);
  assert.equal(result.weeklyFees, 0);
  assert.deepEqual(result.days.map(day => day.fees), [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(formatTripTime(null), '—');
  assert.equal(formatTripTime(0.5), '<1 min');
  assert.equal(formatTripTime(18), '18 min');
  assert.equal(formatTripTime(90), '1.5 h');
  assert.equal(formatTripTime(2880), '2.0 d');
});
