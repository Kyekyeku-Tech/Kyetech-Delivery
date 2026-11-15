import { useId, useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { Button, EmptyState, Field, Icon, Modal, SectionHeading } from '../components/UI';
import RecordListItem from '../components/RecordListItem';
import SmsUnreadBadge from '../components/SmsUnreadBadge';
import { timestampMillis } from '../lib/domain';
import { getCustomerSmsMessages } from '../lib/customerSms';
import '../sms.css';

function messageDate(value) {
  const millis = timestampMillis(value);
  if (!millis) return '';
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Accra', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(millis));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default function CustomerSmsPage({ notify, onRate }) {
  const { profile, smsMessages = [], orders = [], customerSmsReads } = usePlatform();
  const [type, setType] = useState('all'), [fromDate, setFromDate] = useState(''), [toDate, setToDate] = useState('');
  const [datesOpen, setDatesOpen] = useState(false), [selectedId, setSelectedId] = useState(null);
  const dateFiltersId = useId(), hasDates = Boolean(fromDate || toDate);
  const clearFilters = () => { setType('all'); setFromDate(''); setToDate(''); };
  const messages = getCustomerSmsMessages(smsMessages, profile.id);
  const selected = messages.find(item => item.id === selectedId);
  const selectedOrder = selected && orders.find(order => order.id === selected.orderId && order.creatorId === profile.id);
  const selectedDate = selected ? timestampMillis(selected.updatedAt || selected.createdAt) : 0;
  const selectedCompleted = selected?.type === 'delivered';
  const invalidDates = Boolean(fromDate && toDate && fromDate > toDate);
  const visible = invalidDates ? [] : messages.filter(item => {
    const day = messageDate(item.updatedAt || item.createdAt);
    return (type === 'all' || item.type === type) && (!fromDate || day >= fromDate) && (!toDate || (day && day <= toDate));
  }).sort((a, b) => timestampMillis(b.updatedAt || b.createdAt) - timestampMillis(a.updatedAt || a.createdAt));

  async function copyMessage(text) {
    try { await navigator.clipboard.writeText(text); notify('SMS copied.'); }
    catch { notify('Could not copy this message. Select the text to copy it.', 'error'); }
  }
  function viewMessage(item) {
    setSelectedId(item.id);
    if (customerSmsReads) customerSmsReads.markRead(item.id).catch(() => notify('Could not save this SMS as viewed. Open it again to retry.', 'error'));
  }

  return <section className="customer-sms">
    <SectionHeading title="Your SMS" subtitle="Copies of delivery messages sent to your phone."/>
    <div className="sms-filter-toolbar">
      <div className="filter-chips sms-type-filters" aria-label="Filter SMS by delivery stage">
        {[['all', 'All'], ['picked_up', 'Pickup'], ['delivered', 'Completed']].map(([value, label]) =>
          <button key={value} className={`chip ${type === value ? 'chip-active' : ''}`} aria-pressed={type === value} onClick={() => setType(value)}>{label}</button>
        )}
      </div>
      <Button variant="secondary" className={hasDates ? 'sms-date-filter-active' : ''} aria-expanded={datesOpen} aria-controls={dateFiltersId} onClick={() => setDatesOpen(open => !open)}><Icon name="clock" size={16}/>Date filter{hasDates && <span className="sms-date-filter-dot" aria-hidden="true"/>}</Button>
      {(type !== 'all' || hasDates) && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
    </div>
    <div id={dateFiltersId} className="sms-date-filters" role="group" aria-label="SMS date filters" hidden={!datesOpen}>
      <Field label="From date" type="date" value={fromDate} max={toDate || undefined} onChange={event => setFromDate(event.target.value)}/>
      <Field label="To date" type="date" value={toDate} min={fromDate || undefined} onChange={event => setToDate(event.target.value)}/>
    </div>
    {hasDates && <p className="sms-active-dates">{fromDate ? 'From ' + new Date(fromDate + 'T00:00:00Z').toLocaleDateString('en-GH', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', year: 'numeric' }) : 'Any start date'} · {toDate ? 'To ' + new Date(toDate + 'T00:00:00Z').toLocaleDateString('en-GH', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', year: 'numeric' }) : 'Any end date'}</p>}
    {invalidDates && <p className="form-error" role="alert">Choose an end date on or after the start date.</p>}
    <p className="muted sms-result-count" role="status">{visible.length} {visible.length === 1 ? 'message' : 'messages'}</p>
    <div className="record-list sms-message-list">
      {visible.map(item => {
        const completed = item.type === 'delivered';
        const reference = 'KYE-' + item.orderId.slice(-6).toUpperCase();
        const unread = customerSmsReads?.isUnread(item.id);
        return <RecordListItem key={item.id} reference={reference} tone={item.type} className={'sms-message-card' + (unread ? ' sms-message-unread' : '')} indicator={unread && <SmsUnreadBadge count={1}/>} status={<span className={`status-badge ${completed ? 'status-delivered' : 'status-picked_up'}`}>{completed ? 'Completed' : 'Pickup'}</span>} viewLabel={`View ${completed ? 'completed delivery' : 'pickup'} SMS ${reference}`} onView={() => viewMessage(item)}/>;
      })}
      {!visible.length && <EmptyState icon="message" title={messages.length ? 'No SMS match these filters' : 'No SMS yet'} description={messages.length ? 'Try a different date range or delivery stage.' : 'Your pickup and completion messages will appear here.'} action={messages.length ? <Button variant="secondary" onClick={clearFilters}>Show all SMS</Button> : undefined}/>}
    </div>
    {selectedId && <Modal title="SMS details" onClose={() => setSelectedId(null)}>{selected ? <article className="sms-message-detail">
          <header className="sms-message-header">
            <span className="sms-sender-icon"><Icon name="message"/></span>
            <div className="sms-message-heading"><h3>{selected.sender || 'KYE-TECH'}</h3>{selectedDate > 0 && <time dateTime={new Date(selectedDate).toISOString()}>{new Date(selectedDate).toLocaleString('en-GH', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>}</div>
            <span className={`status-badge ${selectedCompleted ? 'status-delivered' : 'status-picked_up'}`}>{selectedCompleted ? 'Completed' : 'Pickup'}</span>
          </header>
          <p className="sms-message-body">{selected.message}</p>
          <div className="sms-message-footer">
            <span className="muted">KYE-{selected.orderId.slice(-6).toUpperCase()}</span>
            <div className="sms-message-actions">
              <Button variant="secondary" aria-label={`Copy ${selectedCompleted ? 'completed delivery' : 'pickup'} SMS KYE-${selected.orderId.slice(-6).toUpperCase()}`} onClick={() => copyMessage(selected.message)}><Icon name="copy"/>Copy message</Button>
              {selectedCompleted && selectedOrder?.status === 'delivered' && !selectedOrder.customerRating && <Button onClick={() => { setSelectedId(null); onRate(selectedOrder); }}><Icon name="star"/>Rate rider</Button>}
            </div>
          </div>
        </article> : <EmptyState icon="message" title="SMS unavailable" description="This message is no longer in your inbox."/>}</Modal>}
  </section>;
}
