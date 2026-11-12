import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/session';
import { getLocale, tf } from '../../../lib/i18n';
import { formatDate } from '@eventdesk/shared';
import { businessDashboard, getBusinessForAccount } from '@eventdesk/core';

// P21: dashboard and reports across the business's occasions, including asset usage
// as DAILY TOTALS without visitor identifiers (D4).
export default async function BusinessDashboardPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = tf(locale);
  const business = await getBusinessForAccount(user.accountId);
  if (!business) redirect('/business');
  const dash = await businessDashboard(business.id, user.accountId, 30);

  return (
    <main className="wrap">
      <h1>{t('p.dash.title')}</h1>
      <h2>{t('p.dash.occasions')}</h2>
      {dash.occasions.length === 0 && <div className="notice">{t('p.dash.no_occasions')}</div>}
      {dash.occasions.map((o) => (
        <div key={o.id} className="card">
          <Link href={`/occasions/${o.id}`}>{o.title}</Link>
          <div className="muted mono">
            {o.status} · {t('p.dash.tasks')}: {o.tasks} · {t('p.dash.guests')}: {o.households} ·{' '}
            {t('p.dash.expenses')}: {o.expenses}
            {o.handedOverAt ? ` · ${t('p.bocc.handed_over')}` : ''}
          </div>
        </div>
      ))}
      <h2>{t('p.dash.listings')}</h2>
      {dash.listings.map((l) => (
        <div key={l.id} className="card">
          {l.name} · {l.status}
          {l.stats && (
            <span className="muted mono">
              {' '}
              — {l.stats.answered}/{l.stats.sent}
            </span>
          )}
          <div className="muted">{l.categories.join(' · ')}</div>
        </div>
      ))}
      <h2>{t('p.dash.asset_usage')}</h2>
      <p className="muted">{t('p.dash.asset_usage_hint')}</p>
      <table>
        <thead>
          <tr>
            <th>{t('p.enq.date')}</th>
            <th>{t('p.dash.kind')}</th>
            <th>{t('p.dash.asset')}</th>
            <th>{t('p.dash.uses')}</th>
          </tr>
        </thead>
        <tbody>
          {dash.assetUsageDaily.map((u) => (
            <tr key={`${u.day.toISOString()}-${u.assetId}`}>
              <td className="mono">{formatDate(u.day, locale)}</td>
              <td>{u.assetKind}</td>
              <td className="mono">{u.assetId.slice(0, 8)}</td>
              <td>{u.uses}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t('p.dash.enquiries30d')}</h2>
      <p className="mono">
        {dash.enquiries30d.sent} / {dash.enquiries30d.answered}
      </p>
    </main>
  );
}
