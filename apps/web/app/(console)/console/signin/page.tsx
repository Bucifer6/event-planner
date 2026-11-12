import { redirect } from 'next/navigation';
import { prisma } from '@eventdesk/db';
import { currentUser } from '../../../lib/session';
import { getLocale, tf } from '../../../lib/i18n';
import { staffSignInAction } from '../../../actions/console';

// S5: staff console sign-in requires a confirmed TOTP (2FA mandatory for staff).
export default async function ConsoleSignInPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/signin');
  const locale = await getLocale();
  const t = tf(locale);
  const sp = await props.searchParams;
  const staff = await prisma.staffMember.findUnique({ where: { accountId: user.accountId } });
  if (!staff)
    return (
      <main className="wrap">
        <div className="error">{t('err.forbidden')}</div>
      </main>
    );
  const totp = await prisma.totpSecret.findUnique({ where: { accountId: user.accountId } });
  if (!totp?.confirmedAt) redirect('/console/enrol');
  return (
    <main className="wrap">
      <h1>{t('console.signin')}</h1>
      {sp.error && <div className="error">{t(sp.error)}</div>}
      <form action={staffSignInAction}>
        <label htmlFor="totp">{t('console.totp')}</label>
        <input
          id="totp"
          name="totp"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
        />
        <div className="actions">
          <button className="btn" type="submit">
            {t('auth.code.button')}
          </button>
        </div>
      </form>
    </main>
  );
}
