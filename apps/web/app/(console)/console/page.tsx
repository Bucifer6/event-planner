import { consoleData } from '../../actions/console';
import { Card } from '@eventdesk/ui';
import { getLocale, tf } from '../../lib/i18n';

// W1: dashboard of the whole platform — counts and broad status only, never
// planner content.
export default async function ConsoleDashboard() {
  const data = await consoleData();
  const locale = await getLocale();
  const t = tf(locale);
  return (
    <>
      <h1>{t('console.dashboard')}</h1>
      <Card>
        <div className="row between">
          <span>{t('console.accounts')}</span>
          <strong>{data.accounts}</strong>
        </div>
        <div className="row between">
          <span>{t('console.occasions')}</span>
          <strong>{data.occasions}</strong>
        </div>
        <div className="row between">
          <span>{t('console.staff')}</span>
          <strong>{data.staffCount}</strong>
        </div>
        <div className="row between">
          <span>{t('console.pending_jobs')}</span>
          <strong>{data.pendingJobs}</strong>
        </div>
        <div className="row between">
          <span>{t('console.pending_approvals')}</span>
          <strong>{data.queue.length}</strong>
        </div>
        <div className="row between">
          <span>{t('console.monetization')}</span>
          <strong>{data.mon.state}</strong>
        </div>
      </Card>
    </>
  );
}
