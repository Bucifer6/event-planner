import Link from 'next/link';
import { requireUser } from '../../../lib/session';
import { getLocale, tf } from '../../../lib/i18n';
import { getOverview } from '@eventdesk/core';
import { formatDateTime } from '@eventdesk/shared';
import { Card } from '@eventdesk/ui';
import { prisma } from '@eventdesk/db';
import { updateBriefAction } from '../../../actions/occasions';

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const overview = await getOverview(id, user.accountId);
  const priorities = (overview.occasion.briefPriorities as string[] | null) ?? [];
  const o = overview.occasion;
  const tasksTotal = await prisma.task.count({ where: { occasionId: id } });
  const tasksDone = await prisma.task.count({
    where: { occasionId: id, status: 'done' },
  });
  return (
    <>
      {/* 01 Editorial Banquet: the overview reads like a set menu — typeset figures,
          brass hairlines, warm colour only where attention is due. */}
      <div className="invitation-hero" style={{ textAlign: 'left', paddingTop: 8 }}>
        <div className="eyebrow">{t('occ.overview')}</div>
        <h1>{o.title}</h1>
        <div className="meta">
          {o.dateStart ? formatDateTime(o.dateStart, locale) : t('common.unknown')}
          {o.capacityTotal ? ` · ${o.seatsTaken}/${o.capacityTotal}` : ''}
        </div>
      </div>
      <div className="stats">
        <div>
          <div className="figure">{o.capacityTotal ? o.seatsTaken : '—'}</div>
          <div className="figure-label">{t('occ.stats.coming')}</div>
        </div>
        <div>
          <div className="figure">
            {tasksDone}/{tasksTotal}
          </div>
          <div className="figure-label">{t('occ.stats.tasks')}</div>
        </div>
        <div>
          <div className={`figure ${overview.overdue.length ? 'attention-text' : ''}`}>
            {overview.overdue.length}
          </div>
          <div className="figure-label">{t('occ.stats.overdue')}</div>
        </div>
      </div>
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
        <h2>{t('p.dir.title')}</h2>
        <Link href={`/directory?occasion=${id}`} className="btn secondary">
          {t('nav.directory')}
        </Link>{' '}
        <Link href={`/occasions/${id}/enquiries`} className="btn secondary">
          {t('p.biz.enquiries')}
        </Link>{' '}
        <Link href={`/occasions/${id}/space`} className="btn secondary">
          {t('p.space.title')}
        </Link>
      </Card>
      <Card>
        <ul className="rows">
          <li>
            <span className="label-factual">{t('occ.next_milestone')}</span>
            <span>
              {overview.nextMilestone
                ? `${overview.nextMilestone.title} — ${formatDateTime(overview.nextMilestone.dueAt!, locale)}`
                : t('occ.none')}
            </span>
          </li>
          <li>
            <span className="label-factual">{t('occ.overdue')}</span>
            <span className={overview.overdue.length ? 'attention-text' : ''}>
              {overview.overdue.length
                ? overview.overdue.map((x) => x.title).join(', ')
                : t('occ.none')}
            </span>
          </li>
          <li>
            <span className="label-factual">{t('occ.unaccepted')}</span>
            <span>
              {overview.unacceptedDelegations.length
                ? overview.unacceptedDelegations.map((x) => x.task.title).join(', ')
                : t('occ.none')}
            </span>
          </li>
          <li>
            <span className="label-factual">{t('occ.blockers')}</span>
            <span>
              {overview.blockers.length
                ? overview.blockers.map((x) => x.title).join(', ')
                : t('occ.none')}
            </span>
          </li>
        </ul>
      </Card>
    </>
  );
}
