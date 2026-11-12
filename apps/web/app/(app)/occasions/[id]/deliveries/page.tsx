import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { listDeliveries, listCorrections } from '@eventdesk/core';
import { Card, Notice } from '@eventdesk/ui';
import { correctReceivedAction, createDeliveryAction } from '../../../../actions/deliveries';

// B6: deliveries/hired items/returns. Received quantities change only via an
// audited Correction (principle 4) — the DB trigger blocks direct overwrites.
export default async function DeliveriesPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const deliveries = await listDeliveries(id, user.accountId);
  const corrections = await listCorrections(id, user.accountId);
  return (
    <>
      <Notice>{t('deliveries.correction_note')}</Notice>
      <Card>
        <h2>{t('deliveries.new')}</h2>
        <form action={createDeliveryAction.bind(null, id)}>
          <input name="title" type="text" required placeholder={t('deliveries.title')} />
          <select name="kind" defaultValue="delivery">
            <option value="delivery">delivery</option>
            <option value="hired_item">hired_item</option>
            <option value="return">return</option>
          </select>
          <input name="expectedQty" type="number" min={0} required defaultValue={1} />
          <input name="unitLabel" type="text" placeholder="unit" />
          <div className="actions">
            <button className="btn" type="submit">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Card>
      {deliveries.map((d) => (
        <Card key={d.id}>
          <div className="row between">
            <strong>{d.title}</strong>
            <span className="mono">
              {d.kind}: {d.receivedQty}/{d.expectedQty} {d.unitLabel ?? ''}
            </span>
          </div>
          <form action={correctReceivedAction.bind(null, id, d.id)}>
            <input
              name="receivedQty"
              type="number"
              min={0}
              max={d.expectedQty}
              defaultValue={d.receivedQty}
            />
            <input
              name="reason"
              type="text"
              required
              placeholder={t('deliveries.correction_reason')}
            />
            <div className="actions">
              <button className="btn" type="submit">
                {t('deliveries.correct')}
              </button>
            </div>
          </form>
        </Card>
      ))}
      <Card>
        <h2>{t('deliveries.corrections')}</h2>
        {corrections.map((c) => (
          <div key={c.id} className="mono">
            {c.field}: {(c.before as { receivedQty: number }).receivedQty} →{' '}
            {(c.after as { receivedQty: number }).receivedQty} · {c.reason} ·{' '}
            {c.actorId.slice(0, 6)} · {c.createdAt.toISOString().slice(0, 10)}
          </div>
        ))}
      </Card>
    </>
  );
}
