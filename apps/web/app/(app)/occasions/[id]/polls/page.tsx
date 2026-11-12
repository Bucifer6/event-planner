import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { listPolls } from '@eventdesk/core';
import { Card } from '@eventdesk/ui';
import { confirmPollAction, createPollAction } from '../../../../actions/polls';

export default async function PollsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const polls = await listPolls(id, user.accountId);
  return (
    <>
      <Card>
        <h2>{t('poll.new')}</h2>
        <form action={createPollAction.bind(null, id)}>
          <input name="title" type="text" placeholder={t('poll.title')} />
          <div className="actions">
            <button className="btn" type="submit">
              {t('poll.new')}
            </button>
          </div>
        </form>
      </Card>
      {polls.map((p) => (
        <Card key={p.id}>
          <strong>{p.title ?? t('poll.title')}</strong>
          <div className="muted mono">
            {t('poll.votes')}: {p.votes.filter((v) => v.choice === 'yes').length} {t('common.yes')}{' '}
            / {p.votes.filter((v) => v.choice === 'maybe').length} {t('common.maybe')} /{' '}
            {p.votes.filter((v) => v.choice === 'no').length} {t('common.no')}
          </div>
          {p.decidedDate ? (
            <div className="notice">{t('poll.decided')}</div>
          ) : (
            <form action={confirmPollAction.bind(null, id, p.id)}>
              <input name="decidedDate" type="date" required />
              <div className="actions">
                <button className="btn" type="submit">
                  {t('poll.confirm')}
                </button>
              </div>
            </form>
          )}
        </Card>
      ))}
    </>
  );
}
