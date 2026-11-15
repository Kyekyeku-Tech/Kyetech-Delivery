import { createRiderAlertsMiddleware } from '../server/riderAlerts.mjs';

export default createRiderAlertsMiddleware({
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  subject: process.env.VAPID_SUBJECT || 'https://kyetechdelivery.site',
});
