import { useMemo } from 'react';
import { isActiveAccount } from './admin';
import { getCustomerSmsMessages } from './customerSms';
import useSmsReadReceipts from './useSmsReadReceipts';

export default function useCustomerSmsReads({ user, profile, messages = [], enabled = true }) {
  const accountId = enabled && user?.uid === profile?.id && profile?.role === 'customer' && isActiveAccount(profile) ? user.uid : '';
  const eligible = useMemo(() => getCustomerSmsMessages(messages, accountId), [messages, accountId]);
  return useSmsReadReceipts({ accountId, messages: eligible });
}
