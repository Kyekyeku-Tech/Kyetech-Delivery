import { ghanaSmsNumber, SMS_SENDER_ID, SmsSubmissionError } from './mnotify.mjs';
import { createDeliveryReviewInvite } from './deliveryReview.mjs';

export function deliverySmsForChange({ orderId, before, after, appUrl, merchantName }) {
  if (!before || !after || !['customer', 'merchant'].includes(after.creatorRole)) return null;
  const pickup = before.status === 'accepted' && after.status === 'picked_up';
  const complete = before.status === 'picked_up' && after.status === 'delivered';
  if ((!pickup && !complete) || !after.riderId || !after.creatorId || !/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) return null;
  const merchant = after.creatorRole === 'merchant';
  const recipient = ghanaSmsNumber(merchant ? after.recipientPhone : after.customerPhone);
  if (!recipient) return null;
  const reference = `KYE-${orderId.slice(-6).toUpperCase()}`;
  let reviewInvite = null;
  let message = `KyeTech: Your delivery ${reference} has been picked up and is on the way.`;
  if (complete) {
    const link = new URL(appUrl);
    if (link.protocol !== 'https:' || link.username || link.password) throw new Error('The SMS app URL must use HTTPS.');
    link.search = '';
    link.hash = '';
    if (merchant) {
      reviewInvite = createDeliveryReviewInvite({ orderId, order: after, merchantName });
      link.pathname = '/review';
      link.searchParams.set('token', reviewInvite.token);
      message = `Your KyeTech delivery ${reference} is complete. Please rate your rider and merchant store: ${link.href}`;
    } else {
      link.pathname = '/';
      link.searchParams.set('rate', orderId);
      message = `Your KyeTech delivery ${reference} is complete. Please rate your rider: ${link.href}`;
    }
  }
  return { id: `${orderId}_${after.status}`, orderId, customerId: merchant ? '' : after.creatorId, merchantId: merchant ? after.creatorId : '', type: after.status, recipient, sender: SMS_SENDER_ID, message, status: 'pending', recipientReviewToken: reviewInvite?.token || '', ...(reviewInvite ? { reviewInvite } : {}) };
}

export async function processDeliverySms({ claim, save, send }) {
  const job = await claim();
  if (!job) return 'skipped';
  let result;
  try {
    result = await send(job);
  } catch (error) {
    const known = error instanceof SmsSubmissionError;
    const status = known ? error.outcome : 'unknown';
    await save({ status, errorCode: known ? error.code : 'submission-outcome-unknown' });
    return status;
  }
  // Save errors must propagate. A retry sees the existing claim and does not send twice.
  await save({ status: 'submitted', providerCode: result.providerCode, campaignId: result.campaignId });
  return 'submitted';
}
