// Administrator OTP authorization is verified only against a local demo emulator.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { adminOtpAuthTime, adminOtpClaims, adminOtpSession, adminOtpSessionId } from './admin-otp-fixtures.mjs';
const require = createRequire(new URL('../.verification/sms-tools/package.json', import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails: expectDenial } = require('@firebase/rules-unit-testing');
async function assertFails(request) {
  const origin = new Error().stack?.split('\n')[2]?.trim();
  try { return await expectDenial(request); }
  catch (cause) { cause.message += ' (' + origin + ')'; throw cause; }
}
const { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc, serverTimestamp } = require('firebase/firestore');
const env = await initializeTestEnvironment({ projectId: 'demo-kyetech-admin-otp', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
const otherSessionId = 'b'.repeat(64), missingSessionId = 'c'.repeat(64);
const audit = () => ({ actorId: 'admin-one', action: 'verification', targetType: 'user', targetId: 'customer-one', note: '', createdAt: serverTimestamp() });
let deniedWrite = 0;
async function deniedAdmin(db, label) {
  try {
    await assertFails(getDocs(collection(db, 'users')));
    await assertFails(getDoc(doc(db, 'users/customer-one')));
    await assertFails(getDocs(collection(db, 'admins')));
    await assertFails(getDoc(doc(db, 'orders/private-order')));
    await assertFails(getDocs(collection(db, 'adminAudit')));
    await assertFails(setDoc(doc(db, 'adminAudit', 'denied-' + ++deniedWrite), audit()));
  } catch (cause) { cause.message = label + ': ' + cause.message; throw cause; }
}
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['admin-one', 'disabled-admin', 'suspended-admin', 'customer-one']) {
      await setDoc(doc(db, 'users', uid), { role: 'customer', accountStatus: uid === 'suspended-admin' ? 'suspended' : 'active' });
      if (uid !== 'customer-one') await setDoc(doc(db, 'admins', uid), { enabled: uid !== 'disabled-admin' });
    }
    await setDoc(doc(db, 'adminOtpSessions', adminOtpSessionId), adminOtpSession());
    await setDoc(doc(db, 'adminOtpSessions', otherSessionId), adminOtpSession({ authTime: adminOtpAuthTime + 1 }));
    await setDoc(doc(db, 'orders/private-order'), { creatorId: 'customer-one', creatorRole: 'customer', merchantId: '', riderId: 'rider-one', status: 'pending' });
    for (const category of ['adminOtpChallenges', 'adminOtpThrottle', 'adminOtpCooldowns']) await setDoc(doc(db, category, 'private-one'), { uid: 'admin-one', secret: 'fixture-only' });
  });
  const verified = env.authenticatedContext('admin-one', adminOtpClaims()).firestore();
  const password = env.authenticatedContext('admin-one', { auth_time: adminOtpAuthTime, firebase: { sign_in_provider: 'password' } }).firestore();
  const noSession = env.authenticatedContext('admin-one', { auth_time: adminOtpAuthTime, firebase: { sign_in_provider: 'custom' } }).firestore();
  const passwordWithClaim = env.authenticatedContext('admin-one', adminOtpClaims({ firebase: { sign_in_provider: 'password' } })).firestore();
  const unauthenticated = env.unauthenticatedContext().firestore();
  await deniedAdmin(password, 'Original password sign-in');
  await deniedAdmin(noSession, 'Custom sign-in without a session claim');
  await deniedAdmin(passwordWithClaim, 'A password token cannot inherit user-wide OTP claims');
  await deniedAdmin(unauthenticated, 'Unauthenticated request');
  for (const db of [password, noSession, passwordWithClaim]) {
    await assertSucceeds(getDoc(doc(db, 'users/admin-one')));
    await assertSucceeds(getDoc(doc(db, 'admins/admin-one')));
    await assertFails(getDoc(doc(db, 'adminOtpSessions', adminOtpSessionId)));
  }
  await assertSucceeds(getDocs(collection(verified, 'users')));
  await assertSucceeds(getDocs(collection(verified, 'admins')));
  await assertSucceeds(getDoc(doc(verified, 'orders/private-order')));
  await assertSucceeds(setDoc(doc(verified, 'adminAudit/verified'), audit()));
  const ownSession = await assertSucceeds(getDoc(doc(verified, 'adminOtpSessions', adminOtpSessionId)));
  assert.equal(ownSession.data().uid, 'admin-one');
  await assertFails(getDoc(doc(verified, 'adminOtpSessions', otherSessionId)));
  await assertFails(getDocs(collection(verified, 'adminOtpSessions')));
  await assertFails(getDocs(query(collection(verified, 'adminOtpSessions'), where('uid', '==', 'admin-one'))));
  const secondVerified = env.authenticatedContext('admin-one', adminOtpClaims({ adminOtpSessionId: otherSessionId, auth_time: adminOtpAuthTime + 1 })).firestore();
  await assertSucceeds(getDocs(collection(secondVerified, 'users')));
  await assertSucceeds(getDoc(doc(secondVerified, 'adminOtpSessions', otherSessionId)));
  await assertFails(getDoc(doc(secondVerified, 'adminOtpSessions', adminOtpSessionId)));
  const invalidClaims = [
    ['Same UID with a different, unverified session', { adminOtpSessionId: otherSessionId }],
    ['Copied earlier session ID on a later sign-in', { auth_time: adminOtpAuthTime + 1 }],
    ['Fabricated session ID', { adminOtpSessionId: missingSessionId }],
    ['Uppercase session ID', { adminOtpSessionId: 'A'.repeat(64) }],
    ['Short session ID', { adminOtpSessionId: 'a'.repeat(63) }],
    ['Non-string session ID', { adminOtpSessionId: 123 }],
    ['Missing authentication time', { auth_time: null }],
    ['Non-integer authentication time', { auth_time: String(adminOtpAuthTime) }],
  ];
  for (const [label, patch] of invalidClaims) await deniedAdmin(env.authenticatedContext('admin-one', adminOtpClaims(patch)).firestore(), label);
  const missing = await assertSucceeds(getDoc(doc(env.authenticatedContext('admin-one', adminOtpClaims({ adminOtpSessionId: missingSessionId })).firestore(), 'adminOtpSessions', missingSessionId)));
  assert.equal(missing.exists(), false, 'A matching signed session can observe a missing grant and show the OTP gate');
  for (const patch of [
    { status: 'pending' }, { status: 'revoked' }, { expiresAt: new Date(0) },
    { uid: 'customer-one' }, { authTime: adminOtpAuthTime + 1 }, { authTime: null },
    { expiresAt: '2099-01-01T00:00:00.000Z' },
  ]) {
    await env.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'adminOtpSessions', adminOtpSessionId), adminOtpSession(patch)));
    await deniedAdmin(verified, JSON.stringify(patch));
    if (patch.uid) await assertFails(getDoc(doc(verified, 'adminOtpSessions', adminOtpSessionId)));
    else await assertSucceeds(getDoc(doc(verified, 'adminOtpSessions', adminOtpSessionId)));
  }
  await env.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'adminOtpSessions', adminOtpSessionId), adminOtpSession()));
  for (const uid of ['disabled-admin', 'suspended-admin', 'customer-one']) {
    const sid = (uid === 'disabled-admin' ? 'd' : uid === 'suspended-admin' ? 'e' : 'f').repeat(64);
    await env.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'adminOtpSessions', sid), adminOtpSession({ uid })));
    const db = env.authenticatedContext(uid, adminOtpClaims({ adminOtpSessionId: sid })).firestore();
    await assertFails(getDocs(collection(db, 'users')));
    await assertFails(setDoc(doc(db, 'adminAudit', uid), { ...audit(), actorId: uid }));
    await assertFails(getDoc(doc(db, 'adminOtpSessions', sid)));
    await assertSucceeds(getDoc(doc(db, 'users', uid)));
  }
  for (const db of [verified, password, unauthenticated]) {
    await assertFails(setDoc(doc(db, 'adminOtpSessions', adminOtpSessionId), adminOtpSession()));
    await assertFails(setDoc(doc(db, 'adminOtpSessions', missingSessionId), adminOtpSession()));
    await assertFails(updateDoc(doc(db, 'adminOtpSessions', adminOtpSessionId), { status: 'active', expiresAt: new Date(Date.now() + 86400000) }));
    await assertFails(deleteDoc(doc(db, 'adminOtpSessions', adminOtpSessionId)));
    for (const category of ['adminOtpChallenges', 'adminOtpThrottle', 'adminOtpCooldowns']) {
      await assertFails(getDoc(doc(db, category, 'private-one')));
      await assertFails(getDocs(collection(db, category)));
      await assertFails(setDoc(doc(db, category, 'new-one'), { uid: 'admin-one' }));
      await assertFails(updateDoc(doc(db, category, 'private-one'), { uid: 'admin-one' }));
      await assertFails(deleteDoc(doc(db, category, 'private-one')));
    }
  }
  await env.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'admins/admin-one'), { enabled: false }));
  await deniedAdmin(verified, 'Administrator access revoked after session activation');
  await assertFails(getDoc(doc(verified, 'adminOtpSessions', adminOtpSessionId)));
  await assertSucceeds(getDoc(doc(verified, 'admins/admin-one')));
  console.log('PASS administrator OTP rules: signed custom session grants, pre-OTP self reads, per-sign-in isolation, pending/expired/revoked/fabricated rejection, disabled/suspended accounts, privileged direct-read/write enforcement and server-only session/challenge/cooldown records.');
} finally { await env.cleanup(); }
