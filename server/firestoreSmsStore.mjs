export function createFirestoreSmsStore({ job, projectId, token, actorId, fetchImpl = fetch }) {
  const documents = `projects/${projectId}/databases/(default)/documents`;
  const name = `${documents}/deliverySms/${job.id}`;
  const base = `https://firestore.googleapis.com/v1/${documents}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const store = {
    existingStatus: '',
    async claim() {
      const writes = [{
        update: { name, fields: {
          orderId: { stringValue: job.orderId }, type: { stringValue: job.type }, actorId: { stringValue: actorId },
          customerId: { stringValue: job.customerId }, merchantId: { stringValue: job.merchantId || '' }, sender: { stringValue: job.sender }, message: { stringValue: job.message },
          recipientReviewToken: { stringValue: job.recipientReviewToken || '' },
          status: { stringValue: 'submitting' }, errorCode: { stringValue: '' }, providerCode: { stringValue: '' }, campaignId: { stringValue: '' },
        } },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }, { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false },
      }];
      if (job.reviewInvite) {
        const invite = job.reviewInvite;
        if (invite.token !== job.recipientReviewToken || invite.orderId !== job.orderId || invite.merchantId !== job.merchantId || job.type !== 'delivered' || !/^[a-f0-9]{48}$/.test(invite.token)) throw new Error('The recipient review invitation does not match its SMS.');
        writes.push({
          update: { name: `${documents}/deliveryReviewLinks/${invite.token}`, fields: {
            orderId: { stringValue: invite.orderId }, merchantId: { stringValue: invite.merchantId }, riderId: { stringValue: invite.riderId },
            merchantName: { stringValue: invite.merchantName }, riderName: { stringValue: invite.riderName },
            expiresAt: { timestampValue: invite.expiresAt }, usedAt: { nullValue: null },
          } },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: false },
        });
      } else if (job.recipientReviewToken) throw new Error('A recipient review SMS requires its matching invitation.');
      const response = await fetchImpl(`${base}:commit`, {
        method: 'POST', headers, signal: AbortSignal.timeout(15000),
        // Reservation and review capability are one atomic claim: retries create neither twice.
        body: JSON.stringify({ writes }),
      });
      if (response.ok) return job;
      const failure = await response.json().catch(() => ({}));
      if (response.status !== 409 && !['ALREADY_EXISTS', 'FAILED_PRECONDITION'].includes(failure.error?.status)) throw new Error('SMS notification could not be reserved.');
      const existing = await fetchImpl(`https://firestore.googleapis.com/v1/${name}`, { headers, signal: AbortSignal.timeout(15000) });
      if (!existing.ok) throw new Error('SMS notification could not be checked.');
      const saved = await existing.json();
      store.existingStatus = saved.fields?.status?.stringValue || 'submitting';
      return null;
    },
    async save(patch) {
      const fields = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { stringValue: value }]));
      const response = await fetchImpl(`${base}:commit`, {
        method: 'POST', headers, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ writes: [{
          update: { name, fields }, updateMask: { fieldPaths: Object.keys(fields) },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: true },
        }] }),
      });
      if (!response.ok) throw new Error('SMS notification result could not be saved.');
    },
  };
  return store;
}
