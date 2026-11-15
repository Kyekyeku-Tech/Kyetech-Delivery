import { StatusBadge } from './UI';
import RecordListItem from './RecordListItem';
import './delivery-history.css';

export default function DeliveryHistoryCard({ order, onView }) {
  const reference = 'KYE-' + order.id.slice(-6).toUpperCase();
  return <RecordListItem reference={reference} status={<StatusBadge status={order.status}/>} tone={order.status} className={'delivery-history-card delivery-history-' + order.status} viewLabel={'View delivery ' + reference} onView={() => onView(order)}/>;
}
