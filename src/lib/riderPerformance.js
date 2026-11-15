import { timestampMillis } from './domain.js';

const DAY = 86400000;
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function getRiderPerformance(orders, riderId, now = Date.now()) {
  const own = riderId ? orders.filter(order => order.riderId === riderId) : [];
  const completed = own.filter(order => order.status === 'delivered');
  const closedCount = completed.length + own.filter(order => order.status === 'cancelled').length;
  // Trips still in progress are excluded from the completion rate.
  const completionRate = closedCount ? completed.length / closedCount * 100 : null;
  const durations = completed.flatMap(order => {
    const pickup = timestampMillis(order.pickedUpAt), delivery = timestampMillis(order.deliveredAt);
    return pickup > 0 && delivery >= pickup && delivery <= now ? [(delivery - pickup) / 60000] : [];
  });
  const averageMinutes = durations.length ? durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length : null;
  const reviews = completed.filter(order => Number.isFinite(order.customerRating) && order.customerRating >= 1 && order.customerRating <= 5)
    .sort((a, b) => timestampMillis(b.customerRatedAt || b.deliveredAt || b.createdAt) - timestampMillis(a.customerRatedAt || a.deliveredAt || a.createdAt));
  const rating = reviews.length ? reviews.reduce((sum, order) => sum + order.customerRating, 0) / reviews.length : null;

  // Ghana stays on UTC, so browser timezone changes do not move deliveries to another day.
  const today = new Date(now), todayIndex = (today.getUTCDay() + 6) % 7;
  const weekStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - todayIndex * DAY;
  const weekEnd = weekStart + 7 * DAY;
  const days = DAY_NAMES.map((name, index) => ({ name, letter: name[0], date: weekStart + index * DAY, cents: 0 }));
  for (const order of completed) {
    const deliveredAt = timestampMillis(order.deliveredAt);
    if (deliveredAt < weekStart || deliveredAt >= weekEnd || deliveredAt > now || deliveredAt <= 0) continue;
    if (!Number.isFinite(order.fee) || order.fee < 0) continue;
    days[Math.floor((deliveredAt - weekStart) / DAY)].cents += Math.round(order.fee * 100);
  }
  return {
    completed, closedCount, completionRate, averageMinutes, rating, ratingCount: reviews.length, reviews,
    weekStart, weekEnd, todayIndex,
    days: days.map(({ cents, ...day }) => ({ ...day, fees: cents / 100 })),
    weeklyFees: days.reduce((sum, day) => sum + day.cents, 0) / 100,
  };
}

export function formatTripTime(minutes) {
  if (minutes == null) return '—';
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return Math.round(minutes) + ' min';
  if (minutes < 1440) return (minutes / 60).toFixed(1) + ' h';
  return (minutes / 1440).toFixed(1) + ' d';
}
