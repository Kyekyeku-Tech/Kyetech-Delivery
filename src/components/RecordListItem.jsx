import { useId } from 'react';
import { Button, Icon } from './UI';
import './record-list.css';

export default function RecordListItem({ reference, status, tone, onView, viewLabel, className = '', indicator }) {
  const headingId = useId();
  return <article className={`card record-list-row record-list-${tone} ${className}`} aria-labelledby={headingId}>
    <h3 id={headingId}><span>{reference}</span>{indicator}</h3>
    {status}
    <Button variant="secondary" className="record-list-view" aria-label={viewLabel} onClick={onView}><Icon name="eye" size={16}/>View</Button>
  </article>;
}
