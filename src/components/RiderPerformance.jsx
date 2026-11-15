import { useState } from 'react';
import { Button, Icon } from './UI';
import { formatMoney } from '../lib/domain';
import { formatTripTime, getRiderPerformance } from '../lib/riderPerformance';
import './rider-performance.css';

export default function RiderPerformance({ orders, profile, totals, onRateCustomer }) {
  const performance = getRiderPerformance(orders, profile.id);
  const [selectedDay, setSelectedDay] = useState(performance.todayIndex), [allReviews, setAllReviews] = useState(false);
  const day = performance.days[selectedDay], maximum = Math.max(0, ...performance.days.map(day => day.fees));
  const reviews = allReviews ? performance.reviews : performance.reviews.slice(0, 3);
  const dateLabel = value => new Date(value).toLocaleDateString('en-GH', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short' });
  const metrics = [
    { label: 'Completion', tone: 'green', value: performance.completionRate == null ? '—' : Math.round(performance.completionRate) + '%', detail: performance.closedCount ? performance.completed.length + ' of ' + performance.closedCount + ' trips' : 'No finished trips' },
    { label: 'Avg. trip', tone: 'orange', value: formatTripTime(performance.averageMinutes), detail: performance.averageMinutes == null ? 'No trip times yet' : 'Pickup to door' },
    { label: 'Rating', tone: 'dark', value: <>{performance.rating == null ? '—' : performance.rating.toFixed(2)}{performance.rating != null && <Icon name="star" size={15}/>}</>, detail: performance.ratingCount ? performance.ratingCount + ' ' + (performance.ratingCount === 1 ? 'review' : 'reviews') : 'No reviews yet' },
  ];

  return <section className="rider-performance">
    <header className="rider-performance-heading"><h1>My Performance</h1><p>Ratings, trip completion &amp; weekly earnings</p></header>
    {totals}
    <div className="performance-metrics" role="group" aria-label="Rider performance metrics">
      {metrics.map(metric => <div key={metric.label} className={'card performance-metric performance-metric-' + metric.tone}>
        <h2>{metric.label}</h2><strong>{metric.value}</strong><p>{metric.detail}</p>
      </div>)}
    </div>

    <section className="card performance-earnings" aria-labelledby="performance-earnings-title">
      <header className="performance-earnings-heading"><div><h2 id="performance-earnings-title">Weekly earnings (GH₵)</h2><p>Mon – Sun · {profile.city || 'Your delivery area'}</p></div><strong className="performance-weekly-total">{formatMoney(performance.weeklyFees)}</strong></header>
      <div className="performance-earnings-chart" role="group" aria-label="Daily earnings for this week">
        {performance.days.map((day, index) => <button key={day.name} className={'performance-day' + (index === selectedDay ? ' performance-day-selected' : '')} type="button" aria-pressed={index === selectedDay} aria-label={day.name + ', ' + dateLabel(day.date) + ': ' + formatMoney(day.fees)} onClick={() => setSelectedDay(index)}>
          <span className="performance-bar-space"><span className={'performance-bar' + (!day.fees ? ' performance-bar-empty' : '')} style={{ height: (day.fees ? Math.max(2, day.fees / maximum * 92) : 5) + 'px' }}/></span>
          <span className="performance-day-letter" aria-hidden="true">{day.letter}</span>
        </button>)}
      </div>
      <div className="performance-day-details" aria-live="polite"><span>{day.name} · {dateLabel(day.date)}</span><strong>{formatMoney(day.fees)}</strong></div>
      <p className="performance-earnings-note">Recorded cash delivery fees</p>
    </section>

    <section className="card performance-reviews" aria-labelledby="performance-reviews-title">
      <header className="performance-reviews-heading"><h2 id="performance-reviews-title">Recent customer reviews</h2><Button variant="ghost" disabled={!performance.completed.length} onClick={onRateCustomer}>Rate customer<Icon name="arrow-right" size={14}/></Button></header>
      {reviews.length ? <div className="performance-review-list">{reviews.map(order => <article className="performance-review" key={order.id}>
        <div className="performance-review-heading"><h3>{order.customerName || 'Customer'} <span>({order.pickup} → {order.dropoff})</span></h3><strong>{order.customerRating.toFixed(1)}<Icon name="star" size={13}/></strong></div>
        {order.customerRatingComment && <p>“{order.customerRatingComment}”</p>}
      </article>)}</div> : <p className="performance-empty-reviews">Your customer ratings and reviews will appear here after completed deliveries.</p>}
      {performance.reviews.length > 3 && <Button className="performance-more-reviews" variant="ghost" onClick={() => setAllReviews(value => !value)}>{allReviews ? 'Show fewer reviews' : 'View all ' + performance.ratingCount + ' reviews'}<Icon name="arrow-right" size={14}/></Button>}
    </section>
  </section>;
}
