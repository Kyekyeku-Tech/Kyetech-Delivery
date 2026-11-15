import { useMemo } from 'react';
import { isActiveAccount } from './admin';
import { getMerchantSmsMessages } from './merchantSms';
import useSmsReadReceipts from './useSmsReadReceipts';

export default function useMerchantSmsReads({ user, profile, messages = [], storeId, enabled = true }) {
  const accountId = enabled && user?.uid === profile?.id && profile?.role === 'merchant' && isActiveAccount(profile) ? user.uid : '';
  const eligible = useMemo(() => accountId ? getMerchantSmsMessages(messages, storeId) : [], [accountId, messages, storeId]);
  return useSmsReadReceipts({ accountId, messages: eligible });
}
