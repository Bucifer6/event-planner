import Link from 'next/link';
import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { listTasks, getOccasionForMember } from '@eventdesk/core';
import { prisma } from '@eventdesk/db';
import { setHideDirectoryLinksAction } from '../../../../actions/business';
import { formatDate } from '@eventdesk/shared';
import { Card } from '@eventdesk/ui';
import {
  createTaskAction,
  setTaskStatusAction,
  respondDelegationAction,
  toggleCheckAction,
} from '../../../../actions/tasks';

const STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const;

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const t = tf(locale);
  const view = sp.view === 'board' || sp.view === 'calendar' ? sp.view : 'list';
  const tasks = await listTasks(id, user.accountId);
  const { member, occasion } = await getOccasionForMember(id, user.accountId);
  // P7: one dismissible directory link naming no business, switchable per account or
  // per occasion member
  const account = await prisma.account.findUniqueOrThrow({ where: { id: user.accountId } });
  const dirHidden = account.hideDirectoryLinks || member.hideDirectoryLinks;
  const kindToCategory: Record<string, string> = {
    nunta: 'sali-evenimente',
    botez: 'sali-evenimente',
    aniversare: 'inchiriere-echipamente',
    revelion: 'dj',
    picnic: 'catering',
    voiaj_solo: 'cazare',
    voiaj_grup: 'transport',
    custom: 'sali-evenimente',
  };
  const categorySlug = kindToCategory[occasion.kind] ?? 'sali-evenimente';
  const lastEnquiry = await prisma.enquiry.findFirst({
    where: { occasionId: id },
    orderBy: { sentAt: 'desc' },
    select: { payload: true },
  });
  const countyCode = (lastEnquiry?.payload as { countyCode?: string } | null)?.countyCode ?? 'B';
  return (
    <>
      {!dirHidden && (
        <div className="notice">
          <Link href={`/directory?occasion=${id}&category=${categorySlug}&county=${countyCode}`}>
            {t('p7.link', { category: categorySlug, county: countyCode })}
          </Link>{' '}
          <form
            action={setHideDirectoryLinksAction.bind(null, id, true)}
            style={{ display: 'inline' }}
          >
            <button className="btn secondary" type="submit">
              {t('p7.hide')}
            </button>
          </form>
        </div>
      )}
      {dirHidden && (
        <form action={setHideDirectoryLinksAction.bind(null, id, false)}>
          <button className="btn secondary" type="submit">
            {t('p7.show')}
          </button>
        </form>
      )}
      <div className="tabs">
        {(['list', 'board', 'calendar'] as const).map((v) => (
          <Link
            key={v}
            href={`/occasions/${id}/tasks?view=${v}`}
            className={view === v ? 'active' : ''}
          >
            {t(`task.views.${v}`)}
          </Link>
        ))}
      </div>

      <Card>
        <h2>{t('task.new')}</h2>
        <form action={createTaskAction.bind(null, id)}>
          <label htmlFor="title">{t('task.title')}</label>
          <input id="title" name="title" type="text" required />
          <label htmlFor="dueAt">{t('task.due')}</label>
          <input id="dueAt" name="dueAt" type="date" />
          <label htmlFor="checkItems">{t('task.new')} — checklist (one per line)</label>
          <textarea id="checkItems" name="checkItems" rows={3} />
          <div className="actions">
            <button className="btn" type="submit">
              {t('task.create')}
            </button>
          </div>
        </form>
      </Card>

      {view === 'list' && (
        <>
          {tasks.map((task) => (
            <Card key={task.id}>
              <div className="row between">
                <strong>{task.title}</strong>
                <span className="label-factual">{t(`task.status.${task.status}`)}</span>
              </div>
              <div className="muted mono">
                {task.dueAt ? formatDate(task.dueAt, locale) : t('common.unknown')}
                {task.owner ? ` · ${task.owner.customLabel ?? t(`roles.${task.owner.role}`)}` : ''}
              </div>
              {task.checkItems.map((c) => (
                <form key={c.id} action={toggleCheckAction.bind(null, id, c.id, !c.done)}>
                  <div className="row">
                    <input
                      type="checkbox"
                      checked={c.done}
                      onChange={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}
                      aria-label={c.label}
                    />
                    <span style={{ textDecoration: c.done ? 'line-through' : 'none' }}>
                      {c.label}
                    </span>
                  </div>
                </form>
              ))}
              <div className="row">
                {STATUSES.map((s) => (
                  <form key={s} action={setTaskStatusAction.bind(null, id, task.id, s)}>
                    <button className="btn secondary" type="submit">
                      {t(`task.status.${s}`)}
                    </button>
                  </form>
                ))}
              </div>
              {task.delegations
                .filter((d) => d.state === 'offered' && d.toMemberId === member.id)
                .map((d) => (
                  <div key={d.id} className="row">
                    <form action={respondDelegationAction.bind(null, id, d.id, true)}>
                      <button className="btn" type="submit">
                        {t('task.accept')}
                      </button>
                    </form>
                    <form action={respondDelegationAction.bind(null, id, d.id, false)}>
                      <button className="btn secondary" type="submit">
                        {t('task.decline')}
                      </button>
                    </form>
                  </div>
                ))}
            </Card>
          ))}
        </>
      )}

      {view === 'board' && (
        <div className="board">
          {STATUSES.map((s) => (
            <div className="col" key={s}>
              <div className="label-factual">{t(`task.status.${s}`)}</div>
              {tasks
                .filter((task) => task.status === s)
                .map((task) => (
                  <Card key={task.id}>
                    <strong>{task.title}</strong>
                    <div className="muted mono">
                      {task.dueAt ? formatDate(task.dueAt, locale) : t('common.unknown')}
                    </div>
                  </Card>
                ))}
            </div>
          ))}
        </div>
      )}

      {view === 'calendar' && (
        <div className="calendar">
          {tasks
            .filter((task) => task.dueAt)
            .map((task) => (
              <div className="day" key={task.id}>
                <strong>{formatDate(task.dueAt!, locale)}</strong> — {task.title}
              </div>
            ))}
        </div>
      )}
    </>
  );
}
