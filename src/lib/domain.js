export const MIN_DELIVERY_FEE = 15;
export const ROLES = ['customer', 'rider', 'merchant'];
export const ORDER_STATUSES = ['pending', 'accepted', 'picked_up', 'delivered', 'cancelled'];
export const STATUS_LABELS = { pending: 'Finding a rider', accepted: 'Rider assigned', picked_up: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
export const BIKE_CATALOG = [
  { brand: 'Apsonic', logo: '/images/apsonic_logo.png', models: [{ name: 'AP 125', image: '/images/apsonic_125.png' }, { name: 'Jungle', image: '/images/Apsonic-Jungle.webp' }, { name: 'Zone One', image: '/images/Apsonic_Zone_One.png' }] },
  { brand: 'Royal', logo: '/images/royal_logo.png', models: [{ name: '125 Flat', image: '/images/royal_125_flat.png' }, { name: 'Flat', image: '/images/Royal_flat.png' }, { name: 'Jungle', image: '/images/royal_jungle.png' }] },
  { brand: 'Boxer', logo: '/images/boxer_logo.png', models: [{ name: '150', image: '/images/Boxer_150.png' }] },
  { brand: 'Other', logo: '/images/others_bike.png', models: [{ name: 'Other motorcycle', image: '/images/others_bike.png' }] },
];
export const CITIES = ['Sekondi–Takoradi', 'Takoradi', 'Sekondi', 'Effia', 'Kojokrom', 'Shama'];
export function formatMoney(value) { return 'GH₵ ' + Number(value || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export const formatCurrency = formatMoney;
export function normalizeGhanaPhone(value) {
  const digits = String(value || '').replace(/[\s()+.-]/g, '');
  if (/^0[235]\d{8}$/.test(digits)) return '+233' + digits.slice(1);
  if (/^233[235]\d{8}$/.test(digits)) return '+' + digits;
  return '';
}
export function isSafeImageUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return false;
  if (/^\/images\/[A-Za-z0-9_.-]+$/.test(value) && !value.includes('..')) return true;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
}
export function validateImageUrl(value) { const url = String(value || '').trim(); if (url && !isSafeImageUrl(url)) throw new Error('Use an http or https image URL.'); return url; }
export function validateFee(value) {
  const fee = Number(value);
  if (!Number.isFinite(fee) || fee < MIN_DELIVERY_FEE || fee > 10000) throw new Error('Offer a delivery fee between GH₵ 15 and GH₵ 10,000.');
  if (Math.abs(fee * 100 - Math.round(fee * 100)) > 0.000001) throw new Error('Use at most two decimal places for the delivery fee.');
  return Math.round(fee * 100) / 100;
}
export function requireText(value, label, maxLength = 250) { const text = String(value || '').trim(); if (!text) throw new Error(label + ' is required.'); if (text.length > maxLength) throw new Error(label + ' must be ' + maxLength + ' characters or fewer.'); return text; }
export function requirePhone(value, label = 'Phone number') { const phone = normalizeGhanaPhone(value); if (!phone) throw new Error('Enter a valid Ghana ' + label.toLowerCase() + ' (for example, 024 123 4567).'); return phone; }
export function nextOrderStatus(status) { return ({ accepted: 'picked_up', picked_up: 'delivered' })[status] || null; }
export function canTransitionOrder(from, to) { return ({ pending: ['accepted', 'cancelled'], accepted: ['picked_up'], picked_up: ['delivered'] })[from]?.includes(to) || false; }
export function getBike(brand, model) { const item = BIKE_CATALOG.find(bike => bike.brand === brand); return item?.models.find(bike => bike.name === model) || item?.models[0] || BIKE_CATALOG.at(-1).models[0]; }
export function timestampMillis(value) { if (typeof value?.toMillis === 'function') return value.toMillis(); if (typeof value === 'number') return value; if (typeof value?.seconds === 'number') return value.seconds * 1000; return 0; }
export function normalizeDocument(snapshot) { const result = { ...snapshot.data(), id: snapshot.id }; for (const key of ['createdAt', 'updatedAt', 'assignedAt', 'pickedUpAt', 'deliveredAt', 'customerRatedAt', 'riderRatedAt']) if (key in result) result[key] = timestampMillis(result[key]); return result; }
