import { createDeliverySmsMiddleware } from '../server/sms.mjs';
import { createFirestoreSmsStore } from '../server/firestoreSmsStore.mjs';

export default createDeliverySmsMiddleware({
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  apiKey: process.env.VITE_MNOTIFY_API_KEY,
  appUrl: process.env.SMS_APP_URL || 'https://kyetechdelivery.site',
  storeFactory: createFirestoreSmsStore,
});
