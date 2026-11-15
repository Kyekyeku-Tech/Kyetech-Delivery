export async function notifyDeliverySms(account, orderId, status, fetchImpl = fetch) {
  try {
    const token = await account.getIdToken();
    const response = await fetchImpl('/api/delivery-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orderId, status }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) return { status: 'unavailable' };
    const result = await response.json();
    return { status: ['submitted', 'submitting', 'failed', 'unknown', 'skipped'].includes(result.status) ? result.status : 'unavailable' };
  } catch {
    // SMS availability must not undo a confirmed pickup or completed delivery.
    return { status: 'unavailable' };
  }
}

export function deliveryUpdateNotice(result, success) {
  const status = result?.sms?.status;
  if (status === 'submitted') return { message: `${success} SMS sent to the customer.`, type: 'success' };
  if (status && !['submitting', 'skipped'].includes(status)) return { message: `${success} SMS could not be confirmed. Please call the customer.`, type: 'error' };
  return { message: success, type: 'success' };
}
