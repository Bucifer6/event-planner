import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { formatDateTime } from '@eventdesk/shared';
import {
  guestFlowEstimates,
  listArrivals,
  listOfflineQueue,
  listSustainability,
  simulateDay,
} from '@eventdesk/core';
import { Card } from '@eventdesk/ui';
import {
  checkInAction,
  measurementAction,
  reconcileOfflineAction,
  sustainabilityGoalAction,
} from '../../../../actions/releasee';

// Release E — rehearse and operate complex occasions. E-01 rehearsal simulation runs
// read-only on every render (principle 3); E-02 QR check-in (audited correction,
// principle 4) with aggregate flow estimates (Q5); E-03 offline queue reconciled on
// demand (Q4, conflicts surfaced); E-04 sustainability goals vs measured quantities
// (unknown stays unknown, principle 5).
export default async function OperatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const sim = await simulateDay(id, user.accountId);
  const arrivals = await listArrivals(id, user.accountId);
  const flow = await guestFlowEstimates(id, user.accountId);
  const queue = await listOfflineQueue(id, user.accountId);
  const goals = await listSustainability(id, user.accountId);

  return (
    <>
      <h2>{t('e.title')}</h2>

      <h3>{t('e.rehearse.title')}</h3>
      <p className="muted">{t('e.rehearse.hint')}</p>
      <h4>{t('e.rehearse.conflicts')}</h4>
      {sim.conflicts.length === 0 ? (
        <p className="notice">{t('e.rehearse.none')}</p>
      ) : (
        <ul>
          {sim.conflicts.map((c, i) => (
            <li key={i}>
              <strong>{t(`e.conflict.${c.type}`)}</strong> — {c.message}
            </li>
          ))}
        </ul>
      )}
      <h4>{t('e.rehearse.steps')}</h4>
      <ul>
        {sim.steps.map((s) => (
          <li key={`${s.kind}-${s.refId}`}>
            <span className="mono">{formatDateTime(s.atUtc, locale)}</span>{' '}
            <span className="muted">[{t(`e.kind.${s.kind}`)}]</span> {s.title}
            {s.endUtc ? ` → ${formatDateTime(s.endUtc, locale)}` : ''}
          </li>
        ))}
      </ul>

      <h3>{t('e.checkin.title')}</h3>
      <p className="muted">{t('e.checkin.hint')}</p>
      <form action={checkInAction.bind(null, id)}>
        <input name="qrId" type="text" placeholder={t('e.checkin.qrLabel')} required />
        <button className="btn" type="submit">
          {t('e.checkin.submit')}
        </button>
      </form>
      <h4>{t('e.checkin.arrivals')}</h4>
      {arrivals.length === 0 ? (
        <p className="muted">{t('e.checkin.none')}</p>
      ) : (
        <ul>
          {arrivals.map((a) => (
            <li key={a.id}>
              <strong>{a.household.name}</strong>{' '}
              <span className="mono">{formatDateTime(a.checkedInAt, locale)}</span>{' '}
              <span className="muted">({a.via})</span>
            </li>
          ))}
        </ul>
      )}
      <Card>
        <h4>{t('e.flow.title')}</h4>
        <div className="row">
          <div>
            {t('e.flow.expected')}: <strong>{flow.expectedAttending}</strong>
          </div>
          <div>
            {t('e.flow.checkedIn')}: <strong>{flow.checkedIn}</strong>
          </div>
          <div>
            {t('e.flow.notArrived')}: <strong>{flow.notArrived}</strong>
          </div>
          <div>
            {t('e.flow.projected')}: <strong>{flow.projectedTotal ?? t('common.unknown')}</strong>
          </div>
        </div>
        {flow.buckets.length > 0 && (
          <>
            <h4>{t('e.flow.buckets')}</h4>
            <ul>
              {flow.buckets.map((b, i) => (
                <li key={i}>
                  <span className="mono">{formatDateTime(b.atUtc, locale)}</span> +{b.count} (
                  {b.cumulative})
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <h3>{t('e.offline.title')}</h3>
      <p className="muted">{t('e.offline.hint')}</p>
      <form action={reconcileOfflineAction.bind(null, id)}>
        <button className="btn" type="submit">
          {t('e.offline.reconcile')}
        </button>
      </form>
      {queue.length === 0 ? (
        <p className="muted">{t('e.offline.none')}</p>
      ) : (
        <ul>
          {queue.map((q) => (
            <li key={q.id}>
              <span className="mono">{q.clientKey}</span> [{t(`e.kind.${q.kind}`)}]{' '}
              <strong>{t(`e.offline.state.${q.state}`)}</strong>
              {q.state === 'conflict' && q.result ? (
                <span className="notice"> — {JSON.stringify(q.result)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h3>{t('e.sus.title')}</h3>
      <p className="muted">{t('e.sus.hint')}</p>
      <form action={sustainabilityGoalAction.bind(null, id)}>
        <input name="metric" type="text" placeholder={t('e.sus.metric')} required />
        <input name="unit" type="text" placeholder={t('e.sus.unit')} required />
        <input name="target" type="number" step="any" min="0" placeholder={t('e.sus.target')} />
        <button className="btn" type="submit">
          {t('e.sus.add')}
        </button>
      </form>
      {goals.length === 0 ? (
        <p className="muted">{t('e.sus.none')}</p>
      ) : (
        <ul>
          {goals.map((g) => (
            <li key={g.id}>
              <strong>{g.metric}</strong> ({g.unit}) — {t('e.sus.target')}:{' '}
              {g.target ?? t('common.unknown')} · {t('e.sus.measured')}:{' '}
              {g.measured ?? t('common.unknown')} · <strong>{t(`e.sus.status.${g.status}`)}</strong>
              <form action={measurementAction.bind(null, id, g.metric)}>
                <input
                  name="value"
                  type="number"
                  step="any"
                  min="0"
                  placeholder={t('e.sus.value')}
                />
                <button className="btn secondary" type="submit">
                  {t('e.sus.record')}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
