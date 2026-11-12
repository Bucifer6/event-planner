import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser } from '../../lib/session';
import { getLocale, tf } from '../../lib/i18n';
import { listSessions } from '@eventdesk/auth';
import { Card, Notice } from '@eventdesk/ui';
import { dismissRecoveryAction, signOutEverywhereAction } from '../../actions/auth';

export default async function AccountPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = tf(locale);
  const sessions = await listSessions(user.accountId);
  const store = await cookies();
  // Read-only here: cookies cannot be mutated in a Server Component — the flash
  // cookie is cleared by dismissRecoveryAction (or expires after 600 s). S8.
  const recoveryRaw = store.get('ed_recovery')?.value;
  let recovery: { username: string; recoveryCodes: string[] } | null = null;
  if (recoveryRaw) {
    try {
      recovery = JSON.parse(recoveryRaw);
    } catch {
      recovery = null;
    }
  }
  return (
    <main className="wrap">
      <h1>{t('nav.account')}</h1>
      {recovery && (
        <Notice attention>
          <div>{t('auth.recovery.title')}</div>
          <div className="mono">
            {t('auth.anonymous.new_username')}: {recovery.username}
          </div>
          <ul className="mono">
            {recovery.recoveryCodes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <div>{t('auth.recovery.warning')}</div>
          <form action={dismissRecoveryAction}>
            <button className="btn secondary" type="submit">
              {t('common.ok')}
            </button>
          </form>
        </Notice>
      )}
      <Card>
        <h2>{t('nav.signout_everywhere')}</h2>
        <form action={signOutEverywhereAction.bind(null, user.accountId)}>
          <button className="btn attention" type="submit">
            {t('nav.signout_everywhere')}
          </button>
        </form>
      </Card>
      <Card>
        <h2>Sessions</h2>
        <ul>
          {sessions.map((s) => (
            <li key={s.sessionId} className="mono">
              {s.deviceType ?? '—'} · last seen {s.lastSeenAt.toISOString()}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}

export const dynamic = 'force-dynamic';
