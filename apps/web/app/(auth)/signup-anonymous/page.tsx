import { getLocale, tf } from '../../lib/i18n';
import { createAnonymousAction } from '../../actions/auth';

export default async function SignupAnonymousPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const locale = await getLocale();
  const t = tf(locale);
  const sp = await props.searchParams;
  return (
    <main className="wrap">
      <h1>{t('auth.anonymous.signup')}</h1>
      <div className="notice attention">{t('auth.anonymous.warning')}</div>
      {sp.error && <div className="error">{t(sp.error) || sp.error}</div>}
      <form action={createAnonymousAction}>
        <label htmlFor="password">{t('auth.password.label')}</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <div className="actions">
          <button className="btn" type="submit">
            {t('auth.anonymous.signup')}
          </button>
        </div>
      </form>
    </main>
  );
}
