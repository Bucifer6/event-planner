import { getLocale, tf } from '../../../lib/i18n';
import { confirmTotpAction } from '../../../actions/console';
import { requireUser } from '../../../lib/session';
import { prisma } from '@eventdesk/db';
import { redirect } from 'next/navigation';

// S2: staff enrol a standard TOTP authenticator (any app, no lock-in).
export default async function EnrolPage(props: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const t = tf(locale);
  const sp = await props.searchParams;
  const totp = await prisma.totpSecret.findUnique({ where: { accountId: user.accountId } });
  if (totp?.confirmedAt) redirect('/console/signin');
  return (
    <main className="wrap">
      <h1>{t('console.enrol_totp')}</h1>
      {sp.error && <div className="error">{t(sp.error)}</div>}
      <p className="mono">
        {totp ? 'Secret: add to your authenticator app, then enter a code.' : 'Generating…'}
      </p>
      <form action={confirmTotpAction}>
        <input
          name="totp"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
        />
        <div className="actions">
          <button className="btn" type="submit">
            {t('common.save')}
          </button>
        </div>
      </form>
    </main>
  );
}
