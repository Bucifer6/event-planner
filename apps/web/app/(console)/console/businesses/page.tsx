import { prisma } from '@eventdesk/db';
import { Card, Notice } from '@eventdesk/ui';
import { getLocale, tf } from '../../../lib/i18n';
import { setBusinessSuspensionAction } from '../../../actions/pconsole';

// W3: restrict/restore businesses with a recorded reason. Survives staff session end
// (DB row); the business is blocked from creating listings (P18 guard in core).
export default async function BusinessesPage() {
  const locale = await getLocale();
  const t = tf(locale);
  const businesses = await prisma.business.findMany({
    include: { listings: { select: { id: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return (
    <>
      <h1>{t('p.con.businesses.title')}</h1>
      {businesses.length === 0 && <Notice>—</Notice>}
      {businesses.map((b) => (
        <Card key={b.id}>
          <strong>{b.name}</strong> · {b.listings.length} listings
          {b.suspendedAt && (
            <div className="notice">
              {t('p.biz.status.suspended')}: {b.suspensionReason ?? '—'}
            </div>
          )}
          <form action={setBusinessSuspensionAction.bind(null, b.id, !b.suspendedAt)}>
            <input name="reason" type="text" placeholder={t('p.con.reason_ph')} />
            <button className={b.suspendedAt ? 'btn' : 'btn attention'} type="submit">
              {b.suspendedAt ? t('p.con.restore') : t('p.con.suspend')}
            </button>
          </form>
        </Card>
      ))}
    </>
  );
}
