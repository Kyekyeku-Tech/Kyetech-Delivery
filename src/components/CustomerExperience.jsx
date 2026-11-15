import { useId, useState } from 'react';
import { Avatar, Button, Icon, RatingStars } from './UI';
import { timestampMillis } from '../lib/domain';
import './customer-experience.css';

function deliveryDate(order) {
  const date = timestampMillis(order.deliveredAt || order.createdAt);
  return date ? new Date(date).toLocaleDateString('en-GH', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short' }) : 'Completed delivery';
}

function ExperienceHero({ tone, eyebrow, title, description, icon }) {
  return <div className={'experience-hero experience-hero-' + tone}>
    <div><span className="experience-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
    <span className="experience-hero-icon" aria-hidden="true"><Icon name={icon} size={36}/></span>
  </div>;
}

export function CustomerFeedbackForm({ message, onMessageChange, busy, error, onSubmit }) {
  const hintId = useId();
  return <form className="customer-experience customer-feedback" onSubmit={event => { event.preventDefault(); if (!busy && message.trim().length >= 3) onSubmit(); }}>
    <ExperienceHero tone="purple" eyebrow="KYETECH SUPPORT" title="Help us make your next delivery better." description="Tell us what went well, share an idea or let us know about a concern." icon="message"/>
    <div className="experience-panel">
      <label className="field" htmlFor={hintId + '-message'}><span className="field-label" id={hintId + '-label'}>Your message</span><textarea id={hintId + '-message'} aria-labelledby={hintId + '-label'} value={message} onChange={event => onMessageChange(event.target.value)} aria-describedby={hintId} required minLength={3} maxLength={2000} disabled={busy} rows={5} placeholder="Tell us about your delivery or share an idea…"/></label>
      <div className="experience-field-footer" id={hintId}><span>A few details help our team understand.</span><span>{message.length} / 2000</span></div>
      {error && <p className="experience-error" role="alert">{error}</p>}
      <Button type="submit" className="experience-submit" busy={busy} disabled={message.trim().length < 3}>Send feedback<Icon name="send" size={18}/></Button>
    </div>
    <div className="experience-note"><Icon name="shield" size={20}/><p>Your message goes directly to the KyeTech support team.</p></div>
  </form>;
}

export function RiderRatings({ orders, riders, onRate }) {
  const unrated = orders.filter(order => !order.customerRating), ratedCount = orders.length - unrated.length;
  const [filter, setFilter] = useState(unrated.length ? 'unrated' : 'all');
  const visible = orders.filter(order => filter === 'all' || (filter === 'rated' ? order.customerRating : !order.customerRating))
    .sort((a, b) => timestampMillis(b.deliveredAt || b.createdAt) - timestampMillis(a.deliveredAt || a.createdAt));
  return <div className="customer-experience customer-ratings">
    <ExperienceHero tone="orange" eyebrow="YOUR DELIVERY EXPERIENCE" title="Rate your recent deliveries." description="Choose a completed trip and tell your rider how it went." icon="star"/>
    <div className="experience-rating-totals"><div><span className="experience-total-icon"><Icon name="star" size={20}/></span><div><strong>{unrated.length}</strong><span>Ready to rate</span></div></div><div><span className="experience-total-icon"><Icon name="check" size={20}/></span><div><strong>{ratedCount}</strong><span>Already rated</span></div></div></div>
    <div className="experience-rating-filters" role="group" aria-label="Filter rider ratings">{[['all', 'All trips'], ['unrated', 'To rate'], ['rated', 'Rated']].map(([value, label]) => <button className={'experience-filter' + (filter === value ? ' experience-filter-active' : '')} type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    <div className="experience-rating-list">{visible.map(order => {
      const rider = riders.find(rider => rider.id === order.riderId), reference = 'KYE-' + order.id.slice(-6).toUpperCase();
      return <article className={'experience-rating-trip' + (order.customerRating ? ' experience-trip-rated' : '')} key={order.id}>
        <div className="experience-trip-heading"><Avatar name={order.riderName || 'Your rider'} src={rider?.photoUrl} size={44}/><div><h3>{order.riderName || 'Your rider'}</h3><small>{reference} · {deliveryDate(order)}</small></div>{order.customerRating ? <span className="experience-saved-rating"><Icon name="star" size={14}/>{order.customerRating}/5<span>Rated</span></span> : <Button className="experience-rate-trip" onClick={() => onRate(order)} aria-label={'Rate rider for ' + reference}><Icon name="star" size={16}/>Rate rider</Button>}</div>
        <p className="experience-trip-route" title={order.pickup + ' → ' + order.dropoff}><Icon name="map-pin" size={14}/><span>{order.pickup} → {order.dropoff}</span></p>
      </article>;
    })}</div>
    {!visible.length && <div className="experience-empty"><span><Icon name={orders.length ? 'check' : 'star'} size={28}/></span><h3>{!orders.length ? 'Your first review is ahead' : filter === 'rated' ? 'No ratings yet' : 'You’re all caught up'}</h3><p>{!orders.length ? 'Complete a delivery to leave a rating for your rider.' : filter === 'rated' ? 'Your saved rider ratings will appear here.' : 'Thanks for sharing your experience with your riders.'}</p></div>}
  </div>;
}

export function RiderRatingForm({ order, rider, rating, onRatingChange, message, onMessageChange, busy, error, onSubmit }) {
  const hintId = useId(), captions = ['Very poor', 'Could be better', 'Okay', 'Good', 'Excellent'];
  return <form className="customer-experience customer-rating-form" onSubmit={event => { event.preventDefault(); if (!busy) onSubmit(); }}>
    <div className="experience-rider-summary"><span className="experience-eyebrow">KYE-{order.id.slice(-6).toUpperCase()} · {deliveryDate(order)}</span><div><Avatar name={order.riderName || 'Your rider'} src={rider?.photoUrl} size={56}/><div><h2>{order.riderName || 'Your rider'}</h2><p>How was your experience with this rider?</p></div></div><div className="experience-rating-route"><p><span>Pickup</span><strong>{order.pickup}</strong></p><p><span>Drop-off</span><strong>{order.dropoff}</strong></p></div></div>
    <div className="experience-panel">
      <div className="experience-star-section"><h3>Your delivery rating</h3><div className={busy ? 'experience-stars-busy' : ''}><RatingStars value={rating} onChange={value => { if (!busy) onRatingChange(value); }}/></div><p className="experience-rating-caption" role="status">{captions[rating - 1]}<span>{rating} out of 5</span></p></div>
      <label className="field" htmlFor={hintId + '-review'}><span className="field-label" id={hintId + '-label'}>Your review (optional)</span><textarea id={hintId + '-review'} aria-labelledby={hintId + '-label'} value={message} onChange={event => onMessageChange(event.target.value)} maxLength={1000} aria-describedby={hintId} disabled={busy} rows={3} placeholder="What stood out about your delivery?"/></label>
      <div className="experience-field-footer" id={hintId}><span>Share a few words about your trip.</span><span>{message.length} / 1000</span></div>
      {error && <p className="experience-error" role="alert">{error}</p>}
      <Button type="submit" className="experience-submit" busy={busy}>Save rating<Icon name="check" size={18}/></Button>
    </div>
  </form>;
}
