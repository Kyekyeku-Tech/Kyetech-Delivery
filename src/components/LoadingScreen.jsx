import { useId } from 'react';
import { Brand, Icon } from './UI';
import './loading-screen.css';

export default function LoadingScreen({ compact = false, message = 'App loading…' }) {
  const messageId = useId(), helperId = useId(), Heading = compact ? 'h2' : 'h1';

  return <div className={`app-loading-screen${compact ? ' app-loading-screen-compact' : ''}`} role="status" aria-live="polite" aria-atomic="true" aria-labelledby={messageId} aria-describedby={!compact ? helperId : undefined} aria-busy="true">
    <div className="app-loading-panel">
      {!compact && <div className="app-loading-brand" aria-hidden="true"><Brand/></div>}
      <div className="app-loading-journey" aria-hidden="true">
        <span className="app-loading-halo"/>
        <span className="app-loading-orbit"/>
        <span className="app-loading-spark app-loading-spark-one"/>
        <span className="app-loading-spark app-loading-spark-two"/>
        <span className="app-loading-parcel"><Icon name="package" size={20}/></span>
        <svg className="app-loading-route" viewBox="0 0 292 178" fill="none" focusable="false">
          <path className="app-loading-route-base" d="M35 136C81 136 90 116 146 116s65 20 111 20"/>
          <path className="app-loading-route-dashes" d="M35 136C81 136 90 116 146 116s65 20 111 20"/>
        </svg>
        <span className="app-loading-stop app-loading-stop-store"><Icon name="store" size={20}/></span>
        <span className="app-loading-stop app-loading-stop-pin"><Icon name="map-pin" size={20}/></span>
        <span className="app-loading-rider"><span className="app-loading-speed"/><Icon name="bike" size={38}/></span>
      </div>
      <div className="app-loading-copy">
        <Heading id={messageId}>{message}</Heading>
        {!compact && <p id={helperId} className="app-loading-helper">Your deliveries and updates, in one place.</p>}
        <div className="app-loading-progress" aria-hidden="true"><span/></div>
        <div className="app-loading-dots" aria-hidden="true"><span/><span/><span/></div>
      </div>
    </div>
  </div>;
}
