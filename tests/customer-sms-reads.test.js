import test from 'node:test';
import assert from 'node:assert/strict';
import { customerSmsReadKey, loadCustomerSmsReads, saveCustomerSmsReads } from '../src/lib/customerSmsReads.js';
import { getCustomerSmsMessages } from '../src/lib/customerSms.js';

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test('customer SMS selection ignores malformed references and preserves private submitted copies', () => {
  const sms = { id: 'trip_picked_up', orderId: 'trip', customerId: 'customer-one', type: 'picked_up', status: 'submitted', message: 'Your delivery is on the way.' };
  const records = [sms, null, { ...sms, id: undefined }, { ...sms, orderId: 2 }, { ...sms, orderId: '' }, { ...sms, orderId: 'invalid/path' }, { ...sms, customerId: 'customer-two' }, { ...sms, status: 'failed' }];
  assert.deepEqual(getCustomerSmsMessages(records, 'customer-one'), [sms]);
  assert.deepEqual(getCustomerSmsMessages(null, 'customer-one'), []);
});

test('viewed SMS IDs persist and merge without mixing customer accounts or Firebase projects', () => {
  const cache = storage(), key = customerSmsReadKey('project-one', 'customer-one');
  assert.deepEqual(saveCustomerSmsReads(key, ['pickup-one'], cache), { ids: ['pickup-one'], persisted: true });
  assert.deepEqual(saveCustomerSmsReads(key, ['complete-one', 'pickup-one'], cache), { ids: ['pickup-one', 'complete-one'], persisted: true });
  assert.deepEqual(loadCustomerSmsReads(key, cache), ['pickup-one', 'complete-one']);
  assert.deepEqual(loadCustomerSmsReads(customerSmsReadKey('project-one', 'customer-two'), cache), []);
  assert.deepEqual(loadCustomerSmsReads(customerSmsReadKey('project-two', 'customer-one'), cache), []);
});

test('malformed or unavailable browser storage never crashes and cannot falsely report a durable save', () => {
  const cache = storage();
  for (const value of ['bad JSON', '{}', 'null', '[null,4,"","a/b","pickup-one","pickup-one"]']) {
    cache.setItem('reads', value);
    assert.deepEqual(loadCustomerSmsReads('reads', cache), value.startsWith('[') ? ['pickup-one'] : []);
  }
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadCustomerSmsReads('reads', blocked), []);
  assert.deepEqual(saveCustomerSmsReads('reads', ['pickup-one'], blocked), { ids: ['pickup-one'], persisted: false });
  assert.deepEqual(saveCustomerSmsReads('reads', ['pickup-one'], null), { ids: ['pickup-one'], persisted: false });
  const quota = { getItem: () => '["pickup-one"]', setItem() { throw new Error('quota'); } };
  assert.deepEqual(saveCustomerSmsReads('reads', ['complete-one'], quota), { ids: ['pickup-one', 'complete-one'], persisted: false });
});
