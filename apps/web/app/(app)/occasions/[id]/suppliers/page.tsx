import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { listSuppliers } from '@eventdesk/core';
import { formatRon, formatDate } from '@eventdesk/shared';
import { Card } from '@eventdesk/ui';
import {
  addBriefingAction,
  addDeadlineAction,
  createBookingAction,
  createSupplierAction,
  finalizeSnapshotAction,
  setBookingStateAction,
} from '../../../../actions/suppliers';

// B4/B5/B12: suppliers, bookings with state transitions, versioned briefings,
// final-order snapshots, payment deadlines.
export default async function SuppliersPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const suppliers = await listSuppliers(id, user.accountId);
  return (
    <>
      <Card>
        <h2>{t('suppliers.new')}</h2>
        <form action={createSupplierAction.bind(null, id)}>
          <input name="name" type="text" required placeholder={t('suppliers.name')} />
          <input name="contactEmail" type="email" placeholder={t('guests.leadEmail')} />
          <div className="actions">
            <button className="btn" type="submit">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Card>
      {suppliers.map((s) => (
        <Card key={s.id}>
          <div className="row between">
            <h3>{s.name}</h3>
            <form action={createBookingAction.bind(null, id, s.id)}>
              <input
                name="title"
                type="text"
                placeholder={t('suppliers.booking_title')}
                style={{ maxWidth: 200 }}
              />
              <button className="btn secondary" type="submit">
                {t('suppliers.new_booking')}
              </button>
            </form>
          </div>
          {s.bookings.map((b) => (
            <div
              key={b.id}
              style={{ borderTop: '1px solid var(--sage)', paddingTop: 8, marginTop: 8 }}
            >
              <div className="row between">
                <strong>{b.title}</strong>
                <span className="label-factual">{b.state}</span>
              </div>
              <div className="row">
                {(['enquired', 'quoted', 'booked', 'completed', 'cancelled'] as const).map((st) => (
                  <form key={st} action={setBookingStateAction.bind(null, id, b.id, st)}>
                    <button className="btn secondary" type="submit">
                      {st}
                    </button>
                  </form>
                ))}
              </div>
              {b.briefings.map((bv) => (
                <div key={bv.id} className="mono">
                  v{bv.version} {bv.acknowledgedAt ? '✓ acknowledged' : '— pending'} —{' '}
                  {bv.content.slice(0, 80)}
                </div>
              ))}
              <form action={addBriefingAction.bind(null, id, b.id)}>
                <input name="content" type="text" placeholder={t('suppliers.briefing')} />
                <button className="btn secondary" type="submit">
                  {t('suppliers.add_briefing')}
                </button>
              </form>
              <form action={finalizeSnapshotAction.bind(null, id, b.id)}>
                <textarea name="items" rows={2} placeholder="title|qty per line" />
                <button className="btn secondary" type="submit">
                  {t('suppliers.finalize_order')}
                </button>
              </form>
              {b.snapshots.map((snap) => (
                <div key={snap.id} className="muted mono">
                  snapshot v{snap.version} finalized{' '}
                  {snap.finalizedAt ? formatDate(snap.finalizedAt, locale) : ''}
                </div>
              ))}
              {b.deadlines.map((d) => (
                <div key={d.id} className="row between">
                  <span className="label-factual">
                    {d.kind} {formatDate(d.dueAt, locale)}
                  </span>
                  <span className="mono">{formatRon(d.amountBani, locale)}</span>
                </div>
              ))}
              <form action={addDeadlineAction.bind(null, id, b.id)}>
                <select name="kind" defaultValue="final">
                  <option value="advance">advance</option>
                  <option value="instalment">instalment</option>
                  <option value="final">final</option>
                </select>
                <input
                  name="amount"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={t('budget.amount')}
                />
                <input name="dueAt" type="date" required />
                <button className="btn secondary" type="submit">
                  {t('suppliers.add_deadline')}
                </button>
              </form>
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}
