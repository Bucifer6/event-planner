import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { prisma } from '@eventdesk/db';
import { listArrangementDesigns, listPublicCatalogues, searchDirectory } from '@eventdesk/core';
import { arrangementAction, quoteFromDesignAction } from '../../../../actions/releasec';

// C-13/F3-F6: visual flower arrangement designer — base form + catalogue items from
// one or more businesses, stem counts, running INDICATIVE cost (never a quote), then
// a quote request through the enquiry flow carrying only the F5 fields.
export default async function ArrangementsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const designs = await listArrangementDesigns(id, user.accountId);
  const catalogues = await listPublicCatalogues('floristi');
  const florists = await searchDirectory({ categorySlug: 'floristi', countyCode: 'B', limit: 10 });

  return (
    <>
      <h2>{t('c.arr.title')}</h2>
      <form action={arrangementAction.bind(null, id)}>
        <label htmlFor="baseForm">{t('c.arr.base')}</label>
        <select id="baseForm" name="baseForm" defaultValue="hand-tied">
          <option value="hand-tied">hand-tied</option>
          <option value="table-centrepiece">table centrepiece</option>
          <option value="pedestal">pedestal</option>
          <option value="arched">arched</option>
          <option value="buttonhole">buttonhole</option>
        </select>
        {catalogues.flatMap((c) =>
          c.items.map((it) => (
            <label key={it.id} style={{ display: 'block', minHeight: '44px' }}>
              <input type="checkbox" name="itemId" value={it.id} /> {it.variety} ({c.name})
              <input
                name="stems"
                type="number"
                min={1}
                defaultValue={5}
                style={{ width: '5em' }}
              />{' '}
              {t('c.arr.stems')}
              {it.pricePerStemBani != null && (
                <span className="muted mono"> · {it.pricePerStemBani} bani/fir (indicativ)</span>
              )}
            </label>
          ))
        )}
        <div className="actions">
          <button className="btn" type="submit">
            {t('c.arr.save')}
          </button>
        </div>
      </form>
      {designs.map((d) => (
        <div key={d.id} className="card">
          <strong>{d.baseForm}</strong> · v{d.version} ·{' '}
          <span className="label-factual">
            {t('c.arr.indicative')}: {d.indicativeCostBani} bani
          </span>
          <form action={quoteFromDesignAction.bind(null, id, d.id)}>
            <select name="listingId" defaultValue="">
              <option value="">—</option>
              {florists.map((f) => (
                <option key={f.listing.id} value={f.listing.id}>
                  {f.listing.name}
                </option>
              ))}
            </select>
            <input name="message" type="text" placeholder={t('p.enq.message')} required />
            <label>
              <input type="checkbox" name="shareEmail" /> {t('p.enq.share_email')}
            </label>
            <button className="btn secondary" type="submit">
              {t('c.arr.quote')}
            </button>
          </form>
        </div>
      ))}
    </>
  );
}
