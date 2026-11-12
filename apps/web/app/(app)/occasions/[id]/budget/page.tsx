import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { listCategories, listExpenses, getOccasionForMember } from '@eventdesk/core';
import { formatRon } from '@eventdesk/shared';
import { Card } from '@eventdesk/ui';
import {
  approveExpenseAction,
  createCategoryAction,
  createExpenseAction,
  payExpenseAction,
  updateCategoryAction,
} from '../../../../actions/budget';

// B1/B2: budget by category with five separate money states; expenses with
// independent approval and payment states. Finance grant enforced server-side (D2).
export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const { member } = await getOccasionForMember(id, user.accountId);
  if (!member.finance) {
    return (
      <main className="wrap">
        <div className="error">{t('err.forbidden')}</div>
      </main>
    );
  }
  const categories = await listCategories(id, user.accountId);
  const expenses = await listExpenses(id, user.accountId);
  return (
    <>
      <Card>
        <h2>{t('budget.new_category')}</h2>
        <form action={createCategoryAction.bind(null, id)}>
          <input name="name" type="text" required placeholder={t('budget.category_name')} />
          <input
            name="estimate"
            type="number"
            min={0}
            step="0.01"
            placeholder={t('budget.estimate')}
          />
          <div className="actions">
            <button className="btn" type="submit">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Card>
      {categories.map((c) => (
        <Card key={c.id}>
          <h3>{c.name}</h3>
          <form action={updateCategoryAction.bind(null, id, c.id)}>
            <div className="row">
              {(['estimate', 'committed', 'invoiced', 'paid', 'forecast'] as const).map((field) => (
                <label key={field} style={{ minWidth: 90 }}>
                  <span className="label-factual">{t(`budget.state.${field}`)}</span>
                  <input
                    name={field}
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={(c[`${field}Bani` as const] as number) / 100}
                  />
                </label>
              ))}
            </div>
            <div className="actions">
              <button className="btn secondary" type="submit">
                {t('common.save')}
              </button>
            </div>
          </form>
          <div className="mono">
            {formatRon(c.estimateBani, locale)} / {formatRon(c.committedBani, locale)} /{' '}
            {formatRon(c.invoicedBani, locale)} / {formatRon(c.paidBani, locale)} /{' '}
            {formatRon(c.forecastBani, locale)}
          </div>
        </Card>
      ))}
      <Card>
        <h2>{t('budget.new_expense')}</h2>
        <form action={createExpenseAction.bind(null, id)}>
          <select name="categoryId">
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input name="title" type="text" required placeholder={t('budget.expense_title')} />
          <input
            name="amount"
            type="number"
            min={0}
            step="0.01"
            required
            placeholder={t('budget.amount')}
          />
          <input name="receiptAssetId" type="hidden" />
          <div className="actions">
            <button className="btn" type="submit">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Card>
      {expenses.map((e) => (
        <Card key={e.id}>
          <div className="row between">
            <strong>{e.title}</strong>
            <span className="mono">{formatRon(e.amountBani, locale)}</span>
          </div>
          <div className="mono">
            {t('budget.approval')}: {e.approvalState} · {t('budget.payment')}: {e.paymentState}
          </div>
          <div className="row">
            <form action={approveExpenseAction.bind(null, id, e.id, 'approved')}>
              <button className="btn secondary" type="submit">
                {t('budget.approve')}
              </button>
            </form>
            <form action={approveExpenseAction.bind(null, id, e.id, 'rejected')}>
              <button className="btn secondary" type="submit">
                {t('budget.reject')}
              </button>
            </form>
            <form action={payExpenseAction.bind(null, id, e.id, e.paymentState !== 'paid')}>
              <button className="btn secondary" type="submit">
                {e.paymentState === 'paid' ? t('budget.mark_unpaid') : t('budget.mark_paid')}
              </button>
            </form>
          </div>
        </Card>
      ))}
    </>
  );
}
