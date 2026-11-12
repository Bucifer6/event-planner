import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { listTasks } from '@eventdesk/core';
import { formatDateTime } from '@eventdesk/shared';
import { Card } from '@eventdesk/ui';
import { setTaskStatusAction } from '../../../../actions/tasks';

// B7: event-day view — Ready / Running / Waiting / Done driven from the same task
// records (principle 2). The Midnight Candlelight dark theme applies automatically
// via prefers-color-scheme (section 21); states stay legible at arm's length.
export default async function EventDayPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const tasks = await listTasks(id, user.accountId);
  const cols: [string, 'todo' | 'in_progress' | 'blocked' | 'done'][] = [
    ['eventday.ready', 'todo'],
    ['eventday.running', 'in_progress'],
    ['eventday.waiting', 'blocked'],
    ['eventday.done', 'done'],
  ];
  return (
    <div className="board">
      {cols.map(([label, status]) => (
        <div className="col" key={status}>
          <div className="label-factual">{t(label)}</div>
          {tasks
            .filter((task) => task.status === status)
            .map((task) => (
              <Card key={task.id}>
                <strong>{task.title}</strong>
                <div className="muted mono">
                  {task.dueAt ? formatDateTime(task.dueAt, locale) : t('common.unknown')}
                </div>
                <div className="row">
                  {(['todo', 'in_progress', 'blocked', 'done'] as const)
                    .filter((s) => s !== status)
                    .map((s) => (
                      <form key={s} action={setTaskStatusAction.bind(null, id, task.id, s)}>
                        <button className="btn secondary" type="submit">
                          {t(`task.status.${s}`)}
                        </button>
                      </form>
                    ))}
                </div>
              </Card>
            ))}
        </div>
      ))}
    </div>
  );
}
