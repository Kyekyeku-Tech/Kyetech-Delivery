const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 1500 && !id.includes('/');

export function customerSmsReadKey(projectId, accountId) {
  return `kyetech:sms-viewed:v1:${projectId || 'default'}:${accountId}`;
}

export function loadCustomerSmsReads(key, storage) {
  try {
    const value = JSON.parse((storage === undefined ? globalThis.localStorage : storage)?.getItem(key) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(validId))] : [];
  } catch { return []; }
}

// Keep only message IDs, scoped to this Firebase project and signed-in account.
export function saveCustomerSmsReads(key, ids, storage) {
  const merged = [...new Set([...loadCustomerSmsReads(key, storage), ...ids.filter(validId)])];
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    if (!target) return { ids: merged, persisted: false };
    const encoded = JSON.stringify(merged);
    if (target.getItem(key) !== encoded) target.setItem(key, encoded);
    return { ids: merged, persisted: true };
  } catch { return { ids: merged, persisted: false }; }
}
