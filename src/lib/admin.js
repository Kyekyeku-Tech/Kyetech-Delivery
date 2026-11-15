export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'suspended'];
export const ACCOUNT_STATUSES = ['active', 'suspended'];
export const FEEDBACK_STATUSES = ['open', 'in_review', 'resolved'];

export function moderationFields(data = {}, role = 'customer') {
  return {
    accountStatus: data.accountStatus || 'active',
    approvalStatus: data.approvalStatus || (role === 'rider' || role === 'store' ? 'pending' : 'approved'),
    reviewNote: data.reviewNote || '',
    reviewedBy: data.reviewedBy || '',
    reviewedAt: data.reviewedAt ?? null,
  };
}

export function isActiveAccount(profile) {
  return Boolean(profile) && (profile.accountStatus || 'active') === 'active';
}

export function isApprovedRider(profile) {
  return isActiveAccount(profile) && profile.role === 'rider' && (profile.approvalStatus || 'pending') === 'approved';
}

export function incomingRiderRequests(orders = [], profile) {
  if (!isApprovedRider(profile)) return [];
  return orders.filter(order => order.status === 'pending' && !order.riderId && (!order.preferredRiderId || order.preferredRiderId === profile.id));
}

export function cleanAdminNote(value = '') {
  const note = String(value || '').trim();
  if (note.length > 2000) throw new Error('Administrator notes must be 2,000 characters or fewer.');
  return note;
}

export function cleanReviewNote(value = '', required = false) {
  const note = String(value || '').trim();
  if (note.length > 1000) throw new Error('Review notes must be 1,000 characters or fewer.');
  if (required && !note) throw new Error('Enter a reason for rejecting or suspending this account or application.');
  return note;
}

export function adminOrderChange(order, action, rider, timestamp) {
  if (!order) throw new Error('This delivery was not found.');
  if (action === 'assign') {
    if (!['pending', 'accepted'].includes(order.status)) throw new Error('Only pending or accepted deliveries can be assigned.');
    if (!isApprovedRider(rider) || !rider.online) throw new Error('Choose an approved, active rider who is online.');
    return {
      status: 'accepted',
      riderId: rider.id,
      riderName: rider.name,
      assignedAt: timestamp,
      updatedAt: timestamp,
    };
  }
  if (action === 'cancel') {
    if (!['pending', 'accepted', 'picked_up'].includes(order.status)) throw new Error('This delivery can no longer be cancelled.');
    return { status: 'cancelled', updatedAt: timestamp };
  }
  if (action === 'picked_up') {
    if (order.status !== 'accepted') throw new Error('A rider must be assigned before pickup is confirmed.');
    return { status: 'picked_up', pickedUpAt: timestamp, updatedAt: timestamp };
  }
  if (action === 'delivered') {
    if (order.status !== 'picked_up') throw new Error('Confirm pickup before marking this delivery delivered.');
    return { status: 'delivered', deliveredAt: timestamp, updatedAt: timestamp };
  }
  throw new Error('Choose an assignment, cancellation, pickup, or delivery action.');
}
