import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff } from '@eventdesk/core';
import { PlannerDashboard } from '../../../../components/PlannerDashboard';
import { saveAppearance } from '../../../actions/appearance';
import { currentStaff } from '../../../actions/console';
import { appearances } from '../../../lib/appearances';
import { getLocale, tf } from '../../../lib/i18n';
import { getPlannerAppearance } from '../../../lib/planner-appearance';

export default async function AppearancePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const session = await currentStaff();
  if (!session) redirect('/console/signin');
  const staff = await requireStaff(session.accountId);
  if (!staff.roles.includes('platform_admin')) redirect('/console');

  const [active, locale, params] = await Promise.all([
    getPlannerAppearance(),
    getLocale(),
    searchParams,
  ]);
  const t = tf(locale);
  const sample = [
    {
      id: 'dinner',
      title: t('appearance.sample.dinner'),
      date: t('appearance.sample.date1'),
      status: t('appearance.sample.planning'),
    },
    {
      id: 'launch',
      title: t('appearance.sample.launch'),
      date: t('appearance.sample.date2'),
      status: t('appearance.sample.planning'),
    },
    {
      id: 'reception',
      title: t('appearance.sample.reception'),
      date: t('appearance.sample.date3'),
      status: t('appearance.sample.planning'),
    },
  ];

  return (
    <section className="appearance-settings">
      <h1>{t('appearance.title')}</h1>
      <p>{t('appearance.intro')}</p>
      <p>
        <strong>{t('appearance.current')}</strong>{' '}
        {appearances.find(({ id }) => id === active)?.name ?? 'Garden Soirée'}
      </p>
      {params.saved === '1' && (
        <p className="notice" role="status">
          {t('appearance.saved')}
        </p>
      )}
      {params.error === 'invalid' && (
        <p className="notice attention" role="alert">
          {t('appearance.invalid')}
        </p>
      )}
      <Link href="/dashboard">{t('appearance.open')}</Link>
      <div className="appearance-grid">
        {appearances.map((design) => (
          <article key={design.id} className="appearance-option card">
            <div
              data-appearance={design.id}
              className="planner-skin appearance-thumbnail"
              aria-hidden="true"
              inert
            >
              <div className="appearance-canvas">
                <PlannerDashboard
                  title={t('dash.title')}
                  createLabel={t('dash.new')}
                  emptyLabel=""
                  events={sample}
                />
              </div>
            </div>
            <div className="appearance-option-copy">
              <h2>{design.name}</h2>
              <p>{t('appearance.design.' + design.id)}</p>
              {design.id === active ? (
                <strong>{t('appearance.active')}</strong>
              ) : (
                <form action={saveAppearance}>
                  <input type="hidden" name="appearance" value={design.id} />
                  <button
                    className="btn secondary"
                    type="submit"
                    aria-label={t('appearance.apply_named', { name: design.name })}
                  >
                    {t('appearance.apply')}
                  </button>
                </form>
              )}
            </div>
          </article>
        ))}
      </div>
      {active !== 'garden' && (
        <form action={saveAppearance}>
          <input type="hidden" name="appearance" value="garden" />
          <button className="btn secondary" type="submit">
            {t('appearance.restore')}
          </button>
        </form>
      )}
    </section>
  );
}
