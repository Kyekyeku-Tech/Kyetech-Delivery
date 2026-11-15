export function matchesDirectorySearch(query, ...values) {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const text = values.map(normalize).join(' ');
  return normalize(query).trim().split(/\s+/).every(term => text.includes(term));
}
