import { getLocale, tf } from '../../../lib/i18n';
import { listIncidents } from '@eventdesk/core';
import { requireStaffUser } from '../../../actions/console';
import { createIncidentAction, updateIncidentAction } from '../../../actions/lau';

// LAU5: production incident log. While an incident is active, guest-facing pages show
// its plain-language impact message (never a stack trace) with a link to /status.
export default async function IncidentsPage() {
  const { user } = await requireStaffUser();
  const locale = await getLocale();
  const t = tf(locale);
  const incidents = await listIncidents(user.accountId);
  return (
    <>
      <h1>{t('console.incidents')}</h1>
      <form action={createIncidentAction}>
        <input name="title" type="text" placeholder={t('console.incidents.field.title')} required />
        <input
          name="impact"
          type="text"
          placeholder={t('console.incidents.field.impact')}
          required
        />
        <button className="btn" type="submit">
          {t('console.incidents.create')}
        </button>
      </form>
      {incidents.length === 0 ? (
        <p className="muted">{t('console.incidents.none')}</p>
      ) : (
        <ul>
          {incidents.map((i) => (
            <li key={i.id}>
              <strong>{i.title}</strong> — {t(`console.incidents.status.${i.status}`)}{' '}
              <span className="muted">{i.impact}</span>
              {i.status !== 'resolved' && (
                <form action={updateIncidentAction.bind(null, i.id, 'resolved')}>
                  <input name="impact" type="hidden" value={i.impact} />
                  <button className="btn secondary" type="submit">
                    {t('console.incidents.resolve')}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
