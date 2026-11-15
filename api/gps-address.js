import { createGpsAddressMiddleware } from '../server/gpsAddress.mjs';

export default createGpsAddressMiddleware({
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
