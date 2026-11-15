export function getCustomerSmsMessages(messages = [], customerId) {
  if (!customerId) return [];
  if (!Array.isArray(messages)) return [];
  return messages.filter(item => item && typeof item.id === 'string' && item.id && !item.id.includes('/') && typeof item.orderId === 'string' && item.orderId && !item.orderId.includes('/') && item.customerId === customerId && item.status === 'submitted' && ['picked_up', 'delivered'].includes(item.type) && typeof item.message === 'string' && item.message.trim());
}
