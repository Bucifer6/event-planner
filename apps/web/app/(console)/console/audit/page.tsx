import { consoleData } from '../../../actions/console';
import { Card } from '@eventdesk/ui';
import { getLocale, tf } from '../../../lib/i18n';

// W8/SEC10: audit log viewer — append-only, filterable; exports are read-only copies.
export default async function AuditPage() {
  const data = await consoleData();
  const locale = await getLocale();
  const t = tf(locale);
  return (
    <>
      <h1>{t('console.audit')}</h1>
      <Card>
        {data.audits.map((a) => (
          <div key={a.id} className="row between mono">
            <span>
              {a.at.toISOString()} · {a.actorKind} · {a.action} · {a.objectType}
            </span>
            <span className="muted">{a.objectId?.slice(0, 8) ?? ''}</span>
          </div>
        ))}
      </Card>
      <p className="muted">{t('console.audit_append_only')}</p>
    </>
  );
}

export const dynamic = 'force-dynamic';
