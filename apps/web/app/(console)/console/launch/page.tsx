import { getLocale, tf } from '../../../lib/i18n';
import { getPlatformSetting } from '@eventdesk/core';
import { requireStaffUser } from '../../../actions/console';
import { recordAccessibilityAction } from '../../../actions/lau';

// v1.0.0 launch checklist (LAU1–LAU9). Buildable items are implemented in code; the
// operator-owned gates are listed with their owning role and must be completed by the
// operator — agents never mark them done. LAU9's accessibility statement date and
// evaluation method are recorded here (PlatformSetting).
const ITEMS = [
  'lau.item.1',
  'lau.item.2',
  'lau.item.3',
  'lau.item.4',
  'lau.item.5',
  'lau.item.6',
  'lau.item.7',
  'lau.item.8',
  'lau.item.9',
] as const;

export default async function LaunchPage() {
  const { user } = await requireStaffUser();
  const locale = await getLocale();
  const t = tf(locale);
  const a11y = await getPlatformSetting(user.accountId, 'accessibility_statement');
  return (
    <>
      <h1>{t('console.launch')}</h1>
      <p className="muted">{t('console.launch.desc')}</p>
      <ul>
        {ITEMS.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
      <h2>{t('console.launch.a11y.title')}</h2>
      {a11y ? (
        <p className="notice">
          {t('console.launch.a11y.recorded')}: {JSON.stringify(a11y.value)}
        </p>
      ) : (
        <p className="muted">{t('console.launch.a11y.none')}</p>
      )}
      <form action={recordAccessibilityAction}>
        <label>{t('console.launch.a11y.date')}</label>
        <input name="statementDate" type="date" required />
        <label>{t('console.launch.a11y.method')}</label>
        <input name="evaluationMethod" type="text" required />
        <button className="btn" type="submit">
          {t('console.launch.a11y.save')}
        </button>
      </form>
    </>
  );
}
