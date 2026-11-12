import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/session';
import { getLocale, tf } from '../../../lib/i18n';
import { formatDate } from '@eventdesk/shared';
import { getBusinessForAccount, listBusinessOccasions } from '@eventdesk/core';
import { createBusinessOccasionAction, handoverOccasionAction } from '../../../actions/business';

// P-08 (P17/P22): business-owned occasions — created by any active member, with the
// same planning features; handover to the client ends business access and keeps history.
export default async function BusinessOccasionsPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = tf(locale);
  const business = await getBusinessForAccount(user.accountId);
  if (!business) redirect('/business');
  const occasions = await listBusinessOccasions(business.id, user.accountId);

  return (
    <main className="wrap">
      <div className="row between">
        <h1>{t('p.bocc.title')}</h1>
        <Link className="btn secondary" href="/business">
          {t('p.biz.title')}
        </Link>
      </div>
      {business.planLapsedAt && <div className="notice">{t('p.bocc.lapsed')}</div>}
      <form action={createBusinessOccasionAction.bind(null, business.id)}>
        <label htmlFor="title">{t('p.bocc.new')}</label>
        <input id="title" name="title" type="text" required />
        <label htmlFor="kind">{t('p.enq.occasion_kind')}</label>
        <input id="kind" name="kind" type="text" defaultValue="nunta" />
        <label htmlFor="dateStart">{t('p.enq.date')}</label>
        <input id="dateStart" name="dateStart" type="date" />
        <div className="actions">
          <button className="btn" type="submit">
            {t('p.bocc.create')}
          </button>
        </div>
      </form>
      {occasions.map((o) => (
        <div key={o.id} className="card">
          <h3 style={{ margin: 0 }}>
            <Link href={`/occasions/${o.id}`}>{o.title}</Link>
          </h3>
          <div className="muted mono">
            {o.dateStart ? formatDate(o.dateStart, locale) : '—'} · {o.status}
            {o.handedOverAt ? ` · ${t('p.bocc.handed_over')}` : ''}
          </div>
          {!o.handedOverAt && (
            <form action={handoverOccasionAction.bind(null, o.id)}>
              <label htmlFor={`client-${o.id}`}>{t('p.bocc.handover_to')}</label>
              <input
                id={`client-${o.id}`}
                name="clientAccountId"
                type="text"
                placeholder="account id"
                required
              />
              <button className="btn secondary" type="submit">
                {t('p.bocc.handover')}
              </button>
            </form>
          )}
        </div>
      ))}
    </main>
  );
}
