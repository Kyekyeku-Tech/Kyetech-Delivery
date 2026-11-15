import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
const config = { apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID, storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: import.meta.env.VITE_FIREBASE_APP_ID };
export const firebaseConfigured = ['apiKey','authDomain','projectId','appId'].every(key => typeof config[key] === 'string' && config[key].trim());
export const firebaseConfigError = firebaseConfigured ? '' : 'Firebase is not configured. Add the Firebase web app values to your .env file and restart the server.';
export let auth = null, db = null, firebaseInitializationError = '';
function startupDiagnostic(cause) {
  if (typeof cause?.code === 'string' && /^[a-z][a-z0-9/.-]{0,100}$/.test(cause.code)) return cause.code;
  if (/Component (auth|firestore) has not been registered/.test(String(cause?.message || ''))) return 'sdk-component-not-registered';
  return 'unknown';
}
if (firebaseConfigured) {
  let stage = 'app';
  try {
    const app = getApps().find(candidate => candidate.name === '[DEFAULT]') || initializeApp(config);
    stage = 'authentication'; auth = getAuth(app);
    stage = 'database'; db = getFirestore(app);
    if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
      const marker = Symbol.for('kyetech.delivery.firebase-emulators.v1');
      const connected = globalThis[marker] || (globalThis[marker] = { auth: new WeakSet(), firestore: new WeakSet() });
      stage = 'auth-emulator';
      if (!auth.emulatorConfig && !connected.auth.has(auth)) {
        connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        connected.auth.add(auth);
      }
      stage = 'database-emulator';
      if (!connected.firestore.has(db)) {
        connectFirestoreEmulator(db, '127.0.0.1', 8080);
        connected.firestore.add(db);
      }
    }
  } catch (error) {
    const reason = startupDiagnostic(error);
    firebaseInitializationError = reason === 'auth/invalid-api-key'
      ? 'Firebase API key is invalid. Copy the apiKey from Firebase Project settings → Your apps → Web app into .env, then restart the dev server.'
      : `Firebase could not start (${stage}: ${reason}). Check the Firebase web app configuration and restart the dev server.`;
    auth = null; db = null;
  }
}
const messages = { 'auth/invalid-credential': 'The email or password is incorrect.', 'auth/wrong-password': 'The email or password is incorrect.', 'auth/user-not-found': 'The email or password is incorrect.', 'auth/email-already-in-use': 'An account already uses this email. Sign in instead.', 'auth/invalid-email': 'Enter a valid email address.', 'auth/weak-password': 'Choose a password with at least 6 characters.', 'auth/too-many-requests': 'Too many attempts. Wait a little and try again.', 'auth/network-request-failed': 'Connection failed. Check your internet connection and try again.', 'auth/operation-not-allowed': 'Enable email and password sign-in in Firebase Authentication.', 'auth/unauthorized-domain': 'This domain is not authorized in Firebase Authentication.', 'permission-denied': 'Firebase denied this request. Check that the app security rules have been deployed.', 'unavailable': 'The service is temporarily offline. Check your connection and try again.', 'failed-precondition': 'Firebase needs a database index. Check your Firebase console.' };
export function friendlyFirebaseError(error) { return messages[error?.code] || error?.message || 'Something went wrong. Please try again.'; }
