import { requireText, timestampMillis, validateImageUrl } from './domain.js';

export const LISTING_KINDS = ['product', 'menu'];
export const MAX_LISTING_PRICE = 100000;

export function cleanStoreListing(input = {}) {
  const kind = String(input.kind || '');
  if (!LISTING_KINDS.includes(kind)) throw new Error('Choose a product or menu item.');
  if (input.price === null || input.price === undefined || String(input.price).trim() === '') throw new Error('Price is required.');
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0 || price > MAX_LISTING_PRICE) throw new Error('Enter a price from GH₵ 0 to GH₵ 100,000.');
  if (Math.abs(price * 100 - Math.round(price * 100)) > 0.000001) throw new Error('Use at most two decimal places for the price.');
  const description = String(input.description || '').trim();
  if (description.length > 1000) throw new Error('Description must be 1,000 characters or fewer.');
  if (typeof input.available !== 'boolean') throw new Error('Choose whether this item is available.');
  return {
    kind, name: requireText(input.name, 'Item name', 100), category: requireText(input.category, 'Category', 60),
    description, price: Math.round(price * 100) / 100, imageUrl: validateImageUrl(input.imageUrl), available: input.available,
  };
}

export function acceptedStoreCatalogMember(profile, store, storeTeam = {}) {
  return Boolean(profile?.id && store?.id && storeTeam?.storeId === store.id && storeTeam.members?.some(member =>
    member.enabled === true && member.userId === profile.id && member.storeId === store.id &&
    storeTeam.invitations?.some(invite => invite.id === member.inviteId && invite.status === 'accepted' &&
      invite.storeId === store.id && invite.ownerId === store.ownerId && invite.memberId === profile.id)));
}

export function canManageStoreListings(profile, store, storeTeam = {}) {
  return Boolean(profile?.id && store?.id && profile.role === 'merchant' &&
    (profile.accountStatus || 'active') === 'active' && (store.accountStatus || 'active') === 'active' &&
    (profile.id === store.ownerId || acceptedStoreCatalogMember(profile, store, storeTeam)));
}

export function normalizeStoreListingRecord(input) {
  try {
    if (!input || typeof input.id !== 'string' || !input.id || input.id.includes('/') || input.id.length > 128 ||
      !['name', 'category', 'description', 'imageUrl'].every(key => typeof input[key] === 'string') || typeof input.price !== 'number') return null;
    return { id: input.id, ...cleanStoreListing(input), createdAt: timestampMillis(input.createdAt), updatedAt: timestampMillis(input.updatedAt) };
  } catch { return null; }
}

export function filterStoreListings(items = [], { search = '', kind = 'all', category = 'All', availability = 'all' } = {}) {
  const terms = String(search).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(item => item && typeof item.name === 'string' && item.name.trim() && typeof item.category === 'string' && typeof item.description === 'string' && LISTING_KINDS.includes(item.kind) && typeof item.available === 'boolean' &&
    (kind === 'all' || item.kind === kind) && (category === 'All' || item.category === category) &&
    (availability === 'all' || Boolean(item.available) === (availability === 'available')) &&
    terms.every(term => [item.name, item.category, item.description].join(' ').toLocaleLowerCase().includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
