import Link from 'next/link';
import { requireUser } from '../../lib/session';
import { getLocale, tf } from '../../lib/i18n';
import { getBusinessForAccount, listEnquiriesForBusiness } from '@eventdesk/core';
import { createBusinessAction, setNudgeAction } from '../../actions/business';

// P-01/P-05/P-06/P-07: the business area home — listings with moderation status,
// the enquiry inbox, the 48h-nudge switch (P32).
export default async function BusinessPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = tf(locale);
  const business = await getBusinessForAccount(user.accountId);

  if (!business) {
    return (
      <main className="wrap">
        <h1>{t('p.biz.title')}</h1>
        <div className="notice">{t('p.biz.empty')}</div>
        <form action={createBusinessAction}>
          <label htmlFor="name">{t('p.biz.name')}</label>
          <input id="name" name="name" type="text" required />
          <div className="actions">
            <button className="btn" type="submit">
              {t('p.biz.create')}
            </button>
          </div>
        </form>
      </main>
    );
  }

  const listings = business.listings ?? [];
  const enquiries = await listEnquiriesForBusiness(business.id, user.accountId);
  const openEnquiries = enquiries.filter((e) => e.state !== 'closed').length;

  return (
    <main className="wrap">
      <div className="row between">
        <h1>{t('p.biz.title')}</h1>
        <Link className="btn" href="/business/listings/new">
          {t('p.biz.new_listing')}
        </Link>
      </div>
      <h2>{business.name}</h2>
      {business.suspendedAt && <div className="notice">{t('p.biz.suspended_notice')}</div>}
      <form action={setNudgeAction.bind(null, business.id, !business.nudge48h)}>
        <label>
          {t('p.biz.nudge')}: {business.nudge48h ? t('p.biz.nudge_on') : t('p.biz.nudge_off')}
        </label>
        <div className="actions">
          <button className="btn secondary" type="submit">
            {business.nudge48h ? t('p.biz.nudge_off') : t('p.biz.nudge_on')}
          </button>
        </div>
      </form>
      <h2>{t('p.biz.listings')}</h2>
      {listings.length === 0 && <div className="notice">{t('p.biz.empty')}</div>}
      {listings.map((l) => (
        <Link
          key={l.id}
          href={`/business/listings/${l.id}`}
          className="card"
          style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
        >
          <h3 style={{ margin: 0 }}>{l.name}</h3>
          <div className="muted mono">
            {t(
              `p.biz.status.${l.status === 'live' ? 'live' : l.status === 'suspended' ? 'suspended' : 'pending'}`
            )}
            {l.claimed ? '' : ` · ${t('p.dir.unclaimed')}`}
          </div>
        </Link>
      ))}
      <h2>{t('p.biz.enquiries')}</h2>
      <Link className="btn secondary" href="/business/enquiries">
        {t('p.biz.enquiries')} ({openEnquiries})
      </Link>
      <div className="row">
        <Link className="btn secondary" href="/business/occasions">
          {t('p.bocc.title')}
        </Link>
        <Link className="btn secondary" href="/business/branding">
          {t('p.brand.title')}
        </Link>
        <Link className="btn secondary" href="/business/dashboard">
          {t('p.dash.title')}
        </Link>
        <Link className="btn secondary" href="/business/featured">
          {t('p.feat.title')}
        </Link>
      </div>
    </main>
  );
}
