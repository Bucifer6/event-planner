import { getLocale, tf } from '../../../lib/i18n';
import { verifyCodeAction, requestCodeAction } from '../../../actions/auth';

export default async function CodePage(props: {
  searchParams: Promise<{ identifier?: string; error?: string }>;
}) {
  const locale = await getLocale();
  const t = tf(locale);
  const sp = await props.searchParams;
  const identifier = sp.identifier ?? '';
  return (
    <main className="wrap">
      <h1>{t('auth.code.title')}</h1>
      {sp.error && <div className="error">{t(sp.error) || sp.error}</div>}
      <form action={verifyCodeAction}>
        <input type="hidden" name="identifier" value={identifier} />
        <label htmlFor="code">{t('auth.code.label')}</label>
        <input
          id="code"
          name="code"
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
      <form action={requestCodeAction}>
        <input type="hidden" name="email" value={identifier} />
        <div className="actions">
          <button className="btn secondary" type="submit">
            {t('auth.code.resend')}
          </button>
        </div>
      </form>
    </main>
  );
}
