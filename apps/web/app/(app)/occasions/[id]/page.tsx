import { requireUser } from '../../../lib/session';
import { getLocale, tf } from '../../../lib/i18n';
import { getOverview } from '@eventdesk/core';
import { formatDateTime } from '@eventdesk/shared';
import { Card } from '@eventdesk/ui';
import { updateBriefAction } from '../../../actions/occasions';

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const overview = await getOverview(id, user.accountId);
  const priorities = (overview.occasion.briefPriorities as string[] | null) ?? [];
  return (
    <>
      <Card>
        <h2>{t('occ.brief.purpose')}</h2>
        <p>{overview.brief.purpose ?? <span className="unknown">{t('common.unknown')}</span>}</p>
        {priorities.length > 0 && (
          <ul>
            {priorities.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        <form action={updateBriefAction.bind(null, id)}>
          <label htmlFor="purpose">{t('occ.brief.purpose')}</label>
          <input
            id="purpose"
            name="purpose"
            type="text"
            defaultValue={overview.brief.purpose ?? ''}
          />
          <label htmlFor="priorities">{t('occ.brief.priorities')}</label>
          <textarea
            id="priorities"
            name="priorities"
            rows={3}
            defaultValue={priorities.join('\n')}
          />
          <div className="actions">
            <button className="btn" type="submit">
              {t('occ.brief.save')}
            </button>
          </div>
        </form>
      </Card>
      <Card>
        <h2>{t('occ.next_milestone')}</h2>
        <p>
          {overview.nextMilestone
            ? `${overview.nextMilestone.title} — ${formatDateTime(overview.nextMilestone.dueAt!, locale)}`
            : t('occ.none')}
        </p>
        <h2>{t('occ.overdue')}</h2>
        <p>
          {overview.overdue.length
            ? overview.overdue.map((x) => x.title).join(', ')
            : t('occ.none')}
        </p>
        <h2>{t('occ.unaccepted')}</h2>
        <p>
          {overview.unacceptedDelegations.length
            ? overview.unacceptedDelegations.map((x) => x.task.title).join(', ')
            : t('occ.none')}
        </p>
        <h2>{t('occ.blockers')}</h2>
        <p>
          {overview.blockers.length
            ? overview.blockers.map((x) => x.title).join(', ')
            : t('occ.none')}
        </p>
      </Card>
    </>
  );
}
