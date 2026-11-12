import Link from 'next/link';
import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { formatDateTime } from '@eventdesk/shared';
import { listEnquiriesForOccasion } from '@eventdesk/core';
import { resendEnquiryAction, setEnquiryStateAction } from '../../../../actions/business';

// P-05/P-10/P-33: the planner's enquiries for one occasion — the thread sits in the
// plan next to the supplier record; unanswered shows "sent <date>"; re-send once after
// 7 days reuses the thread.
export default async function OccasionEnquiriesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const enquiries = await listEnquiriesForOccasion(id, user.accountId);

  return (
    <main className="wrap">
      <h1>{t('p.biz.enquiries')}</h1>
      {enquiries.length === 0 && (
        <div className="notice">
          {t('p.enq.empty_planner')}{' '}
          <Link href={`/directory?occasion=${id}`}>{t('p.dir.title')}</Link>
        </div>
      )}
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
            <h3 style={{ margin: 0 }}>
              <Link href={`/directory/${e.listingId}`}>{e.listing.name}</Link>
            </h3>
            <div className="muted mono">
              {t(stateKey, { date: formatDateTime(e.sentAt, locale) })} ·{' '}
              {t(e.kind === 'quote_request' ? 'p.enq.kind.quote' : 'p.enq.kind.enquiry')}
            </div>
            {e.messages.map((m) => (
              <p key={m.id}>
                <strong>{t(m.fromBusiness ? 'p.enq.from_business' : 'p.enq.from_planner')}:</strong>{' '}
                {m.body}
              </p>
            ))}
            <div className="actions">
              {e.state !== 'closed' && (
                <form action={setEnquiryStateAction.bind(null, e.id, 'closed')}>
                  <button className="btn secondary" type="submit">
                    {t('p.enq.close')}
                  </button>
                </form>
              )}
              {e.state !== 'closed' && (
                <form action={resendEnquiryAction.bind(null, e.id, id)}>
                  <button className="btn secondary" type="submit">
                    {t('p.enq.resend')}
                  </button>
                </form>
              )}
            </div>
          </div>
        );
      })}
    </main>
  );
}
