import Link from 'next/link';
import { requireUser } from '../../lib/session';
import { getLocale, tf } from '../../lib/i18n';
import { listOccasionsForAccount } from '@eventdesk/core';
import { formatDate } from '@eventdesk/shared';
import { getPlannerAppearance } from '../../lib/planner-appearance';
import { PlannerDashboard } from '../../../components/PlannerDashboard';

export default async function DashboardPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = tf(locale);
  const occasions = await listOccasionsForAccount(user.accountId);
  if ((await getPlannerAppearance()) !== 'garden') {
    return (
      <PlannerDashboard
        title={t('dash.title')}
        createLabel={t('dash.new')}
        emptyLabel={t('dash.empty')}
        events={occasions.map((occasion) => ({
          id: occasion.id,
          title: occasion.title,
          date: occasion.dateStart ? formatDate(occasion.dateStart, locale) : t('common.unknown'),
          status: occasion.status,
        }))}
        renderLink={(href, className, content) => (
          <Link href={href} className={className}>
            {content}
          </Link>
        )}
      />
    );
  }
  return (
    <main className="wrap">
      <div className="row between">
        <h1>{t('dash.title')}</h1>
        <Link className="btn" href="/occasions/new">
          {t('dash.new')}
        </Link>
      </div>
      {occasions.length === 0 && <div className="notice">{t('dash.empty')}</div>}
      {occasions.map((o) => (
        <Link key={o.id} href={`/occasions/${o.id}`} className="card link">
          <h2 style={{ margin: 0 }}>{o.title}</h2>
          <div className="muted mono">
            {o.dateStart ? formatDate(o.dateStart, locale) : t('common.unknown')} · {o.status}
          </div>
        </Link>
      ))}
    </main>
  );
}
