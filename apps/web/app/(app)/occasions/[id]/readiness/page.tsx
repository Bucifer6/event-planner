import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { listReadinessDecisions } from '@eventdesk/core';
import { Card } from '@eventdesk/ui';
import { readinessAction } from '../../../../actions/deliveries';

// B8: Hold / Proceed / Proceed with conditions, each tied to evidence references.
export default async function ReadinessPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const decisions = await listReadinessDecisions(id, user.accountId);
  return (
    <>
      <Card>
        <h2>{t('readiness.new')}</h2>
        <form action={readinessAction.bind(null, id)}>
          <select name="decision" defaultValue="hold">
            <option value="hold">{t('readiness.hold')}</option>
            <option value="proceed">{t('readiness.proceed')}</option>
            <option value="proceed_with_conditions">{t('readiness.proceed_conditions')}</option>
          </select>
          <label>{t('readiness.evidence')} (one per line, required)</label>
          <textarea name="evidence" rows={3} required />
          <div className="actions">
            <button className="btn" type="submit">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Card>
      {decisions.map((d) => (
        <Card key={d.id}>
          <span className="label-factual">{d.decision}</span>
          <div className="muted mono">{(d.evidence as string[]).join(' · ')}</div>
        </Card>
      ))}
    </>
  );
}
