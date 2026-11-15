import { createAdminOtpMiddleware } from '../server/adminOtp.mjs';

export default createAdminOtpMiddleware({
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  apiKey: process.env.MOJOAUTH_API_KEY,
  serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
});
