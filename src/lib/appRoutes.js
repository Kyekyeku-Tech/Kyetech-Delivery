const adminPages = ['home', 'riders', 'stores', 'customers', 'orders', 'feedback', 'access', 'audit'];
const appPaths = new Set(['/', '/index.html', '/admin', '/review', ...adminPages.map(page => '/admin/' + page)]);

export function normalizeAppPathname(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return pathname; }
  return decoded.length > 1 ? decoded.replace(/\/$/, '') : decoded;
}

export function isAppPathname(pathname) {
  return typeof pathname === 'string' && appPaths.has(normalizeAppPathname(pathname));
}
