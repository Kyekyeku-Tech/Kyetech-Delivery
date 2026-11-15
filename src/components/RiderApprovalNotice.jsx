import { Button, Icon } from './UI';
import { normalizeGhanaPhone } from '../lib/domain';

export default function RiderApprovalNotice({ profile, onUpdateProfile }) {
  const phone = normalizeGhanaPhone('0545454000');
  const message = 'Hello KyeTech admin. Please review my rider profile for approval. My name is ' + profile.name + '.';
  const title = profile.approvalStatus === 'rejected' ? 'Rider application needs attention'
    : profile.approvalStatus === 'suspended' ? 'Rider approval suspended' : 'Awaiting rider approval';

  return <div className="notice notice-warning rider-approval-notice">
    <div>
      <strong>{title}</strong>
      <p>Save your contact, photo and motorcycle details. An administrator must approve your rider profile before you can go online.</p>
      {profile.reviewNote && <p>{profile.reviewNote}</p>}
      <div className="rider-approval-actions">
        <Button variant="secondary" onClick={onUpdateProfile}>Update profile</Button>
        <a className="button button-secondary" href={'tel:' + phone}><Icon name="phone"/>Call admin</a>
        <a className="button button-secondary" href={'https://wa.me/' + phone.slice(1) + '?text=' + encodeURIComponent(message)} target="_blank" rel="noreferrer"><Icon name="message"/>WhatsApp admin</a>
      </div>
    </div>
  </div>;
}
