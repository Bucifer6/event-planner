import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/session';
import { getLocale, tf } from '../../../lib/i18n';
import {
  getBusinessForAccount,
  prePurchaseView,
  listDirectoryCategories,
  listCounties,
  getMonetizationSwitch,
} from '@eventdesk/core';

// P-13/P15: Featured exists only while MON is ON. Before buying, the business sees
// its expected share min(1, 3/(n+1)) and the last 30 days of searches in its
// categories/counties — no guarantee of views.
export default async function FeaturedPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; county?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const locale = await getLocale();
  const t = tf(locale);
  const business = await getBusinessForAccount(user.accountId);
  if (!business) redirect('/business');
  const mon = await getMonetizationSwitch();
  const categories = await listDirectoryCategories();
  const counties = await listCounties();
  const categorySlug = sp.category ?? 'floristi';
  const countyCode = sp.county ?? 'B';

  return (
    <main className="wrap">
      <h1>{t('p.feat.title')}</h1>
      {mon.state !== 'ON' ? (
        <div className="notice">{t('p.feat.mon_off')}</div>
      ) : (
        <>
          <form method="get" action="/business/featured">
            <label htmlFor="category">{t('p.dir.category')}</label>
            <select id="category" name="category" defaultValue={categorySlug}>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {locale === 'en' ? c.nameEn : c.nameRo}
                </option>
              ))}
            </select>
            <label htmlFor="county">{t('p.dir.county')}</label>
            <select id="county" name="county" defaultValue={countyCode}>
              {counties.map((c) => (
                <option key={c.code} value={c.code}>
                  {locale === 'en' ? c.nameEn : c.nameRo}
                </option>
              ))}
            </select>
            <div className="actions">
              <button className="btn" type="submit">
                {t('p.dir.search')}
              </button>
            </div>
          </form>
          <FeaturedView categorySlug={categorySlug} countyCode={countyCode} />
        </>
      )}
    </main>
  );
}

async function FeaturedView({
  categorySlug,
  countyCode,
}: {
  categorySlug: string;
  countyCode: string;
}) {
  const locale = await getLocale();
  const t = tf(locale);
  const view = await prePurchaseView({ categorySlug, countyCode });
  return (
    <div className="card">
      <p>
        {t('p.feat.expected_share')}: <strong>{Math.round(view.expectedShare * 100)}%</strong>{' '}
        (min(1, 3 ÷ ({view.liveFeatured} + 1)))
      </p>
      <p className="muted">
        {t('p.feat.searches30d')}: {view.searchesLast30Days}
      </p>
      <p className="muted">{t('p.feat.no_guarantee')}</p>
      <div className="label-factual">Promovat — plasare plătită</div>
    </div>
  );
}
