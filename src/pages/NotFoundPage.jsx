import { useEffect } from 'react';
import { Brand, Button, Icon } from '../components/UI';
import './not-found.css';

export default function NotFoundPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = '404 - Page not found | KyeTech Delivery';
    return () => { document.title = previousTitle; };
  }, []);

  function goBack() {
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
  }

  return <div className="not-found-page">
    <header className="not-found-header"><a href="/" aria-label="KyeTech Delivery home"><Brand/></a><span>Local deliveries. A little closer.</span></header>
    <main className="not-found-main">
      <div className="not-found-art" aria-hidden="true">
        <span className="not-found-code">404</span>
        <span className="not-found-pin"><Icon name="map-pin" size={34}/></span>
        <span className="not-found-parcel"><Icon name="package" size={48}/></span>
        <svg className="not-found-route" viewBox="0 0 300 240" preserveAspectRatio="none" fill="none"><ellipse cx="150" cy="120" rx="145" ry="114"/></svg>
      </div>
      <div className="not-found-copy">
        <p className="not-found-eyebrow">404 / A LITTLE OFF ROUTE</p>
        <h1>We couldn't find<br/>this page.</h1>
        <p className="not-found-description">The link may have changed, or the address may be mistyped. Your next delivery is just a tap away.</p>
        <div className="not-found-actions"><a className="button button-primary" href="/"><Icon name="home" size={19}/>Back to home</a><Button variant="secondary" onClick={goBack}><Icon name="arrow-left" size={19}/>Go back</Button></div>
      </div>
    </main>
    <footer className="not-found-footer">KyeTech Delivery<span>Helping you get from here to there.</span></footer>
  </div>;
}
