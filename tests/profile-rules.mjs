// Run against the local Firestore emulator; no live users or data are created.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../.verification/sms-tools/package.json', import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, writeBatch, runTransaction, serverTimestamp, Timestamp } = require('firebase/firestore');
const rulesPath = process.argv.includes('--published') ? '.verification/deployed-firestore.rules' : 'firestore.rules';
const env = await initializeTestEnvironment({ projectId: 'demo-kyetech-profiles', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(rulesPath, 'utf8') } });
const profile = (uid, role = 'rider', patch = {}) => ({
  name: 'Kofi Rider', email: uid + '@example.invalid', phone: '+233241234567', role, city: 'Takoradi', photoUrl: '',
  bikeBrand: '', bikeModel: '', plate: '', online: false, accountStatus: 'active', approvalStatus: role === 'rider' ? 'pending' : 'approved',
  reviewNote: '', reviewedBy: '', reviewedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...patch,
});
const mirror = ({ email, role, createdAt, ...publicFields }) => publicFields;
const database = uid => env.authenticatedContext(uid, { email: uid + '@example.invalid' }).firestore();
function savePair(db, uid, data = profile(uid), riderData = mirror(data)) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid), data);
  batch.set(doc(db, 'riders', uid), riderData);
  return batch.commit();
}
try {
  // Match register(): neither document exists before the atomic write.
  const fresh = database('fresh-rider');
  assert.equal((await getDoc(doc(fresh, 'users/fresh-rider'))).exists(), false);
  await assertSucceeds(savePair(fresh, 'fresh-rider'));
  const saved = (await getDoc(doc(fresh, 'users/fresh-rider'))).data();
  assert.equal(saved.approvalStatus, 'pending');
  assert.equal(saved.online, false);
  assert.equal((await getDoc(doc(fresh, 'riders/fresh-rider'))).data().name, saved.name);
  console.log('PASS first rider signup: atomic private/public profiles, pending approval and offline status.');

  for (const role of ['customer', 'merchant']) {
    const uid = 'new-' + role;
    await assertSucceeds(setDoc(doc(database(uid), 'users', uid), profile(uid, role)));
  }
  // Match saveProfile(): an existing Auth account can complete a missing profile.
  const recovery = database('recover-rider');
  await assertSucceeds(runTransaction(recovery, async transaction => {
    const ref = doc(recovery, 'users/recover-rider');
    assert.equal((await transaction.get(ref)).exists(), false);
    const data = profile('recover-rider');
    transaction.set(ref, data, { merge: true });
    transaction.set(doc(recovery, 'riders/recover-rider'), mirror(data));
  }));
  const edited = { ...saved, name: 'Updated Rider', updatedAt: serverTimestamp() };
  await assertSucceeds(savePair(fresh, 'fresh-rider', edited));
  console.log('PASS customer/merchant signup, missing-profile recovery and matching rider profile updates.');

  await assertFails(setDoc(doc(database('missing-mirror'), 'users/missing-mirror'), profile('missing-mirror')));
  await assertFails(setDoc(doc(database('missing-user'), 'riders/missing-user'), mirror(profile('missing-user'))));
  const mismatched = profile('mismatch');
  await assertFails(savePair(database('mismatch'), 'mismatch', mismatched, { ...mirror(mismatched), name: 'Someone Else' }));
  for (const [uid, role, patch] of [
    ['self-approved', 'rider', { approvalStatus: 'approved' }],
    ['self-online', 'rider', { online: true, bikeBrand: 'Apsonic', bikeModel: 'AP 125', plate: 'WR 123' }],
    ['self-suspended', 'rider', { accountStatus: 'suspended' }],
    ['wrong-email', 'rider', { email: 'another@example.invalid' }],
    ['self-admin', 'admin', {}],
    ['customer-directory', 'customer', {}],
  ]) await assertFails(savePair(database(uid), uid, profile(uid, role, patch)));
  await assertFails(savePair(database('intruder'), 'victim'));
  await assertFails(savePair(env.unauthenticatedContext().firestore(), 'anonymous'));
  await assertFails(getDoc(doc(database('new-customer'), 'riders/fresh-rider')));
  await assertFails(getDoc(doc(database('intruder'), 'users/fresh-rider')));
  console.log('PASS malformed or missing mirrors, forged roles/moderation, foreign writes and private profile reads denied.');

  // Both directory creation and updates must preserve an existing suspension.
  const suspended = uid => profile(uid, 'rider', { accountStatus: 'suspended', createdAt: Timestamp.fromMillis(1000), updatedAt: Timestamp.fromMillis(1000) });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['blocked-create', 'blocked-update']) {
      const data = suspended(uid);
      await setDoc(doc(db, 'users', uid), data);
      if (uid === 'blocked-update') await setDoc(doc(db, 'riders', uid), mirror(data));
    }
  });
  for (const uid of ['blocked-create', 'blocked-update']) {
    const db = database(uid), data = { ...suspended(uid), updatedAt: serverTimestamp() };
    await assertFails(setDoc(doc(db, 'riders', uid), mirror(data)));
    await assertFails(savePair(db, uid, { ...data, accountStatus: 'active' }));
    await assertFails(savePair(db, uid, { ...data, name: 'Unauthorized edit' }));
  }
  await assertFails(savePair(fresh, 'fresh-rider', { ...edited, approvalStatus: 'approved', online: true, bikeBrand: 'Apsonic', bikeModel: 'AP 125', plate: 'WR 123' }));
  console.log('PASS suspended rider create/update/reactivation and pending rider self-approval remain denied.');
} finally { await env.cleanup(); }
