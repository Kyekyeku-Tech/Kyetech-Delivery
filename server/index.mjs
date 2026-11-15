import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createDeliverySmsMiddleware } from './sms.mjs';
import { createFirestoreSmsStore } from './firestoreSmsStore.mjs';
import { createGpsAddressMiddleware } from './gpsAddress.mjs';
import { createAdminOtpMiddleware } from './adminOtp.mjs';
import { createRiderAlertsMiddleware } from './riderAlerts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
config({ path: resolve(root, '.env.local'), quiet: true });
config({ path: resolve(root, '.env'), quiet: true });
const riderAlerts = createRiderAlertsMiddleware({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON, publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT });
const publicDir = resolve(root, 'dist');
const gpsAddress = createGpsAddressMiddleware({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
const adminOtp = createAdminOtpMiddleware({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, apiKey: process.env.MOJOAUTH_API_KEY, serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON });
const sms = createDeliverySmsMiddleware({
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  apiKey: process.env.VITE_MNOTIFY_API_KEY,
  appUrl: process.env.SMS_APP_URL || 'https://kyetechdelivery.site',
  storeFactory: createFirestoreSmsStore,
});
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/delivery-sms') return sms(request, response);
    if (url.pathname === '/api/gps-address') return gpsAddress(request, response);
    if (url.pathname === '/api/admin-otp') return adminOtp(request, response);
    if (url.pathname === '/api/rider-alerts') return riderAlerts(request, response);
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); return response.end(); }
    const file = resolve(publicDir, `.${decodeURIComponent(url.pathname)}`);
    if (file !== publicDir && !file.startsWith(publicDir + sep)) { response.writeHead(403); return response.end(); }
    let target = file;
    try { if (!(await stat(target)).isFile()) target = resolve(publicDir, 'index.html'); }
    catch { target = resolve(publicDir, 'index.html'); }
    const content = await readFile(target);
    response.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') response.setHeader('Cache-Control', 'no-cache');
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Build the app with npm run build before starting the server.');
  }
});
server.listen(Number(process.env.PORT || 8085), process.env.HOST || '0.0.0.0', () => {
  console.log(`KyeTech Delivery server listening on port ${server.address().port}.`);
});
