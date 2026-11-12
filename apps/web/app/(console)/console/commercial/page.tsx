import { prisma } from '@eventdesk/db';
import { listApprovalRequests } from '@eventdesk/core';
import { Card, Notice } from '@eventdesk/ui';
import { getLocale, tf } from '../../../lib/i18n';
import {
  consolePData,
  recordBillingAcceptanceAction,
  requestRefundAction,
} from '../../../actions/pconsole';

// W6/MON: commercial console — free-phase cost dashboard (counts/storage only), the
// monetization switch state + notice history, billing acceptance in test mode (MON4
// precondition), and the second-person refund/credit queue (P26). Dormant while MON
// is OFF: there is no pricing, checkout or card UI anywhere (MON1).
export default async function CommercialPage() {
  const locale = await getLocale();
  const t = tf(locale);
  const data = await consolePData();
  const pending = await listApprovalRequests('pending');
  const refunds = pending.filter((p) => p.action === 'refund');

  return (
    <>
      <h1>{t('p.con.com.title')}</h1>
      <Card>
        <h2>{t('p.con.com.cost')}</h2>
        <p className="mono">
          accounts {data.cost.accounts} · businesses {data.cost.businesses} · listings{' '}
          {data.cost.listings} · occasions {data.cost.occasions} · enquiries {data.cost.enquiries} ·
          assets {data.cost.assets} · storage {(data.cost.storageBytes / 1_048_576).toFixed(1)} MiB
        </p>
        <p className="muted">{t('p.con.com.cost_hint')}</p>
      </Card>
      <Card>
        <h2>{t('p.con.com.switch')}</h2>
        <div className="label-factual">{data.mon.state}</div>
        {data.mon.noticeStartedAt && (
          <p className="muted mono">
            {t('p.con.com.notice')}: {data.mon.noticeStartedAt.toISOString().slice(0, 10)} →{' '}
            {data.mon.noticeEndsAt?.toISOString().slice(0, 10)}
          </p>
        )}
        <h3>{t('p.con.com.billing_acceptance')}</h3>
        {data.acceptance?.testModePassedAt ? (
          <Notice>
            {t('p.con.com.accepted')}: {data.acceptance.testModePassedAt.toISOString().slice(0, 10)}
          </Notice>
        ) : (
          <form action={recordBillingAcceptanceAction}>
            <input name="notes" type="text" placeholder={t('p.con.reason')} />
            <button className="btn" type="submit">
              {t('p.con.com.record_acceptance')}
            </button>
          </form>
        )}
        {!data.monGate.ok && (
          <p className="muted">
            {t('p.con.com.gate')}: {data.monGate.reasons.join('; ')}
          </p>
        )}
      </Card>
      <Card>
        <h2>{t('p.con.com.refunds')}</h2>
        {refunds.length === 0 && <Notice>{t('p.con.moderation.empty')}</Notice>}
        {refunds.map((r) => (
          <div key={r.id} className="mono">
            {r.action} · {JSON.stringify(r.payload).slice(0, 120)}
          </div>
        ))}
        <form action={requestRefundAction}>
          <input name="subscriptionId" type="text" placeholder="subscription id" required />
          <input name="amountBani" type="number" min={1} placeholder="bani" required />
          <input name="reason" type="text" placeholder={t('p.con.reason')} required />
          <button className="btn attention" type="submit">
            {t('p.con.com.request_refund')}
          </button>
        </form>
      </Card>
      <p className="muted mono">{prisma ? '' : ''}</p>
    </>
  );
}
