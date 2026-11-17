import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'dotenv';
import { createFirebaseAdminRuntime } from '../server/firebaseAdmin.mjs';
import { checkEmailDeliveryDomain, EmailDomainError } from '../server/emailDelivery.mjs';

// Check the existing administrator mail domains without sending any email or OTP.
const env = Object.assign({}, ...['.env', '.env.local'].filter(existsSync).map(file => parse(readFileSync(file))), process.env);
let firestore;
try {
  const projectId = env.VITE_FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const runtime = createFirebaseAdminRuntime({ projectId, serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON, name: 'kyetech-admin-email-check-' + projectId });
  firestore = runtime.firestore;
  const admins = await firestore.collection('admins').where('enabled', '==', true).get();
  if (admins.empty) throw new Error('No enabled administrator found.');
  for (const record of admins.docs) {
    const account = await runtime.auth.getUser(record.id);
    const domain = account.email?.split('@')[1];
    if (!domain || account.disabled) throw new Error('Administrator email account is unavailable.');
    try {
      await checkEmailDeliveryDomain(account.email);
      console.log(`PASS ${domain}: DNS supports mail delivery. Confirm the mailbox exists with your email provider.`);
    } catch (error) {
      console.error(`FAIL ${domain}: ${error instanceof EmailDomainError && error.reason === 'email-domain' ? 'The domain cannot receive mail. Restore its DNS and mailbox with the registrar/email provider.' : 'DNS lookup is temporarily unavailable. Retry the check.'}`);
      process.exitCode = 1;
    }
  }
} catch {
  console.error('Administrator email check could not run. Check the Firebase server credentials and enabled administrator account.');
  process.exitCode = 1;
} finally { await firestore?.terminate(); }
