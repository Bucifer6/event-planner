import { requireUser } from '../../../../../lib/session';
import { getLocale, tf } from '../../../../../lib/i18n';
import { Card } from '@eventdesk/ui';
import { applyImportAction } from '../../../../../actions/guests';

export default async function ImportPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payload?: string; headers?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const t = tf(locale);
  const payload = sp.payload ?? '';
  const { diff } = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as {
    diff: {
      create: { name: string; household: string }[];
      skip: { name: string; household: string; reason: string }[];
    };
  };
  return (
    <main className="wrap">
      <h1>{t('guests.import.preview')}</h1>
      <Card>
        <div className="label-factual">
          {t('guests.import.create')}: {diff.create.length}
        </div>
        <ul>
          {diff.create.slice(0, 50).map((c, i) => (
            <li key={i}>
              {c.name} → {c.household}
            </li>
          ))}
        </ul>
        <div className="label-factual">
          {t('guests.import.skip')}: {diff.skip.length}
        </div>
        <ul>
          {diff.skip.slice(0, 50).map((s, i) => (
            <li key={i} className="muted">
              {s.name} ({s.reason})
            </li>
          ))}
        </ul>
        <form action={applyImportAction.bind(null, id)}>
          <input type="hidden" name="payload" value={payload} />
          <div className="actions">
            <button className="btn" type="submit">
              {t('guests.import.apply')}
            </button>
          </div>
        </form>
      </Card>
    </main>
  );
}
