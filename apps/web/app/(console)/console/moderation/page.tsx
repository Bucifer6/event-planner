import { listModerationQueue } from '@eventdesk/core';
import { Card, Notice } from '@eventdesk/ui';
import { getLocale, tf } from '../../../lib/i18n';
import { decideRevisionAction } from '../../../actions/pconsole';

// W2/P-02: the moderation queue. Approvers must hold listing_moderator and must not
// be members of the business (enforced in core, P3); the live version stays up while
// a revision is pending.
export default async function ModerationPage() {
  const locale = await getLocale();
  const t = tf(locale);
  const queue = await listModerationQueue();
  return (
    <>
      <h1>{t('p.con.moderation.title')}</h1>
      {queue.length === 0 && <Notice>{t('p.con.moderation.empty')}</Notice>}
      {queue.map((r) => (
        <Card key={r.id}>
          <h3 style={{ margin: 0 }}>{r.listing.name}</h3>
          <pre className="mono">{JSON.stringify(r.payload, null, 1).slice(0, 400)}</pre>
          <div className="muted mono">
            {r.createdAt.toISOString()} · listing {r.listingId.slice(0, 8)}
          </div>
          <div className="row">
            <form action={decideRevisionAction.bind(null, r.id, 'approved')}>
              <button className="btn" type="submit">
                {t('p.con.approve')}
              </button>
            </form>
            <form action={decideRevisionAction.bind(null, r.id, 'changes_requested')}>
              <input name="reason" type="text" placeholder={t('p.con.reason')} />
              <button className="btn secondary" type="submit">
                {t('p.con.changes')}
              </button>
            </form>
            <form action={decideRevisionAction.bind(null, r.id, 'rejected')}>
              <input name="reason" type="text" placeholder={t('p.con.reason')} />
              <button className="btn attention" type="submit">
                {t('p.con.reject')}
              </button>
            </form>
          </div>
        </Card>
      ))}
    </>
  );
}
