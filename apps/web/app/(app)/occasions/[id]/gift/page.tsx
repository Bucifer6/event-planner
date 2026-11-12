import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { formatRon } from '@eventdesk/shared';
import { listGiftEstimates } from '@eventdesk/core';
import { giftAction } from '../../../../actions/releasec';

// C-11: gift estimator (calculator dar) — private per-planner range, labelled a
// cultural guide; no data shared; free forever; not in any paid tier.
export default async function GiftPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = tf(locale);
  const estimates = await listGiftEstimates(user.accountId);

  return (
    <main className="wrap">
      <h1>{t('c.gift.title')}</h1>
      <div className="notice">{t('c.gift.guide')}</div>
      <form action={giftAction}>
        <label htmlFor="relationship">{t('c.gift.rel')}</label>
        <select id="relationship" name="relationship" defaultValue="friend">
          <option value="family_close">{t('c.gift.family_close')}</option>
          <option value="family">{t('c.gift.family')}</option>
          <option value="friend_close">{t('c.gift.friend_close')}</option>
          <option value="friend">{t('c.gift.friend')}</option>
          <option value="colleague">{t('c.gift.colleague')}</option>
          <option value="acquaintance">{t('c.gift.acquaintance')}</option>
        </select>
        <label htmlFor="distance">{t('c.gift.distance')}</label>
        <select id="distance" name="distance" defaultValue="local">
          <option value="local">{t('c.gift.local')}</option>
          <option value="national">{t('c.gift.national')}</option>
          <option value="international">{t('c.gift.international')}</option>
        </select>
        <label htmlFor="venueType">{t('c.gift.venue')}</label>
        <select id="venueType" name="venueType" defaultValue="venue_hall">
          <option value="restaurant">{t('c.gift.restaurant')}</option>
          <option value="venue_hall">{t('c.gift.hall')}</option>
          <option value="home">{t('c.gift.home')}</option>
          <option value="other">{t('c.gift.other')}</option>
        </select>
        <label htmlFor="guestCount">{t('p.enq.guests')}</label>
        <input id="guestCount" name="guestCount" type="number" min={1} defaultValue={2} />
        <div className="actions">
          <button className="btn" type="submit">
            {t('c.gift.calc')}
          </button>
        </div>
      </form>
      {estimates.slice(0, 5).map((e) => (
        <div key={e.id} className="card mono">
          {formatRon(e.rangeMinBani, locale)} – {formatRon(e.rangeMaxBani, locale)}
        </div>
      ))}
    </main>
  );
}
