import { requireUser } from '../../../lib/session';
import { getLocale, tf } from '../../../lib/i18n';
import { formatDateTime } from '@eventdesk/shared';
import { getBusinessForAccount, listEnquiriesForBusiness } from '@eventdesk/core';
import { answerEnquiryAction, setEnquiryStateAction } from '../../../actions/business';

// P-05: the business inbox. States sent/awaiting/answered/closed (P33); either side
// can close; the business answers in-thread (P10: thread sits on the supplier record).
export default async function BusinessEnquiriesPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = tf(locale);
  const business = await getBusinessForAccount(user.accountId);
  if (!business) return <main className="wrap">{t('p.biz.empty')}</main>;
  const enquiries = await listEnquiriesForBusiness(business.id, user.accountId);

  return (
    <main className="wrap">
      <h1>{t('p.biz.enquiries')}</h1>
      {enquiries.length === 0 && <div className="notice">{t('p.enq.empty_business')}</div>}
      {enquiries.map((e) => {
        const stateKey =
          e.state === 'answered'
            ? 'p.enq.state.answered'
            : e.state === 'closed'
              ? 'p.enq.state.closed'
              : e.state === 'awaiting'
                ? 'p.enq.state.awaiting'
                : 'p.enq.state.sent';
        return (
          <div key={e.id} className="card">
            <h3 style={{ margin: 0 }}>{e.listing.name}</h3>
            <div className="muted mono">
              {t(stateKey, { date: formatDateTime(e.sentAt, locale) })} ·{' '}
              {t(e.kind === 'quote_request' ? 'p.enq.kind.quote' : 'p.enq.kind.enquiry')}
              {e.shareEmail ? ' · email shared' : ''}
            </div>
            <p>{(e.payload as { message?: string }).message}</p>
            <h4>{t('p.enq.thread')}</h4>
            {e.messages.map((m) => (
              <p key={m.id}>
                <strong>{t(m.fromBusiness ? 'p.enq.from_business' : 'p.enq.from_planner')}:</strong>{' '}
                {m.body}
              </p>
            ))}
            {e.state !== 'closed' && (
              <>
                <form action={answerEnquiryAction.bind(null, e.id)}>
                  <label htmlFor={`body-${e.id}`}>{t('p.enq.answer')}</label>
                  <textarea
                    id={`body-${e.id}`}
                    name="body"
                    rows={3}
                    placeholder={t('p.enq.answer_ph')}
                    required
                  />
                  <div className="actions">
                    <button className="btn" type="submit">
                      {t('p.enq.answer')}
                    </button>
                  </div>
                </form>
                <form action={setEnquiryStateAction.bind(null, e.id, 'closed')}>
                  <button className="btn secondary" type="submit">
                    {t('p.enq.close')}
                  </button>
                </form>
              </>
            )}
            {e.state === 'closed' && (
              <form action={setEnquiryStateAction.bind(null, e.id, 'awaiting')}>
                <button className="btn secondary" type="submit">
                  {t('p.enq.reopen')}
                </button>
              </form>
            )}
          </div>
        );
      })}
    </main>
  );
}
