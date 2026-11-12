import { listApprovalRequests } from '@eventdesk/core';
import { Card, Notice } from '@eventdesk/ui';
import { getLocale, tf } from '../../../lib/i18n';
import { applyDeployAction, consolePData, requestDeployAction } from '../../../actions/pconsole';

// W10 + DEP1-DEP7: deployments from the console, from ONE private GitHub repo via a
// GitHub App (credentials server-side only). Deploy by release TAG with green CI on
// that exact commit (DEP7); production deploys need a second person (DEP3/W9),
// except an emergency security fix by one SecurityAdministrator (audit-marked).
export default async function DeploysPage() {
  const locale = await getLocale();
  const t = tf(locale);
  const data = await consolePData();
  const pending = await listApprovalRequests('pending');
  const deployReqs = pending.filter((p) => p.action === 'deploy');

  return (
    <>
      <h1>{t('p.con.dep.title')}</h1>
      <Card>
        <h2>{t('p.con.dep.repo')}</h2>
        {data.releases.configured ? (
          <p className="mono">{JSON.stringify(data.releases.releases).slice(0, 300)}</p>
        ) : (
          <Notice>{t('p.con.dep.not_configured')}</Notice>
        )}
      </Card>
      <Card>
        <h2>{t('p.con.dep.request')}</h2>
        <form action={requestDeployAction}>
          <label htmlFor="tag">{t('p.con.dep.tag')}</label>
          <input id="tag" name="tag" type="text" placeholder="v0.4.0" required />
          <label htmlFor="commitHash">{t('p.con.dep.commit')}</label>
          <input id="commitHash" name="commitHash" type="text" required />
          <label htmlFor="ciStatus">{t('p.con.dep.ci')}</label>
          <select id="ciStatus" name="ciStatus" defaultValue="green">
            <option value="green">green</option>
            <option value="failed">failed</option>
            <option value="not_run">not_run</option>
          </select>
          <label htmlFor="reason">{t('p.con.reason')}</label>
          <input id="reason" name="reason" type="text" />
          <label>
            <input type="checkbox" name="emergency" /> {t('p.con.dep.emergency')}
          </label>
          <div className="actions">
            <button className="btn" type="submit">
              {t('p.con.dep.request_btn')}
            </button>
          </div>
        </form>
      </Card>
      <Card>
        <h2>{t('console.approvals')}</h2>
        {deployReqs.length === 0 && <Notice>{t('console.no_pending')}</Notice>}
        {deployReqs.map((r) => (
          <div key={r.id}>
            <span className="mono">{JSON.stringify(r.payload).slice(0, 120)}</span>
            <form action={applyDeployAction.bind(null, r.id)}>
              <button className="btn" type="submit">
                {t('p.con.approve')}
              </button>
            </form>
          </div>
        ))}
      </Card>
      <Card>
        <h2>{t('p.con.dep.history')}</h2>
        {data.deploys.length === 0 && <Notice>—</Notice>}
        {data.deploys.map((d) => (
          <div key={d.id} className="mono">
            {d.tag} · {d.commitHash.slice(0, 8)} · {d.result} · ci:{d.ciStatus ?? '—'}
            {d.emergency ? ' · EMERGENCY' : ''} · {d.createdAt.toISOString().slice(0, 10)}
          </div>
        ))}
      </Card>
    </>
  );
}
