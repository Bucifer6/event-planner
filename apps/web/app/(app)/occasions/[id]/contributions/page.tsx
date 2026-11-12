import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { listNeeds } from '@eventdesk/core';
import { Card } from '@eventdesk/ui';
import { claimAction, createNeedAction, releaseAction } from '../../../../actions/contributions';

export default async function ContributionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const t = tf(locale);
  const needs = await listNeeds(id, user.accountId);
  return (
    <>
      {sp.error && <div className="error">{t(sp.error)}</div>}
      <Card>
        <h2>{t('contrib.new')}</h2>
        <form action={createNeedAction.bind(null, id)}>
          <input name="title" type="text" placeholder={t('contrib.title')} required />
          <input name="unitLabel" type="text" placeholder="unit" />
          <input name="totalUnits" type="number" min={1} placeholder={t('contrib.units')} />
          <div className="actions">
            <button className="btn" type="submit">
              {t('contrib.new')}
            </button>
          </div>
        </form>
      </Card>
      {needs.map((n) => (
        <Card key={n.id}>
          <div className="row between">
            <strong>{n.title}</strong>
            <span className="mono">
              {n.claimedUnits}
              {n.totalUnits ? ` / ${n.totalUnits}` : ''} {n.unitLabel ?? ''}
            </span>
          </div>
          <form action={claimAction.bind(null, id, n.id)}>
            <input name="units" type="number" min={1} defaultValue={1} style={{ maxWidth: 120 }} />
            <div className="actions">
              <button className="btn" type="submit">
                {t('contrib.claim')}
              </button>
            </div>
          </form>
          {n.claims.map((c) => (
            <div key={c.id} className="row between">
              <span className="mono">
                {c.units} — {c.memberId?.slice(0, 8)}
              </span>
              <form action={releaseAction.bind(null, id, c.id)}>
                <button className="btn secondary" type="submit">
                  {t('contrib.release')}
                </button>
              </form>
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}
