import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth, JWT } from 'google-auth-library';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const runtimes = new Map();
const scopes = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/identitytoolkit',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function createFirebaseAdminRuntime({ projectId, serviceAccountJson, name }) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('Firebase project is required.');
  let account;
  if (serviceAccountJson?.trim()) {
    account = JSON.parse(serviceAccountJson);
    if (account?.type !== 'service_account' || account.project_id !== projectId ||
        typeof account.client_email !== 'string' || typeof account.private_key !== 'string') {
      throw new Error('Firebase service account does not match this project.');
    }
  }
  // Validate the signing key before reusing a runtime, including subsequent requests.
  const signingCredential = account ? cert({ projectId, clientEmail: account.client_email, privateKey: account.private_key }) : null;
  if (runtimes.has(name)) return runtimes.get(name);
  const existingApp = appName => getApps().find(app => app.name === appName);
  if (!account) {
    const app = existingApp(name) || initializeApp({ projectId, credential: applicationDefault() }, name);
    const runtime = { auth: getAuth(app), firestore: getFirestore(app) };
    runtimes.set(name, runtime);
    return runtime;
  }

  const client = new JWT({ email: account.client_email, key: account.private_key, keyId: account.private_key_id, projectId, scopes });
  const credential = {
    async getAccessToken() {
      const { token } = await client.getAccessToken();
      const expiry = client.credentials.expiry_date;
      if (!token || !Number.isFinite(expiry)) throw new Error('Firebase access token is unavailable.');
      return { access_token: token, expires_in: Math.max(1, Math.floor((expiry - Date.now()) / 1000)) };
    },
  };
  const app = existingApp(name) || initializeApp({ projectId, credential }, name);
  const auth = getAuth(app);
  // Firebase's certificate credential still provides local custom-token signing.
  // Keep it on a signing-only app so it never takes the deprecated OAuth path.
  const signingName = name + '-signing';
  const signingApp = existingApp(signingName) || initializeApp({ projectId, credential: signingCredential }, signingName);
  const signer = getAuth(signingApp);
  const runtime = {
    auth: {
      verifyIdToken: (...args) => auth.verifyIdToken(...args),
      getUser: (...args) => auth.getUser(...args),
      createCustomToken: (...args) => signer.createCustomToken(...args),
    },
    firestore: new Firestore({ projectId, auth: new GoogleAuth({ projectId, authClient: client }) }),
  };
  runtimes.set(name, runtime);
  return runtime;
}
