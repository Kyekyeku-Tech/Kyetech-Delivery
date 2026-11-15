import './sms-unread.css';

export default function SmsUnreadBadge({ count, className = '', hidden = false }) {
  if (!count) return null;
  return <span className={'sms-unread-badge ' + className} role="img" aria-label={count + ' unread SMS'} aria-hidden={hidden || undefined}>{count > 99 ? '99+' : count}</span>;
}
