export function getMerchantSmsMessages(messages = [], storeId) {
  if (!storeId) return [];
  return messages.filter(item => item && typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,1500}$/.test(item.id) && typeof item.orderId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item.orderId) && item.merchantId === storeId && item.status === 'submitted' && ['picked_up', 'delivered'].includes(item.type) && typeof item.message === 'string' && item.message.trim());
}
