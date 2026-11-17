import { resolveMx, resolve4, resolve6 } from 'node:dns/promises';

export class EmailDomainError extends Error {
  constructor(reason) { super('The verification email domain is unavailable.'); this.reason = reason; }
}

export async function checkEmailDeliveryDomain(email, dns = { resolveMx, resolve4, resolve6 }) {
  const domain = email.split('@')[1];
  if (!domain) throw new EmailDomainError('email-domain');
  try {
    const records = await dns.resolveMx(domain);
    if (records.some(record => record.exchange && record.exchange !== '.')) return;
    if (records.length) throw new EmailDomainError('email-domain');
  } catch (error) {
    if (error instanceof EmailDomainError) throw error;
    if (error.code === 'ENOTFOUND') throw new EmailDomainError('email-domain');
    if (error.code !== 'ENODATA') throw new EmailDomainError('unavailable');
  }
  // SMTP permits delivery to the domain's address when no MX record is published.
  const addresses = await Promise.allSettled([dns.resolve4(domain), dns.resolve6(domain)]);
  if (addresses.some(result => result.status === 'fulfilled' && result.value.length)) return;
  const transient = addresses.some(result => result.status === 'rejected' && !['ENOTFOUND', 'ENODATA'].includes(result.reason.code));
  throw new EmailDomainError(transient ? 'unavailable' : 'email-domain');
}
