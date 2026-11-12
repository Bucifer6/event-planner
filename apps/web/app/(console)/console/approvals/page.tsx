import { consoleData, approveAction, rejectAction } from '../../../actions/console';
import { Card, Notice } from '@eventdesk/ui';
import { getLocale, tf } from '../../../lib/i18n';

// W9: second-person approvals. In single-operator mode, approval-requiring actions
// queue here and have no effect until a second staff member approves them.
export default async function ApprovalsPage() {
  const data = await consoleData();
  const locale = await getLocale();
  const t = tf(locale);
  return (
    <>
      <h1>{t('console.approvals')}</h1>
      {data.staffCount < 2 && <Notice attention>{t('console.single_operator')}</Notice>}
      {data.queue.length === 0 && <Notice>{t('console.no_pending')}</Notice>}
      {data.queue.map((q) => (
        <Card key={q.id}>
          <div className="label-factual">{q.action}</div>
          <pre className="mono">{JSON.stringify(q.payload, null, 1).slice(0, 400)}</pre>
          <div className="muted mono">
            {t('console.requested_by')} {q.requesterId.slice(0, 8)} · {q.createdAt.toISOString()}
          </div>
          <div className="row">
            <form action={approveAction.bind(null, q.id)}>
              <button className="btn" type="submit">
                {t('console.approve')}
              </button>
            </form>
            <form action={rejectAction.bind(null, q.id)}>
              <button className="btn attention" type="submit">
                {t('console.reject')}
              </button>
            </form>
          </div>
        </Card>
      ))}
    </>
  );
}
