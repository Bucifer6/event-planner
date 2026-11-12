import Link from 'next/link';
import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { prisma } from '@eventdesk/db';
import { fitCheckSeating, getSpaceModel } from '@eventdesk/core';
import {
  mealStageAction,
  publishSeatingAction,
  saveSeatingAction,
} from '../../../../actions/releasec';

// C-01/C-02/C-08: seating on the space model. The form below IS the tap path (Q10) —
// every arrangement action works without dragging; drag is only an extra affordance.
export default async function SeatingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const households = await prisma.household.findMany({ where: { occasionId: id } });
  const plan = await prisma.seatingPlan.findFirst({
    where: { occasionId: id },
    orderBy: { version: 'desc' },
    include: { assignments: true },
  });
  const model = await getSpaceModel(id, user.accountId);
  const fit = model ? await fitCheckSeating(id, user.accountId) : null;
  const stages = await prisma.mealStage.findMany({
    where: { occasionId: id },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <>
      <h2>{t('c.seat.title')}</h2>
      {fit && (
        <p className="muted mono">
          {t('c.seat.fit')}: {t('p.space.fit_checked', { checked: fit.checked })} ·{' '}
          {t('p.space.fit_unknown', { excluded: fit.excludedUnknown })}
        </p>
      )}
      {plan?.published && <div className="notice">{t('c.seat.published')}</div>}
      <form action={saveSeatingAction.bind(null, id)}>
        {households.map((h) => {
          const cur = plan?.assignments.find((a) => a.householdId === h.id);
          return (
            <div key={h.id} className="card">
              <strong>{h.name}</strong>
              <input type="hidden" name="householdId" value={h.id} />
              <label>{t('c.seat.table')}</label>
              <input
                name="tableRef"
                type="text"
                defaultValue={cur?.tableRef ?? ''}
                placeholder="t1 / custom:x"
              />
              <label>{t('c.seat.seat')}</label>
              <input name="seat" type="text" defaultValue={cur?.seat ?? ''} />
            </div>
          );
        })}
        <div className="actions">
          <button className="btn" type="submit">
            {t('common.save')}
          </button>
        </div>
      </form>
      {!plan?.published && (
        <form action={publishSeatingAction.bind(null, id)}>
          <button className="btn attention" type="submit">
            {t('c.seat.publish')}
          </button>
        </form>
      )}
      <h3>{t('c.seat.stages')}</h3>
      <form action={mealStageAction.bind(null, id)}>
        <input name="label" type="text" placeholder={t('c.seat.stage_label')} required />
        <input name="guestCount" type="number" min={1} defaultValue={households.length} />
        <button className="btn secondary" type="submit">
          {t('c.seat.check')}
        </button>
      </form>
      {stages.map((s) => (
        <div key={s.id} className="muted mono">
          {s.label} — {JSON.stringify(s.result)}
        </div>
      ))}
      <p>
        <Link href={`/occasions/${id}/space`}>{t('p.space.title')}</Link>
      </p>
    </>
  );
}
