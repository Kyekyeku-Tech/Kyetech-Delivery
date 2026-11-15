import { useState } from 'react';
import { Icon } from './UI';
import { timestampMillis } from '../lib/domain';
import './recipient-reviews.css';

export default function RecipientReviews({ reviews = [], role = 'merchant' }) {
  const [expanded, setExpanded] = useState(false);
  const merchant = role === 'merchant';
  const records = (Array.isArray(reviews) ? reviews : []).filter(review => review && typeof review.orderId === 'string' && Number.isInteger(review.riderRating) && review.riderRating >= 1 && review.riderRating <= 5 && Number.isInteger(review.merchantRating) && review.merchantRating >= 1 && review.merchantRating <= 5)
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
  const average = key => records.length ? (records.reduce((sum, review) => sum + review[key], 0) / records.length).toFixed(1) : '—';
  return <section className="recipient-feedback-panel" aria-label="Recipient feedback">
    <header><span className="recipient-feedback-icon"><Icon name="star" size={24}/></span><div><h2>{merchant ? 'Recipient feedback' : 'Ratings from recipients'}</h2><p>{merchant ? 'See how recipients rated your store and their delivery.' : 'Feedback from the people who received your deliveries.'}</p></div></header>
    <div className="recipient-feedback-totals">
      <div><span>{merchant ? 'Store rating' : 'Rider rating'}</span><strong>{average(merchant ? 'merchantRating' : 'riderRating')}<small>/ 5</small></strong></div>
      <div><span>{merchant ? 'Delivery rating' : 'Recipient reviews'}</span><strong>{merchant ? average('riderRating') : records.length}{merchant && <small>/ 5</small>}</strong></div>
    </div>
    <p className="recipient-feedback-count">{records.length} {records.length === 1 ? 'recipient review' : 'recipient reviews'}</p>
    <div className="recipient-feedback-list">{records.slice(0, expanded ? records.length : 3).map(review => {
      const date = timestampMillis(review.createdAt);
      return <article key={review.orderId}>
        <div><strong>KYE-{review.orderId.slice(-6).toUpperCase()}</strong><span><Icon name="star" size={14}/>Rider {review.riderRating}/5{merchant && <> · Store {review.merchantRating}/5</>}</span></div>
        {typeof review.comment === 'string' && review.comment.trim() && <p>{review.comment}</p>}
        {date > 0 && <time dateTime={new Date(date).toISOString()}>{new Date(date).toLocaleDateString('en-GH', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', year: 'numeric' })}</time>}
      </article>;
    })}</div>
    {!records.length && <p className="recipient-feedback-empty">{merchant ? 'Ratings will appear after recipients review a completed delivery from their SMS link.' : 'Your first recipient review will appear here after a completed delivery.'}</p>}
    {records.length > 3 && <button className="button button-secondary" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer reviews' : 'View all recipient reviews'}</button>}
  </section>;
}
