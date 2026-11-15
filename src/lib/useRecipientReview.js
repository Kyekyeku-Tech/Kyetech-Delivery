import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { cleanRecipientReview, normalizeRecipientReviewInvite, recipientReviewStatus, validReviewToken } from './recipientReviews';

const unavailable = status => Object.assign(new Error('This feedback link is no longer available.'), { reviewStatus: status });

export default function useRecipientReview(token) {
  const [state, setState] = useState({ token: '', status: 'loading', invite: null, error: '' });
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const current = useRef(token), active = useRef(false), pending = useRef(null);
  current.current = token;

  useEffect(() => {
    active.current = true;
    setBusy(false);
    if (!validReviewToken(token)) { setState({ token, status: 'invalid', invite: null, error: '' }); return () => { active.current = false; }; }
    if (!db) { setState({ token, status: 'error', invite: null, error: 'The feedback page could not be opened. Please try again.' }); return () => { active.current = false; }; }
    let alive = true;
    setState({ token, status: 'loading', invite: null, error: '' });
    getDoc(doc(db, 'deliveryReviewLinks', token)).then(snapshot => {
      if (!alive || current.current !== token) return;
      if (!snapshot.exists()) { setState({ token, status: 'missing', invite: null, error: '' }); return; }
      const invite = normalizeRecipientReviewInvite(snapshot.data());
      setState({ token, status: recipientReviewStatus(invite), invite, error: '' });
    }).catch(() => {
      if (alive && current.current === token) setState({ token, status: 'error', invite: null, error: 'The feedback page could not be opened. Check your connection and try again.' });
    });
    return () => { alive = false; active.current = false; };
  }, [token, revision]);

  useEffect(() => {
    if (state.token !== token || state.status !== 'ready' || !state.invite) return;
    const timer = setInterval(() => {
      if (state.invite.expiresAt <= Date.now()) setState(value => value.token === token && value.status === 'ready' ? { ...value, status: 'expired', error: '' } : value);
    }, 1000);
    return () => clearInterval(timer);
  }, [state.token, state.status, state.invite?.expiresAt, token]);

  function submit(input) {
    if (pending.current?.token === token) return pending.current.promise;
    if (!db || !validReviewToken(token) || state.token !== token || state.status !== 'ready') return Promise.resolve(false);
    let values;
    try { values = cleanRecipientReview(input); }
    catch (cause) { setState(value => ({ ...value, error: cause.message })); return Promise.resolve(false); }
    const linkRef = doc(db, 'deliveryReviewLinks', token);
    setBusy(true); setState(value => ({ ...value, error: '' }));
    const promise = Promise.resolve().then(() => runTransaction(db, async transaction => {
      if (current.current !== token) throw unavailable('changed');
      const snapshot = await transaction.get(linkRef);
      if (!snapshot.exists()) throw unavailable('missing');
      const invite = normalizeRecipientReviewInvite(snapshot.data()), status = recipientReviewStatus(invite);
      if (status !== 'ready') throw unavailable(status);
      if (current.current !== token) throw unavailable('changed');
      transaction.set(doc(db, 'deliveryReviews', invite.orderId), {
        orderId: invite.orderId, merchantId: invite.merchantId, riderId: invite.riderId,
        ...values, reviewToken: token, createdAt: serverTimestamp(),
      });
      transaction.update(linkRef, { usedAt: serverTimestamp() });
    })).then(() => {
      if (active.current && current.current === token) setState(value => ({ ...value, status: 'submitted', error: '' }));
      return true;
    }).catch(async cause => {
      if (!active.current || current.current !== token) return false;
      if (cause.reviewStatus && cause.reviewStatus !== 'changed') {
        setState(value => ({ ...value, status: cause.reviewStatus, error: '' }));
        return false;
      }
      // A second client may have consumed the invite while this submission ran.
      // Read the capability invite only; recipient reviews and orders stay private.
      try {
        const snapshot = await getDoc(linkRef);
        if (!active.current || current.current !== token) return false;
        const invite = snapshot.exists() ? normalizeRecipientReviewInvite(snapshot.data()) : null;
        const status = snapshot.exists() ? recipientReviewStatus(invite) : 'missing';
        if (status !== 'ready') { setState({ token, status, invite, error: '' }); return false; }
      } catch { /* Retain the form and its inputs for a retry. */ }
      if (active.current && current.current === token) setState(value => ({ ...value, error: 'Your feedback could not be saved. Check your connection and try again.' }));
      return false;
    }).finally(() => {
      if (pending.current?.promise === promise) pending.current = null;
      if (active.current && current.current === token) setBusy(false);
    });
    pending.current = { token, promise };
    return promise;
  }

  return {
    status: state.token === token ? state.status : 'loading', invite: state.token === token ? state.invite : null,
    error: state.token === token ? state.error : '', busy, submit, reload: () => setRevision(value => value + 1),
  };
}
