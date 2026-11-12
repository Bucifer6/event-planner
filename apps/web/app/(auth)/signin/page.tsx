import Link from 'next/link';
import { getLocale, tf } from '../../lib/i18n';
import { requestCodeAction, anonymousSignInAction } from '../../actions/auth';

export default async function SignInPage(props: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const locale = await getLocale();
  const t = tf(locale);
  const sp = await props.searchParams;
  return (
    <main className="wrap">
      <h1>{t('auth.signin.title')}</h1>
      {sp.sent === '1' && <div className="notice">{t('auth.code.sent')}</div>}
      {sp.error && <div className="error">{t(sp.error) || sp.error}</div>}
      <form action={requestCodeAction}>
        <label htmlFor="email">{t('auth.email.label')}</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
        <div className="actions">
          <button className="btn" type="submit">
            {t('auth.email.button')}
          </button>
        </div>
      </form>
      <h2>{t('auth.anonymous.title')}</h2>
      <form action={anonymousSignInAction}>
        <label htmlFor="username">{t('auth.username.label')}</label>
        <input id="username" name="username" type="text" required autoComplete="username" />
        <label htmlFor="password">{t('auth.password.label')}</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
        <div className="actions">
          <button className="btn" type="submit">
            {t('auth.anonymous.button')}
          </button>
          <Link className="btn secondary" href="/signup-anonymous">
            {t('auth.anonymous.signup')}
          </Link>
        </div>
      </form>
    </main>
  );
}
