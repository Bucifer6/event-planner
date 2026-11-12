import { redirect } from 'next/navigation';
import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { getBusinessForAccount, listCounties, listDirectoryCategories } from '@eventdesk/core';
import { createListingAction } from '../../../../actions/business';

// P-01 (P1): new listing with fixed picklists — 1-5 categories, up to 5 counties,
// 1-20 localities that must belong to the chosen counties. Free text is impossible.
export default async function NewListingPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = tf(locale);
  const business = await getBusinessForAccount(user.accountId);
  if (!business) redirect('/business');
  if (business.suspendedAt) redirect('/business');
  const categories = await listDirectoryCategories();
  const counties = await listCounties();

  return (
    <main className="wrap">
      <h1>{t('p.biz.new_listing')}</h1>
      <div className="notice">{t('p.lf.pending_notice')}</div>
      <form action={createListingAction.bind(null, business.id)}>
        <label htmlFor="name">{t('p.lf.name')}</label>
        <input id="name" name="name" type="text" required />
        <label htmlFor="description">{t('p.lf.description')}</label>
        <textarea id="description" name="description" rows={3} />
        <fieldset>
          <legend>{t('p.lf.categories')}</legend>
          <p className="muted">{t('p.lf.hint_cats')}</p>
          {categories.map((c) => (
            <label key={c.id} style={{ display: 'block', minHeight: '44px' }}>
              <input type="checkbox" name="categoryIds" value={c.id} />{' '}
              {locale === 'en' ? c.nameEn : c.nameRo}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t('p.lf.counties')}</legend>
          {counties.map((c) => (
            <label key={c.id} style={{ display: 'block', minHeight: '44px' }}>
              <input type="checkbox" name="countyIds" value={c.id} />{' '}
              {locale === 'en' ? c.nameEn : c.nameRo}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t('p.lf.localities')}</legend>
          <p className="muted">{t('p.lf.hint_geo')}</p>
          {counties.map((c) => (
            <details key={c.id}>
              <summary>{locale === 'en' ? c.nameEn : c.nameRo}</summary>
              {c.localities.map((loc) => (
                <label key={loc.id} style={{ display: 'block', minHeight: '44px' }}>
                  <input type="checkbox" name="localityIds" value={loc.id} /> {loc.nameRo}
                </label>
              ))}
            </details>
          ))}
        </fieldset>
        <div className="actions">
          <button className="btn" type="submit">
            {t('p.lf.submit')}
          </button>
        </div>
      </form>
    </main>
  );
}
