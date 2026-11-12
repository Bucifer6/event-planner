import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { listLedger, settlementView, getOccasionForMember } from '@eventdesk/core';
import { formatRon } from '@eventdesk/shared';
import { Card } from '@eventdesk/ui';
import { addLedgerEntryAction } from '../../../../actions/budget';

// B3: one balanced ledger — who paid, who benefits, who owes whom, per currency,
// with a settlement view. Finance grant enforced server-side.
export default async function LedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const { member } = await getOccasionForMember(id, user.accountId);
  if (!member.finance)
    return (
      <main className="wrap">
        <div className="error">{t('err.forbidden')}</div>
      </main>
    );
  const entries = await listLedger(id, user.accountId);
  const settlement = await settlementView(id, user.accountId);
  const members = await (
    await import('@eventdesk/db')
  ).prisma.occasionMember.findMany({ where: { occasionId: id } });
  return (
    <>
      <Card>
        <h2>{t('ledger.add')}</h2>
        <form action={addLedgerEntryAction.bind(null, id)}>
          <label>{t('ledger.payer')}</label>
          <select name="payerMemberId">
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.customLabel ?? t(`roles.${m.role}`)}
              </option>
            ))}
          </select>
          <input
            name="amount"
            type="number"
            min={0}
            step="0.01"
            required
            placeholder={t('budget.amount')}
          />
          <label>{t('ledger.split_among')} (member ids, one per line)</label>
          <textarea name="splitMembers" rows={3} />
          <input name="note" type="text" placeholder={t('ledger.note')} />
          <div className="actions">
            <button className="btn" type="submit">
              {t('ledger.add')}
            </button>
          </div>
        </form>
      </Card>
      {entries.map((e) => (
        <Card key={e.id}>
          <div className="row between">
            <span>{e.note ?? t('ledger.entry')}</span>
            <span className="mono">{formatRon(e.amountBani, locale)}</span>
          </div>
          <div className="muted mono">
            {e.splits
              .map((s) => `${s.memberId.slice(0, 6)}: ${formatRon(s.shareBani, locale)}`)
              .join(' · ')}
          </div>
        </Card>
      ))}
      <Card>
        <h2>{t('ledger.settlement')}</h2>
        {settlement.settlements.length === 0 && <p>{t('ledger.balanced')}</p>}
        {settlement.settlements.map((s, i) => (
          <div key={i} className="row between">
            <span>
              {s.from.slice(0, 6)} → {s.to.slice(0, 6)}
            </span>
            <span className="mono">{formatRon(s.amountBani, locale)}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
