import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createDeliverySmsMiddleware } from './sms.mjs';
import { createFirestoreSmsStore } from './firestoreSmsStore.mjs';
import { createGpsAddressMiddleware } from './gpsAddress.mjs';
import { createAdminOtpMiddleware } from './adminOtp.mjs';
import { createRiderAlertsMiddleware } from './riderAlerts.mjs';
import { createStaticFileHandler } from './staticFiles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
config({ path: resolve(root, '.env.local'), quiet: true });
config({ path: resolve(root, '.env'), quiet: true });
const riderAlerts = createRiderAlertsMiddleware({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON, publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT });
const publicDir = resolve(root, 'dist');
const staticFiles = createStaticFileHandler({ publicDir });
const gpsAddress = createGpsAddressMiddleware({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
const adminOtp = createAdminOtpMiddleware({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, apiKey: process.env.MOJOAUTH_API_KEY, serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON });
const sms = createDeliverySmsMiddleware({
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  apiKey: process.env.VITE_MNOTIFY_API_KEY,
  appUrl: process.env.SMS_APP_URL || 'https://kyetechdelivery.site',
  storeFactory: createFirestoreSmsStore,
});
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/delivery-sms') return sms(request, response);
    if (url.pathname === '/api/gps-address') return gpsAddress(request, response);
    if (url.pathname === '/api/admin-otp') return adminOtp(request, response);
    if (url.pathname === '/api/rider-alerts') return riderAlerts(request, response);
    return staticFiles(request, response);
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : 'Bad request.');
  }
});
server.listen(Number(process.env.PORT || 8085), process.env.HOST || '0.0.0.0', () => {
  console.log(`KyeTech Delivery server listening on port ${server.address().port}.`);
});
