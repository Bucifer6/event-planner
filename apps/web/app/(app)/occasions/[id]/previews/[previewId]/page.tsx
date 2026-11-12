import { requireUser } from '../../../../../lib/session';
import { getLocale, tf } from '../../../../../lib/i18n';
import { getPreview } from '@eventdesk/core';
import { formatDate } from '@eventdesk/shared';
import { Card } from '@eventdesk/ui';
import { confirmPreviewAction, discardPreviewAction } from '../../../../../actions/whatif';

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ id: string; previewId: string }>;
}) {
  const user = await requireUser();
  const { id, previewId } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const preview = await getPreview(previewId);
  const delta = preview.delta as {
    tasks?: { taskId: string; title: string; from: string; to: string }[];
    diff?: { create: { titleKey: string }[]; skip: { title: string }[] };
    newStart?: string;
  };
  return (
    <main className="wrap">
      <h1>{t('whatif.title')}</h1>
      <Card>
        <div className="label-factual">{preview.subject}</div>
        {preview.state !== 'pending' && (
          <div className="notice">
            {t(preview.state === 'applied' ? 'whatif.applied' : 'whatif.discarded')}
          </div>
        )}
        {delta.newStart && <p className="mono">new date: {formatDate(delta.newStart, locale)}</p>}
        {delta.tasks && (
          <ul>
            {delta.tasks.map((task) => (
              <li key={task.taskId}>
                {task.title}: {formatDate(task.from, locale)} → {formatDate(task.to, locale)}
              </li>
            ))}
          </ul>
        )}
        {delta.diff && (
          <ul>
            {delta.diff.create.map((c, i) => (
              <li key={i}>{t(c.titleKey)}</li>
            ))}
            {delta.diff.skip.map((s, i) => (
              <li key={`s${i}`} className="muted">
                {s.title} (skip)
              </li>
            ))}
          </ul>
        )}
        {preview.state === 'pending' && (
          <div className="actions">
            <form action={confirmPreviewAction.bind(null, id, previewId)}>
              <button className="btn" type="submit">
                {t('whatif.confirm')}
              </button>
            </form>
            <form action={discardPreviewAction.bind(null, id, previewId)}>
              <button className="btn secondary" type="submit">
                {t('whatif.discard')}
              </button>
            </form>
          </div>
        )}
      </Card>
    </main>
  );
}
