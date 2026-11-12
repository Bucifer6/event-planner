import Link from 'next/link';
import {
  listCounties,
  listDirectoryCategories,
  listOccasionsForAccount,
  searchDirectory,
} from '@eventdesk/core';
import { getLocale, tf } from '../lib/i18n';
import { currentUser } from '../lib/session';
import { LangToggle } from '../../components/LangToggle';

// P-04 (P5/P6): public directory search per category x county (+ locality). Organic
// order rotates daily and payment can never change it; ro + en via ?lang / cookie.
export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    county?: string;
    locality?: string;
    occasion?: string;
  }>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = tf(locale);
  const user = await currentUser();
  const occasions = user ? await listOccasionsForAccount(user.accountId) : [];
  const occasionId = sp.occasion ?? occasions[0]?.id ?? null;
  const categories = await listDirectoryCategories();
  const counties = await listCounties();
  const categorySlug = sp.category ?? categories[0]?.slug ?? '';
  const countyCode = sp.county ?? counties[0]?.code ?? '';
  const county = counties.find((c) => c.code === countyCode);

  let results: Awaited<ReturnType<typeof searchDirectory>> = [];
  if (categorySlug && countyCode) {
    try {
      results = await searchDirectory({
        categorySlug,
        countyCode,
        localityId: sp.locality || undefined,
      });
    } catch {
      results = [];
    }
  }

  return (
    <main className="wrap">
      <div className="row between">
        <h1>{t('p.dir.title')}</h1>
        <LangToggle />
      </div>
      <p className="muted">{t('p.dir.subtitle')}</p>
      {occasions.length > 0 && (
        <form method="get" action="/directory">
          <input type="hidden" name="category" value={categorySlug} />
          <input type="hidden" name="county" value={countyCode} />
          <label htmlFor="occasion">Occasion</label>
          <select id="occasion" name="occasion" defaultValue={occasionId ?? ''}>
            {occasions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
          <div className="actions">
            <button className="btn secondary" type="submit">
              {t('p.dir.search')}
            </button>
          </div>
        </form>
      )}
      <form method="get" action="/directory">
        {occasionId && <input type="hidden" name="occasion" value={occasionId} />}
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
        <label htmlFor="locality">{t('p.dir.locality')}</label>
        <select id="locality" name="locality" defaultValue={sp.locality ?? ''}>
          <option value="">{t('p.dir.all_localities')}</option>
          {(county?.localities ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.nameRo}
            </option>
          ))}
        </select>
        <div className="actions">
          <button className="btn" type="submit">
            {t('p.dir.search')}
          </button>
        </div>
      </form>
      {results.length === 0 && <div className="notice">{t('p.dir.empty')}</div>}
      {results.map((r) => (
        <Link
          key={r.listing.id}
          href={`/directory/${r.listing.id}${occasionId ? `?occasion=${occasionId}` : ''}`}
          className="card"
          style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
        >
          <h2 style={{ margin: 0 }}>{r.listing.name}</h2>
          <div className="muted">
            {r.listing.categories
              .map((c) => (locale === 'en' ? c.category.nameEn : c.category.nameRo))
              .join(' · ')}
          </div>
          {r.unclaimed && <div className="label-factual">{t('p.dir.unclaimed')}</div>}
          {r.badges.map((b) => (
            <div key={b} className="label-factual">
              {b}
            </div>
          ))}
          {r.stats && (
            <div className="muted mono">
              {t('p.dir.stats.answered', { share: Math.round(r.stats.shareAnswered * 100) })}
              {r.stats.medianReplyHours != null &&
                ` · ${t('p.dir.stats.reply', { hours: r.stats.medianReplyHours })}`}
            </div>
          )}
        </Link>
      ))}
    </main>
  );
}
