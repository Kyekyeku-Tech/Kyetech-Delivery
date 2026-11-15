import { useEffect, useRef } from 'react';
import { Button, Icon } from '../components/UI';
import { MIN_DELIVERY_FEE, STATUS_LABELS, formatMoney } from '../lib/domain';
import './customer-delivery-guide.css';

const preparation = [
  { icon: 'map-pin', tone: 'blue', title: 'Make pickup easy', description: 'Add a working phone number, clear pickup and drop-off addresses, and a nearby landmark. Check any GPS address before sending.' },
  { icon: 'package', tone: 'orange', title: 'Get your package ready', description: 'Pack items securely, close lids and describe what the rider is collecting. Keep your package ready at the pickup point.' },
  { icon: 'store', tone: 'purple', title: 'Collecting from a store?', description: 'Confirm your items with the store first, then select it as your pickup store. Product prices and the delivery fee are separate.' },
];
const stages = [
  { status: 'pending', icon: 'clock', description: 'Your request is waiting for a rider to accept it.' },
  { status: 'accepted', icon: 'bike', description: 'A rider is assigned. Open the delivery details to call them.' },
  { status: 'picked_up', icon: 'package', description: 'Your package has been collected and is on the way.' },
  { status: 'delivered', icon: 'check', description: 'The rider has marked delivery complete. You can rate your rider.' },
];
const questions = [
  { question: 'Can I cancel my delivery?', answer: 'You can cancel while the request is still waiting for a rider to accept it. Open the request in My deliveries and choose Cancel request. Once a rider accepts, call them to discuss any changes.' },
  { question: 'Why can’t I see my rider on the map?', answer: 'Your rider needs to turn on live GPS sharing for that delivery. If a location is not available, you can still follow the delivery status and call the assigned rider.' },
  { question: 'Can I use my current location for drop-off?', answer: 'Use the GPS button in the delivery form if you’re receiving the package where you are. Check the detected address and add a nearby landmark before sending.' },
  { question: 'How do I rate a completed delivery?', answer: 'Open the delivered order in My deliveries, select View, then choose Rate rider. You can also open your completion message in the SMS tab to reach the rating form.' },
];

export default function CustomerDeliveryGuide({ onBack, onRequestDelivery, onViewDeliveries, onFeedback }) {
  const headingRef = useRef(null);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return <section className="customer-delivery-guide" aria-labelledby="delivery-guide-heading">
    <Button variant="ghost" className="delivery-guide-back" onClick={onBack}><Icon name="arrow-left" size={18}/>Back to home</Button>
    <header className="delivery-guide-hero"><div><span className="delivery-guide-eyebrow">A SMOOTHER DELIVERY STARTS HERE</span><h1 ref={headingRef} tabIndex={-1} id="delivery-guide-heading">Delivery guide</h1><p>Get your package ready, know what happens next and stay in touch with your rider.</p><div className="delivery-guide-hero-actions"><Button onClick={onRequestDelivery}><Icon name="send" size={18}/>Send a package</Button><Button variant="secondary" onClick={onViewDeliveries}><Icon name="package" size={18}/>View deliveries</Button></div></div><span className="delivery-guide-hero-icon" aria-hidden="true"><Icon name="bike" size={43}/></span></header>

    <section className="delivery-guide-preparation" aria-labelledby="delivery-guide-preparation-heading"><div className="delivery-guide-section-heading"><h2 id="delivery-guide-preparation-heading">Before your rider arrives</h2><p>A few useful details make collection easier.</p></div><div className="delivery-guide-preparation-grid">{preparation.map(item => <article key={item.title} className={'delivery-guide-tip delivery-guide-tip-' + item.tone}><span aria-hidden="true"><Icon name={item.icon} size={24}/></span><h3>{item.title}</h3><p>{item.description}</p></article>)}</div></section>

    <div className="delivery-guide-detail-grid">
      <section className="delivery-guide-tracking" aria-labelledby="delivery-guide-tracking-heading"><div className="delivery-guide-panel-heading"><span aria-hidden="true"><Icon name="send" size={23}/></span><div><h2 id="delivery-guide-tracking-heading">From request to doorstep</h2><p>Follow each stage in My deliveries.</p></div></div><ol className="delivery-guide-stages">{stages.map(stage => <li key={stage.status} className={'delivery-guide-stage delivery-guide-stage-' + stage.status}><span className="delivery-guide-stage-icon" aria-hidden="true"><Icon name={stage.icon} size={20}/></span><div><h3>{STATUS_LABELS[stage.status]}</h3><p>{stage.description}</p></div></li>)}</ol><div className="delivery-guide-map-note"><Icon name="map-pin" size={19}/><p>Select <strong>View</strong> on a delivery to see its details. A live rider map appears when the rider shares their GPS location during that delivery.</p></div></section>
      <aside className="delivery-guide-updates">
        <section className="delivery-guide-fee" aria-labelledby="delivery-guide-fee-heading"><span className="delivery-guide-panel-icon" aria-hidden="true"><Icon name="wallet" size={24}/></span><h2 id="delivery-guide-fee-heading">Your delivery fee</h2><span className="delivery-guide-fee-label">Delivery fees start at</span><strong className="delivery-guide-fee-amount">{formatMoney(MIN_DELIVERY_FEE)}</strong><span className="delivery-guide-cash">Pay in cash</span><p>The fee in your request is your offer. Confirm the agreed amount with your rider and pay them directly in cash.</p></section>
        <section className="delivery-guide-sms" aria-labelledby="delivery-guide-sms-heading"><span className="delivery-guide-panel-icon" aria-hidden="true"><Icon name="message" size={24}/></span><h2 id="delivery-guide-sms-heading">Pickup & completion updates</h2><p>Check the SMS tab for copies of your pickup and completion messages. After delivery, open the completion message or delivery details to rate your rider.</p></section>
      </aside>
    </div>

    <section className="delivery-guide-faq" aria-labelledby="delivery-guide-faq-heading"><div className="delivery-guide-section-heading"><h2 id="delivery-guide-faq-heading">Useful questions</h2><p>Tap a question to see the answer.</p></div><div className="delivery-guide-faq-list">{questions.map(item => <details key={item.question}><summary><span>{item.question}</span><Icon name="plus" size={18}/></summary><p>{item.answer}</p></details>)}</div></section>
    <section className="delivery-guide-feedback"><span aria-hidden="true"><Icon name="message" size={26}/></span><div><h2>Have something to share?</h2><p>Tell us about your experience with KyeTech.</p></div><Button variant="secondary" onClick={onFeedback}>Share feedback<Icon name="arrow-right" size={17}/></Button></section>
  </section>;
}
