import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { auth, db, firebaseConfigError, firebaseInitializationError, friendlyFirebaseError } from '../lib/firebase';
import { BIKE_CATALOG, ROLES, nextOrderStatus, normalizeDocument, requirePhone, requireText, timestampMillis, validateFee, validateImageUrl } from '../lib/domain';
import { ACCOUNT_STATUSES, APPROVAL_STATUSES, FEEDBACK_STATUSES, adminOrderChange, cleanAdminNote, cleanReviewNote, isActiveAccount, isApprovedRider, moderationFields } from '../lib/admin';
import { notifyDeliverySms } from '../lib/sms';
import { notifyRiderOrder, removeRiderPush } from '../lib/riderAlerts';
import { cleanCoordinates } from '../lib/location';
import useRiderLocationSharing from '../lib/useRiderLocationSharing';
import useStoreTeam from '../lib/useStoreTeam';
import useCustomerSmsReads from '../lib/useCustomerSmsReads';
import useMerchantSmsReads from '../lib/useMerchantSmsReads';
import useAdminOtp from '../lib/useAdminOtp';

const PlatformContext = createContext(null);
const setupError = firebaseConfigError || firebaseInitializationError;
const profileFields = ['name', 'phone', 'city', 'photoUrl', 'bikeBrand', 'bikeModel', 'plate', 'online'];

function cleanProfile(input, role) {
  const data = {
    name: requireText(input.name, 'Name', 100),
    phone: requirePhone(input.phone),
    city: requireText(input.city || 'Sekondi–Takoradi', 'City', 100),
    photoUrl: validateImageUrl(input.photoUrl),
    bikeBrand: role === 'rider' ? String(input.bikeBrand || '').trim() : '',
    bikeModel: role === 'rider' ? String(input.bikeModel || '').trim() : '',
    plate: role === 'rider' ? String(input.plate || '').trim().toUpperCase() : '',
    online: role === 'rider' && Boolean(input.online),
  };
  if (data.plate.length > 40) throw new Error('Plate number must be 40 characters or fewer.');
  if (data.bikeBrand && !BIKE_CATALOG.some(bike => bike.brand === data.bikeBrand)) throw new Error('Choose a motorcycle brand.');
  if (data.bikeModel && !BIKE_CATALOG.find(bike => bike.brand === data.bikeBrand)?.models.some(bike => bike.name === data.bikeModel)) throw new Error('Choose a model for your motorcycle brand.');
  if (data.online && (!data.bikeBrand || !data.bikeModel || !data.plate)) throw new Error('Add your motorcycle brand, model, and plate number before going online.');
  return data;
}

function cleanStore(input, ownerId) {
  const data = {
    ownerId,
    name: requireText(input.name, 'Store name', 100),
    category: requireText(input.category, 'Category', 60),
    address: requireText(input.address, 'Store address', 250),
    phone: requirePhone(input.phone, 'Store phone number'),
    imageUrl: validateImageUrl(input.imageUrl || '/images/store-placeholder.svg'),
    description: String(input.description || '').trim(),
    open: input.open !== false,
  };
  if (data.description.length > 1000) throw new Error('Store description must be 1,000 characters or fewer.');
  if (input.location !== undefined) data.location = cleanCoordinates(input.location);
  if (input.gpsAddress !== undefined) {
    data.gpsAddress = String(input.gpsAddress || '').trim();
    if (data.gpsAddress.length > 250) throw new Error('GPS address must be 250 characters or fewer.');
    if (!data.location) data.gpsAddress = '';
  }
  return data;
}

function riderDirectory(profile) {
  return {
    ...Object.fromEntries(profileFields.map(key => [key, profile[key]])),
    ...moderationFields(profile, 'rider'),
    updatedAt: serverTimestamp(),
  };
}

function normalizeRecord(snapshot, category) {
  const data = normalizeDocument(snapshot);
  if (category === 'users' || category === 'profile' || category === 'riders' || category === 'stores') {
    Object.assign(data, moderationFields(data, category === 'riders' ? 'rider' : category === 'stores' ? 'store' : data.role));
    if (category !== 'stores') data.online = Boolean(data.online && data.approvalStatus === 'approved' && isActiveAccount(data));
  }
  if (category === 'feedback') Object.assign(data, { status: data.status || 'open', adminNote: data.adminNote || '', reviewedBy: data.reviewedBy || '', reviewedAt: data.reviewedAt ?? null });
  if ('reviewedAt' in data) data.reviewedAt = timestampMillis(data.reviewedAt);
  return data;
}

function requireSession() {
  if (!auth || !db) throw new Error(setupError || 'Firebase is unavailable.');
  if (!auth.currentUser) throw new Error('Sign in to continue.');
  return auth.currentUser;
}

function requireDocumentId(value, label = 'Record ID') {
  const id = requireText(value, label, 128);
  if (id.includes('/') || id === '.' || id === '..') throw new Error(`${label} is invalid.`);
  return id;
}

function collectionReadError(category, single, role, cause) {
  const label = {
    stores: single ? 'Store details' : 'Store directory', riders: single ? 'Rider profile' : 'Rider directory',
    orders: role === 'merchant' ? 'Store deliveries' : 'Delivery requests', feedback: 'Feedback',
    deliverySms: role === 'merchant' ? 'Store SMS' : 'Customer SMS', deliveryReviews: role === 'merchant' ? 'Store reviews' : 'Rider reviews',
    users: 'User accounts', admins: 'Administrator access', adminAudit: 'Admin activity',
  }[category] || 'App data';
  return `${label} ${cause?.code === 'permission-denied' ? 'access was denied' : 'could not be loaded'}. ${friendlyFirebaseError(cause)}`;
}

export function PlatformProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authRevision, setAuthRevision] = useState(0), [loginGeneration, setLoginGeneration] = useState(0);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(auth));
  const [profileLoading, setProfileLoading] = useState(Boolean(auth));
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [profileReadFailed, setProfileReadFailed] = useState(false);
  const [error, setError] = useState(setupError);
  const [stores, setStores] = useState([]);
  const [riders, setRiders] = useState([]);
  const [orders, setOrders] = useState([]);
  const [liveLocations, setLiveLocations] = useState({});
  const [feedback, setFeedback] = useState([]);
  const [smsMessages, setSmsMessages] = useState([]);
  const [recipientReviews, setRecipientReviews] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminAdmins, setAdminAdmins] = useState([]);
  const [adminAudit, setAdminAudit] = useState([]);
  const [adminPermission, setAdminPermission] = useState(null);
  const [adminLoading, setAdminLoading] = useState(Boolean(auth));
  const [loadedScope, setLoadedScope] = useState('');
  const [riderRequestStream, setRiderRequestStream] = useState({ scope: '', ready: false });
  const [readFailures, setReadFailures] = useState({ scope: '', errors: {} });
  const collectionRetry = useRef(null), currentSubscriptionScope = useRef('');
  const registering = useRef(false);
  const [authActionPending, setAuthActionPending] = useState(false);
  const storeTeam = useStoreTeam({ user, profile });
  const hasAdminAccess = Boolean(user && adminPermission?.uid === user.uid && adminPermission.enabled && isActiveAccount(profile));
  const adminOtp = useAdminOtp({ user, eligible: hasAdminAccess && !adminLoading, sessionVersion: loginGeneration });
  const isAdmin = hasAdminAccess && adminOtp.status === 'verified';
  const subscriptionScope = user && profile && !adminLoading && (!hasAdminAccess || isAdmin) && (isAdmin || isActiveAccount(profile)) && (isAdmin || profile.role !== 'merchant' || (!storeTeam.loading && storeTeam.storeId))
    ? `${user.uid}:${isAdmin ? 'admin' : profile.role}:${profile.accountStatus}:${profile.approvalStatus}:${profile.role === 'merchant' ? storeTeam.storeId : ''}`
    : '';
  currentSubscriptionScope.current = subscriptionScope;
  const dataReadErrors = subscriptionScope && readFailures.scope === subscriptionScope ? readFailures.errors : {};
  const locationOrders = loadedScope === subscriptionScope && subscriptionScope ? orders.filter(order => ['accepted', 'picked_up'].includes(order.status) && (order.creatorId === user?.uid || order.riderId === user?.uid || (profile?.role === "merchant" && order.creatorId === storeTeam.storeId))) : [];
  const locationScope = subscriptionScope + ':' + locationOrders.map(order => order.id).sort().join(',');
  const riderLocationSharing = useRiderLocationSharing({ user, profile, orders: locationOrders });

  useEffect(() => {
    setLiveLocations({});
    if (!db || !subscriptionScope || isAdmin) return;
    let active = true;
    const stops = locationOrders.map(order => onSnapshot(doc(db, 'orders', order.id, 'tracking', 'rider'), snapshot => {
      if (active) setLiveLocations(current => ({ ...current, [order.id]: snapshot.exists() ? normalizeDocument(snapshot) : null }));
    }, () => {
      if (active) setLiveLocations(current => ({ ...current, [order.id]: { error: 'Location updates are unavailable. Call your rider for an update.' } }));
    }));
    return () => { active = false; stops.forEach(stop => stop()); };
  }, [locationScope]);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, account => {
      setUser(account);
      setAuthRevision(value => value + 1);
      setProfile(null);
      setAdminPermission(null);
      setAdminLoading(Boolean(account));
      setProfileReadFailed(false);
      setProfileLoading(Boolean(account));
      setAuthLoading(false);
      setLoadedScope('');
    }, cause => {
      setError(friendlyFirebaseError(cause));
      setAuthLoading(false);
      setProfileLoading(false);
      setAdminLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user || !db) {
      setProfileLoading(false);
      setAdminLoading(false);
      setAdminPermission(null);
      return;
    }
    let active = true;
    setProfileLoading(true);
    setAdminLoading(true);
    const stopProfile = onSnapshot(doc(db, 'users', user.uid), snapshot => {
      if (!active) return;
      setProfile(snapshot.exists() ? normalizeRecord(snapshot, 'profile') : null);
      setProfileLoading(false);
      setProfileReadFailed(false);
    }, cause => {
      if (!active) return;
      setError(friendlyFirebaseError(cause));
      setProfileReadFailed(true);
      setProfileLoading(false);
    });
    const stopPermission = onSnapshot(doc(db, 'admins', user.uid), snapshot => {
      if (!active) return;
      setAdminPermission({ uid: user.uid, enabled: snapshot.exists() && snapshot.data().enabled === true });
      setAdminLoading(false);
    }, cause => {
      if (!active) return;
      setAdminPermission({ uid: user.uid, enabled: false });
      setAdminLoading(false);
      setError(friendlyFirebaseError(cause));
    });
    return () => {
      active = false;
      stopProfile();
      stopPermission();
    };
  }, [user?.uid, authRevision]);

  useEffect(() => {
    setStores([]);
    setRiders([]);
    setOrders([]);
    setRiderRequestStream({ scope: subscriptionScope, ready: false });
    setFeedback([]);
    setSmsMessages([]);
    setRecipientReviews([]);
    setAdminUsers([]);
    setAdminAdmins([]);
    setAdminAudit([]);
    setReadFailures({ scope: subscriptionScope, errors: {} });
    setLoadedScope(subscriptionScope);
    if (!subscriptionScope || !db) {
      setCollectionsLoading(false);
      return;
    }
    let active = true;
    const isCurrent = () => active && currentSubscriptionScope.current === subscriptionScope;
    const sources = [];
    const snapshots = {};
    const failures = {}, stops = {}, attempts = {};
    const retrying = new Set();
    const ready = new Set();
    const setters = { stores: setStores, riders: setRiders, orders: setOrders, feedback: setFeedback, users: setAdminUsers, admins: setAdminAdmins, adminAudit: setAdminAudit, deliverySms: setSmsMessages, deliveryReviews: setRecipientReviews };
    const listen = (category, source, single = false, riderRequests = false) => sources.push({ category, source, single, riderRequests, key: `${category}-${sources.length}` });
    if (isAdmin) {
      for (const category of Object.keys(setters)) if (!['deliverySms','deliveryReviews'].includes(category)) listen(category, collection(db, category));
    } else {
      listen('stores', query(collection(db, 'stores'), where('approvalStatus', '==', 'approved'), where('accountStatus', '==', 'active')));
      listen('riders', query(collection(db, 'riders'), where('approvalStatus', '==', 'approved'), where('accountStatus', '==', 'active')));
      if (profile.role === 'merchant') listen('stores', doc(db, 'stores', storeTeam.storeId), true);
      if (profile.role === 'rider') listen('riders', doc(db, 'riders', user.uid), true);
      listen('feedback', query(collection(db, 'feedback'), where('ownerId', '==', user.uid)));
      if (profile.role === 'customer') listen('deliverySms', query(collection(db, 'deliverySms'), where('customerId', '==', user.uid), where('status', '==', 'submitted')));
      if (profile.role === 'merchant') listen('deliverySms', query(collection(db, 'deliverySms'), where('merchantId', '==', storeTeam.storeId), where('status', '==', 'submitted')));
      if (profile.role === 'merchant') listen('deliveryReviews', query(collection(db, 'deliveryReviews'), where('merchantId', '==', storeTeam.storeId)));
      if (profile.role === 'rider') listen('deliveryReviews', query(collection(db, 'deliveryReviews'), where('riderId', '==', user.uid)));
      if (profile.role === 'merchant' && storeTeam.storeId !== user.uid) listen('orders', query(collection(db, 'orders'), where('creatorId', '==', storeTeam.storeId), where('creatorRole', '==', 'merchant'), where('merchantId', '==', storeTeam.storeId)));
      else listen('orders', query(collection(db, 'orders'), where(profile.role === 'rider' ? 'riderId' : 'creatorId', '==', user.uid)));
      if (isApprovedRider(profile)) listen('orders', query(collection(db, 'orders'), where('status', '==', 'pending')), false, true);
    }
    setCollectionsLoading(true);
    const markReady = key => {
      ready.add(key);
      if (isCurrent() && ready.size === sources.length) setCollectionsLoading(false);
    };
    const publish = category => {
      const merged = new Map(sources.filter(source => source.category === category).flatMap(source => snapshots[source.key] || []).map(record => [record.id, record]));
      const data = [...merged.values()];
      if (['orders', 'feedback', 'adminAudit', 'deliveryReviews'].includes(category)) data.sort((a, b) => b.createdAt - a.createdAt);
      if (category === 'deliverySms') data.sort((a, b) => b.updatedAt - a.updatedAt);
      setters[category](data);
    };
    const publishFailures = () => setReadFailures({ scope: subscriptionScope, errors: { ...failures } });
    function attach({ category, source, single, riderRequests, key }) {
      const attempt = attempts[key] = (attempts[key] || 0) + 1;
      const currentAttempt = () => isCurrent() && attempts[key] === attempt;
      function failed(cause) {
        if (!currentAttempt()) return;
        retrying.delete(key);
        if (riderRequests) setRiderRequestStream({ scope: subscriptionScope, ready: false });
        snapshots[key] = [];
        publish(category);
        failures[key] = collectionReadError(category, single, profile.role, cause);
        publishFailures();
        markReady(key);
      }
      try {
        stops[key] = onSnapshot(source, { includeMetadataChanges: true }, snapshot => {
          if (!currentAttempt()) return;
          snapshots[key] = single ? (snapshot.exists() ? [normalizeRecord(snapshot, category)] : []) : snapshot.docs.map(record => normalizeRecord(record, category));
          publish(category);
          if (riderRequests) setRiderRequestStream({ scope: subscriptionScope, ready: !snapshot.metadata?.fromCache && !snapshot.metadata?.hasPendingWrites });
          // A cached snapshot does not confirm that a rejected server read recovered.
          if (!snapshot.metadata?.fromCache) {
            retrying.delete(key);
            if (key in failures) { delete failures[key]; publishFailures(); }
          }
          markReady(key);
        }, failed);
      } catch (cause) { failed(cause); }
    }
    const controller = { scope: subscriptionScope, retry() {
      if (!isCurrent()) return;
      const rejected = sources.filter(source => source.key in failures && !retrying.has(source.key));
      if (!rejected.length) return;
      rejected.forEach(source => { retrying.add(source.key); stops[source.key]?.(); });
      rejected.forEach(attach);
    } };
    collectionRetry.current = controller;
    sources.forEach(attach);
    return () => {
      active = false;
      Object.values(stops).forEach(stop => stop());
      if (collectionRetry.current === controller) collectionRetry.current = null;
    };
  }, [subscriptionScope]);

  useEffect(() => {
    function reconnect() {
      const controller = collectionRetry.current;
      if (controller?.scope === currentSubscriptionScope.current) controller.retry();
    }
    window.addEventListener('online', reconnect);
    window.addEventListener('focus', reconnect);
    return () => { window.removeEventListener('online', reconnect); window.removeEventListener('focus', reconnect); };
  }, []);

  function retryData() {
    if (collectionRetry.current?.scope === subscriptionScope) collectionRetry.current.retry();
  }

  async function action(callback) {
    setError('');
    try {
      return await callback();
    } catch (cause) {
      const message = friendlyFirebaseError(cause);
      setError(message);
      throw new Error(message);
    }
  }

  function activeSession() {
    const account = requireSession();
    if (!isActiveAccount(profile)) throw new Error('Your account is suspended. Contact KyeTech support for help.');
    return account;
  }

  async function adminTransaction(callback) {
    const account = requireSession();
    if (adminLoading || !isAdmin) throw new Error('Administrator access is required.');
    return runTransaction(db, async transaction => {
      const permission = await transaction.get(doc(db, 'admins', account.uid));
      const actor = await transaction.get(doc(db, 'users', account.uid));
      if (!permission.exists() || permission.data().enabled !== true || !actor.exists() || !isActiveAccount(actor.data())) throw new Error('Administrator access is no longer available.');
      return callback(transaction, account);
    });
  }

  function audit(transaction, actorId, actionName, targetType, targetId, note) {
    transaction.set(doc(collection(db, 'adminAudit')), { actorId, action: actionName, targetType, targetId, note: cleanAdminNote(note), createdAt: serverTimestamp() });
  }

  function register(input) {
    return action(async () => {
      if (!auth || !db) throw new Error(setupError);
      if (!ROLES.includes(input.role)) throw new Error('Choose customer, rider, or merchant.');
      const fields = cleanProfile({ ...input, online: false }, input.role);
      const moderation = moderationFields({}, input.role);
      const email = requireText(input.email, 'Email', 254).toLowerCase();
      const password = String(input.password || '');
      if (password.length < 6) throw new Error('Choose a password with at least 6 characters.');
      registering.current = true;
      try {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(credential.user, { displayName: fields.name });
        const batch = writeBatch(db);
        batch.set(doc(db, 'users', credential.user.uid), { ...fields, ...moderation, email: credential.user.email, role: input.role, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        if (input.role === 'rider') batch.set(doc(db, 'riders', credential.user.uid), riderDirectory({ ...fields, ...moderation }));
        await batch.commit();
        return credential.user;
      } finally {
        registering.current = false;
      }
    });
  }

  function login(email, password) {
    return action(async () => {
      if (!auth) throw new Error(setupError);
      setAuthActionPending(true);
      try {
        const account = (await signInWithEmailAndPassword(auth, String(email).trim(), password)).user;
        setLoginGeneration(value => value + 1);
        return account;
      } finally {
        setAuthActionPending(false);
      }
    });
  }

  function logout() { return action(async () => {
    if (auth?.currentUser) await removeRiderPush(auth.currentUser).catch(() => {});
    await riderLocationSharing.stop();
    let closeError;
    try { await adminOtp.revoke(); } catch { closeError = new Error('You signed out, but the administrator session could not be closed on the server.'); }
    finally { if (auth) await signOut(auth); }
    if (closeError) throw closeError;
  }); }
  function resetPassword(email) { return action(async () => { if (!auth) throw new Error(setupError); await sendPasswordResetEmail(auth, requireText(email, 'Email', 254)); }); }

  function saveProfile(patch) {
    return action(async () => {
      const account = requireSession();
      await runTransaction(db, async transaction => {
        const ref = doc(db, 'users', account.uid);
        const snapshot = await transaction.get(ref);
        const existing = snapshot.exists() ? snapshot.data() : null;
        const role = existing?.role || patch.role;
        if (!ROLES.includes(role)) throw new Error('Choose an account type to finish setup.');
        if (existing && !isActiveAccount(existing)) throw new Error('Your account is suspended. Contact KyeTech support for help.');
        if (existing && patch.role && patch.role !== role) throw new Error('Your account type cannot be changed.');
        const selected = Object.fromEntries(profileFields.filter(key => key in patch).map(key => [key, patch[key]]));
        const fields = cleanProfile({ ...existing, ...selected }, role);
        const moderation = moderationFields(existing || {}, role);
        if (fields.online && moderation.approvalStatus !== 'approved') throw new Error('Your rider profile must be approved before you can go online.');
        const updated = { ...fields, ...moderation, email: existing?.email || account.email, role, updatedAt: serverTimestamp() };
        if (!existing) updated.createdAt = serverTimestamp();
        transaction.set(ref, updated, { merge: true });
        if (role === 'rider') transaction.set(doc(db, 'riders', account.uid), riderDirectory({ ...fields, ...moderation }));
      });
      await updateProfile(account, { displayName: String(patch.name || profile?.name || account.displayName || '') });
    });
  }

  function saveStore(payload) {
    return action(async () => {
      const account = activeSession();
      if (profile?.role !== 'merchant') throw new Error('Only merchants can manage a store.');
      const data = cleanStore(payload, account.uid);
      await runTransaction(db, async transaction => {
        const ref = doc(db, 'stores', account.uid);
        const owner = await transaction.get(doc(db, 'users', account.uid));
        const existing = await transaction.get(ref);
        if (!owner.exists() || owner.data().role !== 'merchant' || !isActiveAccount(owner.data())) throw new Error('An active merchant account is required.');
        const moderation = moderationFields(existing.exists() ? existing.data() : {}, 'store');
        transaction.set(ref, { ...data, ...moderation, updatedAt: serverTimestamp(), ...(!existing.exists() ? { createdAt: serverTimestamp() } : {}) }, { merge: true });
      });
      return account.uid;
    });
  }

  function createOrder(payload) {
    return action(async () => {
      const account = activeSession();
      if (!profile || !['customer', 'merchant'].includes(profile.role)) throw new Error('Customers and merchants can request deliveries.');
      const merchant = profile.role === 'merchant';
      const pickupStoreId = merchant ? (storeTeam.storeId || account.uid) : String(payload.merchantId || '');
      if (merchant && payload.merchantId && payload.merchantId !== pickupStoreId) throw new Error('Request deliveries from your current store.');
      const ref = doc(collection(db, 'orders'));
      const data = {
        creatorId: merchant ? pickupStoreId : account.uid, createdBy: account.uid, creatorRole: profile.role, customerName: profile.name, customerPhone: profile.phone,
        pickup: requireText(payload.pickup, 'Pickup location', 250), dropoff: requireText(payload.dropoff, 'Delivery location', 250),
        dropoffLocation: cleanCoordinates(payload.dropoffLocation),
        recipientName: requireText(payload.recipientName, 'Recipient name', 100), recipientPhone: requirePhone(payload.recipientPhone, 'Recipient phone number'),
        packageDescription: requireText(payload.packageDescription, 'Package details', 1000), fee: validateFee(payload.fee),
        preferredRiderId: String(payload.preferredRiderId || ''), merchantId: pickupStoreId,
        status: 'pending', riderId: null, riderName: '', customerRating: null, riderRating: null, customerRatingComment: '', riderRatingComment: '',
        customerRatedAt: null, riderRatedAt: null, assignedAt: null, pickedUpAt: null, deliveredAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      if (data.preferredRiderId.length > 128 || data.merchantId.length > 128 || data.preferredRiderId.includes('/') || data.merchantId.includes('/')) throw new Error('The selected rider or store is invalid.');
      await runTransaction(db, async transaction => {
        const owner = await transaction.get(doc(db, 'users', account.uid));
        if (!owner.exists() || !isActiveAccount(owner.data())) throw new Error('An active account is required to request a delivery.');
        if (data.preferredRiderId) {
          const selected = await transaction.get(doc(db, 'riders', data.preferredRiderId));
          if (!selected.exists() || !isApprovedRider({ ...selected.data(), role: 'rider' }) || !selected.data().online) throw new Error('Choose an approved rider who is online.');
        }
        if (data.merchantId) {
          const selected = await transaction.get(doc(db, 'stores', data.merchantId));
          if (!selected.exists() || !isActiveAccount(selected.data()) || selected.data().approvalStatus !== 'approved') throw new Error('Choose an approved, active store.');
          if (merchant) {
            if (selected.data().ownerId !== data.creatorId || !await merchantOrderAccess(transaction, { creatorRole: 'merchant', creatorId: data.creatorId, merchantId: data.merchantId }, account)) throw new Error('Your store access no longer allows new deliveries.');
            data.customerName = requireText(selected.data().name, 'Store name', 100);
            data.customerPhone = requirePhone(selected.data().phone, 'Store phone');
          }
          data.pickupLocation = cleanCoordinates(selected.data().location);
        }
        transaction.set(ref, data);
      });
      await notifyRiderOrder(account, ref.id);
      return ref.id;
    });
  }

  async function merchantOrderAccess(transaction, order, account) {
    if (profile?.role !== 'merchant' || order.creatorRole !== 'merchant' || order.creatorId !== order.merchantId) return false;
    if (order.creatorId === account.uid) return true;
    const member = await transaction.get(doc(db, 'storeMembers', order.merchantId + '_' + account.uid));
    if (!member.exists() || member.data().enabled !== true || member.data().storeId !== order.merchantId || member.data().userId !== account.uid) return false;
    const inviteId = requireText(member.data().inviteId, 'Store invitation ID', 256);
    if (inviteId.includes('/')) return false;
    const invite = await transaction.get(doc(db, 'storeInvites', inviteId));
    return invite.exists() && invite.data().status === 'accepted' && invite.data().storeId === order.merchantId && invite.data().ownerId === order.merchantId && invite.data().memberId === account.uid;
  }

  function acceptOrder(id) {
    return action(async () => {
      const account = activeSession();
      if (!isApprovedRider(profile)) throw new Error('Your rider profile must be approved before you can accept deliveries.');
      await runTransaction(db, async transaction => {
        const ref = doc(db, 'orders', requireDocumentId(id, 'Delivery ID'));
        const snapshot = await transaction.get(ref);
        const rider = await transaction.get(doc(db, 'users', account.uid));
        if (!snapshot.exists()) throw new Error('This delivery is no longer available.');
        const order = snapshot.data();
        if (!rider.exists() || !isApprovedRider(rider.data()) || !rider.data().online) throw new Error('An approved, active rider profile must be online to accept a delivery.');
        if (order.status !== 'pending' || order.riderId) throw new Error('Another rider has already accepted this delivery.');
        if (order.preferredRiderId && order.preferredRiderId !== account.uid) throw new Error('This delivery was requested from another rider.');
        transaction.update(ref, { status: 'accepted', riderId: account.uid, riderName: rider.data().name, assignedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
    });
  }

  function advanceOrder(id) {
    return action(async () => {
      const account = activeSession();
      const status = await runTransaction(db, async transaction => {
        const ref = doc(db, 'orders', requireDocumentId(id, 'Delivery ID'));
        const snapshot = await transaction.get(ref);
        const rider = await transaction.get(doc(db, 'users', account.uid));
        if (!snapshot.exists()) throw new Error('This delivery was not found.');
        const order = snapshot.data();
        if (!rider.exists() || !isApprovedRider(rider.data()) || order.riderId !== account.uid) throw new Error('Only an approved, active assigned rider can update this delivery.');
        const status = nextOrderStatus(order.status);
        if (!status) throw new Error('This delivery cannot move to another step.');
        transaction.update(ref, { status, updatedAt: serverTimestamp(), [status === 'picked_up' ? 'pickedUpAt' : 'deliveredAt']: serverTimestamp() });
        if (status === 'delivered') transaction.delete(doc(db, 'orders', id, 'tracking', 'rider'));
        return status;
      });
      return { sms: await notifyDeliverySms(account, id, status) };
    });
  }

  function cancelOrder(id) {
    return action(async () => {
      const account = activeSession();
      await runTransaction(db, async transaction => {
        const ref = doc(db, 'orders', requireDocumentId(id, 'Delivery ID'));
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new Error('This delivery was not found.');
        if (snapshot.data().creatorId !== account.uid && !await merchantOrderAccess(transaction, snapshot.data(), account)) throw new Error('You can only cancel deliveries for your own account or store.');
        if (snapshot.data().status !== 'pending') throw new Error('A rider has already accepted this delivery.');
        transaction.update(ref, { status: 'cancelled', updatedAt: serverTimestamp() });
      });
    });
  }

  function rateOrder(id, rating, comment = '') {
    return action(async () => {
      const account = activeSession();
      const score = Number(rating), text = String(comment).trim();
      if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('Choose a rating from 1 to 5.');
      if (text.length > 1000) throw new Error('Your review must be 1,000 characters or fewer.');
      await runTransaction(db, async transaction => {
        const ref = doc(db, 'orders', requireDocumentId(id, 'Delivery ID'));
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists() || snapshot.data().status !== 'delivered') throw new Error('You can rate a completed delivery.');
        const order = snapshot.data();
        const sender = order.creatorId === account.uid || await merchantOrderAccess(transaction, order, account);
        const prefix = sender ? 'customer' : order.riderId === account.uid ? 'rider' : null;
        if (!prefix) throw new Error('You can only rate a delivery you were part of.');
        if (order[prefix + 'Rating'] !== null) throw new Error('You have already rated this delivery.');
        transaction.update(ref, { [prefix + 'Rating']: score, [prefix + 'RatingComment']: text, [prefix + 'RatedAt']: serverTimestamp(), updatedAt: serverTimestamp() });
      });
    });
  }

  function submitFeedback(message) {
    return action(async () => {
      const account = activeSession(), ref = doc(collection(db, 'feedback')), batch = writeBatch(db);
      batch.set(ref, { ownerId: account.uid, role: profile.role, name: profile.name, message: requireText(message, 'Feedback', 2000), status: 'open', adminNote: '', reviewedBy: '', reviewedAt: null, createdAt: serverTimestamp() });
      await batch.commit();
      return ref.id;
    });
  }

  function adminReviewRider(uid, status, note = '') {
    return action(async () => {
      const id = requireDocumentId(uid, 'Rider ID'), reviewNote = cleanReviewNote(note, ['rejected', 'suspended'].includes(status));
      if (!APPROVAL_STATUSES.includes(status)) throw new Error('Choose a rider approval status.');
      return adminTransaction(async (transaction, account) => {
        const ref = doc(db, 'users', id), snapshot = await transaction.get(ref);
        if (!snapshot.exists() || snapshot.data().role !== 'rider') throw new Error('This rider account was not found.');
        const current = snapshot.data();
        const updated = { ...moderationFields(current, 'rider'), approvalStatus: status, reviewNote, reviewedBy: account.uid, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...(status !== 'approved' ? { online: false } : {}) };
        transaction.update(ref, updated);
        transaction.set(doc(db, 'riders', id), riderDirectory({ ...current, ...updated }));
        audit(transaction, account.uid, `rider_${status}`, 'rider', id, reviewNote);
      });
    });
  }

  function adminReviewStore(id, status, note = '') {
    return action(async () => {
      const storeId = requireDocumentId(id, 'Store ID'), reviewNote = cleanReviewNote(note, ['rejected', 'suspended'].includes(status));
      if (!APPROVAL_STATUSES.includes(status)) throw new Error('Choose a store approval status.');
      return adminTransaction(async (transaction, account) => {
        const ref = doc(db, 'stores', storeId), snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new Error('This store was not found.');
        const owner = await transaction.get(doc(db, 'users', snapshot.data().ownerId));
        if (!owner.exists() || owner.data().role !== 'merchant') throw new Error('The store owner account was not found.');
        transaction.update(ref, { ...moderationFields(snapshot.data(), 'store'), accountStatus: owner.data().accountStatus || 'active', approvalStatus: status, reviewNote, reviewedBy: account.uid, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        audit(transaction, account.uid, `store_${status}`, 'store', storeId, reviewNote);
      });
    });
  }

  function adminSetAccountStatus(uid, status, note = '') {
    return action(async () => {
      const id = requireDocumentId(uid, 'Account ID'), reviewNote = cleanReviewNote(note, status === 'suspended');
      if (!ACCOUNT_STATUSES.includes(status)) throw new Error('Choose active or suspended account status.');
      return adminTransaction(async (transaction, account) => {
        if (id === account.uid && status === 'suspended') throw new Error('You cannot suspend your own administrator account.');
        const ref = doc(db, 'users', id), snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new Error('This account was not found.');
        const current = snapshot.data();
        const storeRef = doc(db, 'stores', id);
        const store = current.role === 'merchant' ? await transaction.get(storeRef) : null;
        const updated = { ...moderationFields(current, current.role), accountStatus: status, reviewNote, reviewedBy: account.uid, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...(current.role === 'rider' && status === 'suspended' ? { online: false } : {}) };
        transaction.update(ref, updated);
        if (current.role === 'rider') transaction.set(doc(db, 'riders', id), riderDirectory({ ...current, ...updated }));
        if (store?.exists()) transaction.update(storeRef, { ...moderationFields(store.data(), 'store'), accountStatus: status, reviewNote, reviewedBy: account.uid, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        audit(transaction, account.uid, `account_${status}`, 'user', id, reviewNote);
      });
    });
  }

  function adminSaveProfile(uid, patch) {
    return action(async () => {
      const id = requireDocumentId(uid, 'Account ID');
      return adminTransaction(async (transaction, account) => {
        const ref = doc(db, 'users', id), snapshot = await transaction.get(ref);
        if (!snapshot.exists() || !ROLES.includes(snapshot.data().role)) throw new Error('This account was not found.');
        const existing = snapshot.data();
        const selected = Object.fromEntries(profileFields.filter(key => key in patch).map(key => [key, patch[key]]));
        const fields = cleanProfile({ ...existing, ...selected }, existing.role);
        const moderation = moderationFields(existing, existing.role);
        if (fields.online && (!isActiveAccount(existing) || moderation.approvalStatus !== 'approved')) throw new Error('Only approved, active riders can go online.');
        transaction.update(ref, { ...fields, ...moderation, updatedAt: serverTimestamp() });
        if (existing.role === 'rider') transaction.set(doc(db, 'riders', id), riderDirectory({ ...fields, ...moderation }));
        audit(transaction, account.uid, 'profile_updated', 'user', id, 'Administrator updated profile details.');
      });
    });
  }

  function adminSaveStore(id, payload) {
    return action(async () => {
      const storeId = requireDocumentId(id, 'Store ID');
      return adminTransaction(async (transaction, account) => {
        const ref = doc(db, 'stores', storeId), snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new Error('This store was not found.');
        const existing = snapshot.data(), fields = cleanStore({ ...existing, ...payload }, existing.ownerId);
        transaction.update(ref, { ...fields, ...moderationFields(existing, 'store'), updatedAt: serverTimestamp() });
        audit(transaction, account.uid, 'store_updated', 'store', storeId, 'Administrator updated store details.');
      });
    });
  }

  function adminManageOrder(id, orderAction, options = {}) {
    return action(async () => {
      const orderId = requireDocumentId(id, 'Delivery ID'), note = cleanAdminNote(options.note);
      if (orderAction === 'cancel' && !note) throw new Error('Enter a cancellation reason.');
      const status = await adminTransaction(async (transaction, account) => {
        const ref = doc(db, 'orders', orderId), snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new Error('This delivery was not found.');
        let rider = null;
        if (orderAction === 'assign') {
          const riderId = requireDocumentId(options.riderId, 'Rider ID'), selected = await transaction.get(doc(db, 'users', riderId));
          if (selected.exists()) rider = { ...selected.data(), id: riderId };
        }
        const fields = adminOrderChange(snapshot.data(), orderAction, rider, serverTimestamp());
        transaction.update(ref, fields);
        if (['assign', 'cancel'].includes(orderAction) || fields.status === 'delivered') transaction.delete(doc(db, 'orders', orderId, 'tracking', 'rider'));
        audit(transaction, account.uid, `order_${orderAction}`, 'order', orderId, note || (orderAction === 'assign' ? `Assigned to ${rider.name} (${rider.id}).` : ''));
        return fields.status;
      });
      if (['picked_up', 'delivered'].includes(status)) return { sms: await notifyDeliverySms(requireSession(), orderId, status) };
    });
  }

  function adminReviewFeedback(id, { status, note = '' }) {
    return action(async () => {
      const feedbackId = requireDocumentId(id, 'Feedback ID'), adminNote = cleanAdminNote(note);
      if (!FEEDBACK_STATUSES.includes(status)) throw new Error('Choose open, in review, or resolved feedback status.');
      return adminTransaction(async (transaction, account) => {
        const ref = doc(db, 'feedback', feedbackId), snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new Error('This feedback was not found.');
        transaction.update(ref, { status, adminNote, reviewedBy: account.uid, reviewedAt: serverTimestamp() });
        audit(transaction, account.uid, `feedback_${status}`, 'feedback', feedbackId, adminNote);
      });
    });
  }

  function adminSetAdmin(uid, enabled) {
    return action(async () => {
      const id = requireDocumentId(uid, 'Account ID');
      if (typeof enabled !== 'boolean') throw new Error('Choose whether administrator access is enabled.');
      return adminTransaction(async (transaction, account) => {
        if (id === account.uid) throw new Error('You cannot change your own administrator access.');
        const existing = await transaction.get(doc(db, 'users', id));
        if (!existing.exists()) throw new Error('Create this user account before granting administrator access.');
        if (enabled && !isActiveAccount(existing.data())) throw new Error('Activate this account before granting administrator access.');
        transaction.set(doc(db, 'admins', id), { enabled, updatedBy: account.uid, updatedAt: serverTimestamp() }, { merge: true });
        audit(transaction, account.uid, enabled ? 'admin_granted' : 'admin_revoked', 'admin', id, enabled ? 'Administrator access granted.' : 'Administrator access revoked.');
      });
    });
  }

  const visibleCollections = loadedScope === subscriptionScope && Boolean(subscriptionScope);
  const customerSmsReads = useCustomerSmsReads({ user, profile, messages: smsMessages, enabled: visibleCollections && !isAdmin });
  const merchantSmsReads = useMerchantSmsReads({ user, profile, messages: smsMessages, storeId: storeTeam.storeId, enabled: visibleCollections && !isAdmin });
  return <PlatformContext.Provider value={{
    user, profile, authLoading, authActionPending, isAdmin, hasAdminAccess, adminOtp, adminLoading,
    dataLoading: profileLoading || adminLoading || (!isAdmin && profile?.role === 'merchant' && storeTeam.loading) || (Boolean(subscriptionScope) && (loadedScope !== subscriptionScope || collectionsLoading)),
    riderRequestsReady: Boolean(subscriptionScope && riderRequestStream.scope === subscriptionScope && riderRequestStream.ready),
    firebaseConfigured: Boolean(auth && db), error: error || Object.values(dataReadErrors)[0] || '', dataReadErrors, retryData,
    stores: visibleCollections ? stores : [], riders: visibleCollections ? riders : [], orders: visibleCollections ? orders : [], feedback: visibleCollections ? feedback : [],
    liveLocations: visibleCollections ? liveLocations : {}, riderLocationSharing, storeTeam,
    smsMessages: visibleCollections && !isAdmin && ['customer','merchant'].includes(profile?.role) ? smsMessages : [], customerSmsReads, merchantSmsReads,
    recipientReviews: visibleCollections && !isAdmin && ['rider','merchant'].includes(profile?.role) ? recipientReviews : [],
    adminUsers: visibleCollections && isAdmin ? adminUsers : [], adminAdmins: visibleCollections && isAdmin ? adminAdmins : [], adminAudit: visibleCollections && isAdmin ? adminAudit : [],
    needsProfile: Boolean(user && !profile && !profileLoading && !profileReadFailed && !registering.current),
    register, login, logout, resetPassword, saveProfile, saveStore, createOrder, acceptOrder, advanceOrder, cancelOrder, rateOrder, submitFeedback,
    adminReviewRider, adminReviewStore, adminSetAccountStatus, adminSaveProfile, adminSaveStore, adminManageOrder, adminReviewFeedback, adminSetAdmin,
    clearError: () => setError(''),
  }}>{children}</PlatformContext.Provider>;
}

export function usePlatform() {
  const context = useContext(PlatformContext);
  if (!context) throw new Error('usePlatform must be used inside PlatformProvider.');
  return context;
}
