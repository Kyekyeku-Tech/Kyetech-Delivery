import { useId, useState } from 'react';
import { Avatar, Brand, Button, Icon, RatingStars } from '../components/UI';
import useRecipientReview from '../lib/useRecipientReview';
import { recipientReviewReference } from '../lib/recipientReviews';
import './recipient-review.css';

const captions = ['Choose your rating', 'Very poor', 'Could be better', 'Okay', 'Good', 'Excellent'];
const messages = {
  invalid: ['This feedback link is invalid', 'Open the full link from your delivery SMS to share your feedback.'],
  missing: ['Feedback link not found', 'Open the link from your delivery SMS again. Contact the store if you need help with your delivery.'],
  expired: ['This feedback link has expired', 'This delivery’s feedback period has ended. Contact the store if you still need help.'],
  used: ['Feedback already received', 'A review has already been submitted for this delivery. Thank you for sharing your experience.'],
};

function ReviewRating({ label, name, tone, value, onChange, busy, icon }) {
  return <fieldset className={'recipient-rating-card recipient-rating-' + tone} disabled={busy}>
    <legend>{label}</legend>
    <div className="recipient-rating-person"><span className="recipient-rating-symbol" aria-hidden="true"><Icon name={icon} size={22}/></span><Avatar name={name} size={44}/><div><h2>{name}</h2><p>{tone === 'rider' ? 'Delivery and rider service' : 'Items and store service'}</p></div></div>
    <RatingStars value={value} onChange={onChange}/>
    <p className="recipient-rating-caption" role="status">{captions[value]}{value > 0 && <span>{value} out of 5</span>}</p>
  </fieldset>;
}

export default function RecipientReviewPage({ token = new URLSearchParams(window.location.search).get('token') || '' }) {
  const review = useRecipientReview(token), [riderRating, setRiderRating] = useState(0), [merchantRating, setMerchantRating] = useState(0), [comment, setComment] = useState('');
  const commentId = useId(), ready = review.status === 'ready', submitted = review.status === 'submitted';
  const reference = review.invite ? recipientReviewReference(review.invite.orderId) : '';
  return <main className="recipient-review-page">
    <header className="recipient-review-topbar"><Brand/><span><Icon name="message" size={16}/>Delivery feedback</span></header>
    <section className="recipient-review-shell">
      <header className="recipient-review-hero"><div><span>YOUR EXPERIENCE MATTERS</span><h1>{submitted ? 'Thank you for your feedback.' : 'How was your delivery?'}</h1><p>Share your experience with your rider and the store.</p>{reference && <span className="recipient-review-reference">{reference}</span>}</div><span className="recipient-review-hero-icon" aria-hidden="true"><Icon name="star" size={38}/></span></header>
      {review.status === 'loading' && <div className="recipient-review-loading" role="status"><span className="spinner"/>Opening your delivery feedback…</div>}
      {review.status === 'error' && <div className="recipient-review-state"><span><Icon name="message" size={30}/></span><h2>Feedback could not be opened</h2><p role="alert">{review.error}</p><Button variant="secondary" onClick={review.reload}>Try again</Button></div>}
      {messages[review.status] && <div className={'recipient-review-state' + (review.status === 'used' ? ' recipient-review-thanks' : '')}><span><Icon name={review.status === 'used' ? 'check' : 'message'} size={30}/></span><h2>{messages[review.status][0]}</h2><p>{messages[review.status][1]}</p><a className="button button-secondary" href="/">Open KyeTech</a></div>}
      {ready && <form className="recipient-review-form" onSubmit={event => { event.preventDefault(); if (!review.busy && riderRating && merchantRating) review.submit({ riderRating, merchantRating, comment }); }}>
        <div className="recipient-review-rating-grid"><ReviewRating label="Rate your rider" name={review.invite.riderName} tone="rider" value={riderRating} onChange={value => { if (!review.busy) setRiderRating(value); }} busy={review.busy} icon="bike"/><ReviewRating label="Rate the store" name={review.invite.merchantName} tone="store" value={merchantRating} onChange={value => { if (!review.busy) setMerchantRating(value); }} busy={review.busy} icon="store"/></div>
        <section className="recipient-review-comment"><label className="field" htmlFor={commentId}><span className="field-label" id={commentId + '-label'}>Your review (optional)</span><textarea id={commentId} aria-labelledby={commentId + '-label'} aria-describedby={commentId + '-hint'} value={comment} disabled={review.busy} onChange={event => setComment(event.target.value)} maxLength={1000} rows={4} placeholder="Tell us what went well or what could be better."/></label><div id={commentId + '-hint'} className="recipient-review-comment-hint"><span>A few words help riders and stores improve.</span><span>{comment.length} / 1000</span></div>{review.error && <p className="recipient-review-error" role="alert">{review.error}</p>}<Button type="submit" busy={review.busy} disabled={!riderRating || !merchantRating} className="recipient-review-submit"><Icon name="check" size={19}/>Send feedback</Button><p className="recipient-review-save-note">Choose a rating for both your rider and the store before sending.</p></section>
      </form>}
      {submitted && <div className="recipient-review-state recipient-review-thanks"><span><Icon name="check" size={32}/></span><h2>Your feedback has been saved</h2><p>You rated both your rider and the store. Your feedback helps make the next delivery better.</p><div className="recipient-review-saved"><div><Icon name="bike" size={20}/><span>{review.invite?.riderName}</span><strong>{riderRating}/5</strong></div><div><Icon name="store" size={20}/><span>{review.invite?.merchantName}</span><strong>{merchantRating}/5</strong></div></div><a className="button button-secondary" href="/">Open KyeTech</a></div>}
    </section>
    <footer className="recipient-review-footer">KyeTech Delivery<span>Local stores. Local riders. Better deliveries.</span></footer>
  </main>;
}
