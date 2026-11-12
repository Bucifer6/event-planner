import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getListingPublic, listCounties } from '@eventdesk/core';
import { getLocale, tf } from '../../lib/i18n';
import { currentUser } from '../../lib/session';
import { LangToggle } from '../../../components/LangToggle';
import { sendEnquiryAction } from '../../actions/directory';

// P-04/P-05 (P7, P8): public listing page in ro+en. Claimed listings accept platform
// enquiries (form below, sign-in required); unclaimed ones expose only the published
// contact route (P29).
export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ occasion?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const t = tf(locale);
  let view;
  try {
    view = await getListingPublic(id);
  } catch {
    notFound();
  }
  const user = await currentUser();
  const counties = await listCounties();
  const l = view.listing;

  return (
    <main className="wrap">
      <div className="row between">
        <Link href="/directory" className="btn secondary">
          {t('p.dir.back')}
        </Link>
        <LangToggle />
      </div>
      <h1>{l.name}</h1>
      {view.unclaimed && (
        <div className="notice">
          {t('p.dir.unclaimed')}
          <br />
          {t('p.listing.unclaimed_notice')}
        </div>
      )}
      {view.badges.map((b) => (
        <div key={b} className="label-factual">
          {b}
        </div>
      ))}
      <h2>{t('p.listing.categories')}</h2>
      <p>
        {l.categories
          .map((c) => (locale === 'en' ? c.category.nameEn : c.category.nameRo))
          .join(' · ')}
      </p>
      <h2>{t('p.listing.areas')}</h2>
      <p>
        {l.counties.map((c) => c.county.code).join(' · ')}
        {l.localities?.length ? ` — ${l.localities.map((x) => x.locality.nameRo).join(', ')}` : ''}
      </p>
      {l.description && (
        <>
          <h2>{t('p.listing.description')}</h2>
          <p>{l.description}</p>
        </>
      )}
      {view.unclaimed && l.publicContactRoute && (
        <>
          <h2>{t('p.listing.contact')}</h2>
          <p className="mono">{l.publicContactRoute}</p>
        </>
      )}
      {view.stats && (
        <>
          <h2>{t('p.listing.stats')}</h2>
          <p className="muted mono">
            {t('p.dir.stats.answered', { share: Math.round(view.stats.shareAnswered * 100) })}
            {view.stats.medianReplyHours != null &&
              ` · ${t('p.dir.stats.reply', { hours: view.stats.medianReplyHours })}`}
          </p>
        </>
      )}
      <h2>{t('p.listing.drawings')}</h2>
      {l.drawings?.length ? (
        <ul>
          {l.drawings.map((d) => (
            <li key={d.id}>
              {d.spaceName} · v{d.version} · {t('p.draw.calibrated')}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('p.listing.no_drawings')}</p>
      )}
      <h2>{t('p.listing.catalogues')}</h2>
      {l.catalogues?.length ? (
        <ul>
          {l.catalogues.map((c) => (
            <li key={c.id}>
              {c.name} ({c.items.length})
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">—</p>
      )}

      {!view.unclaimed && (
        <>
          <h2>{t('p.enq.title')}</h2>
          {!user ? (
            <p>
              <Link href="/signin">{t('p.enq.signin_first')}</Link>
            </p>
          ) : (
            <form action={sendEnquiryAction.bind(null, l.id, sp.occasion ?? null)}>
              <label htmlFor="kind">{t('p.enq.kind')}</label>
              <select id="kind" name="kind" defaultValue="enquiry">
                <option value="enquiry">{t('p.enq.kind.enquiry')}</option>
                <option value="quote_request">{t('p.enq.kind.quote')}</option>
              </select>
              <label htmlFor="occasionKind">{t('p.enq.occasion_kind')}</label>
              <input id="occasionKind" name="occasionKind" type="text" required />
              <label htmlFor="date">{t('p.enq.date')}</label>
              <input id="date" name="date" type="date" />
              <label htmlFor="approxGuests">{t('p.enq.guests')}</label>
              <input id="approxGuests" name="approxGuests" type="number" min={1} />
              <label htmlFor="countyCode">{t('p.enq.county')}</label>
              <select id="countyCode" name="countyCode" defaultValue="">
                <option value="">—</option>
                {counties.map((c) => (
                  <option key={c.code} value={c.code}>
                    {locale === 'en' ? c.nameEn : c.nameRo}
                  </option>
                ))}
              </select>
              <label htmlFor="locality">{t('p.enq.locality')}</label>
              <input id="locality" name="locality" type="text" />
              <label htmlFor="budgetBand">
                {t('p.enq.budget')} ({t('p.enq.budget_opt')})
              </label>
              <input id="budgetBand" name="budgetBand" type="text" />
              <label htmlFor="message">{t('p.enq.message')}</label>
              <textarea id="message" name="message" required rows={4} />
              <label>
                <input id="shareEmail" name="shareEmail" type="checkbox" /> {t('p.enq.share_email')}
              </label>
              <div className="actions">
                <button className="btn" type="submit">
                  {t('p.enq.submit')}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </main>
  );
}
