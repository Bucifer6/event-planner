import { notFound, redirect } from 'next/navigation';
import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { prisma } from '@eventdesk/db';
import {
  getBusinessForAccount,
  listCataloguesForListing,
  listDirectoryCategories,
  listCounties,
} from '@eventdesk/core';
import {
  addCatalogueItemAction,
  addDrawingAction,
  addFixtureAction,
  addPoiAction,
  addTableAction,
  calibrateDrawingAction,
  createCatalogueAction,
  parkingAction,
  submitRevisionAction,
} from '../../../../actions/business';

// P-03/P-06/P-07: manage one listing — submit a revision (live stays up until approved),
// upload + calibrate drawings, tables/fixtures/POIs/parking, catalogues.
export default async function ListingManagePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const business = await getBusinessForAccount(user.accountId);
  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      categories: { include: { category: true } },
      counties: { include: { county: true } },
      localities: { include: { locality: true } },
      revisions: { orderBy: { createdAt: 'desc' } },
      drawings: { include: { tables: true, fixtures: true, pois: true, parking: true } },
    },
  });
  if (!listing || !business || listing.businessId !== business.id) notFound();
  const categories = await listDirectoryCategories();
  const counties = await listCounties();
  const catalogues = await listCataloguesForListing(listing.id);

  return (
    <main className="wrap">
      <h1>{listing.name}</h1>
      <div className="muted mono">
        {t(
          `p.biz.status.${listing.status === 'live' ? 'live' : listing.status === 'suspended' ? 'suspended' : 'pending'}`
        )}
      </div>

      <details>
        <summary>{t('p.biz.edit')}</summary>
        <form action={submitRevisionAction.bind(null, listing.id)}>
          <label htmlFor="name">{t('p.lf.name')}</label>
          <input id="name" name="name" type="text" defaultValue={listing.name} required />
          <label htmlFor="description">{t('p.lf.description')}</label>
          <textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={listing.description ?? ''}
          />
          <fieldset>
            <legend>{t('p.lf.categories')}</legend>
            {categories.map((c) => (
              <label key={c.id} style={{ display: 'block', minHeight: '44px' }}>
                <input
                  type="checkbox"
                  name="categoryIds"
                  value={c.id}
                  defaultChecked={listing.categories.some((lc) => lc.categoryId === c.id)}
                />{' '}
                {locale === 'en' ? c.nameEn : c.nameRo}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>{t('p.lf.counties')}</legend>
            {counties.map((c) => (
              <label key={c.id} style={{ display: 'block', minHeight: '44px' }}>
                <input
                  type="checkbox"
                  name="countyIds"
                  value={c.id}
                  defaultChecked={listing.counties.some((lc) => lc.countyId === c.id)}
                />{' '}
                {locale === 'en' ? c.nameEn : c.nameRo}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>{t('p.lf.localities')}</legend>
            {counties.map((c) => (
              <details key={c.id}>
                <summary>{locale === 'en' ? c.nameEn : c.nameRo}</summary>
                {c.localities.map((loc) => (
                  <label key={loc.id} style={{ display: 'block', minHeight: '44px' }}>
                    <input
                      type="checkbox"
                      name="localityIds"
                      value={loc.id}
                      defaultChecked={listing.localities.some((ll) => ll.localityId === loc.id)}
                    />{' '}
                    {loc.nameRo}
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
      </details>

      {listing.revisions.length > 0 && (
        <>
          <h2>{t('p.biz.revisions')}</h2>
          <ul>
            {listing.revisions.map((r) => (
              <li key={r.id} className="muted mono">
                {r.state} · {r.createdAt.toISOString().slice(0, 10)}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>{t('p.draw.title')}</h2>
      {listing.drawings.map((d) => (
        <div key={d.id} className="card">
          <h3>
            {d.spaceName} · v{d.version} ·{' '}
            {d.pixelsPerMeter ? t('p.draw.calibrated') : t('p.draw.uncalibrated')}
          </h3>
          {d.realWidthM != null && (
            <p className="muted mono">
              {d.realWidthM}×{d.realHeightM} m
            </p>
          )}
          <details>
            <summary>{t('p.draw.calibrate')}</summary>
            <form action={calibrateDrawingAction.bind(null, listing.id, d.id)}>
              <label htmlFor={`p1-${d.id}`}>{t('p.draw.p1')}</label>
              <input id={`p1-${d.id}`} name="p1x" type="number" placeholder="x" required />
              <input name="p1y" type="number" placeholder="y" required />
              <label htmlFor={`p2-${d.id}`}>{t('p.draw.p2')}</label>
              <input id={`p2-${d.id}`} name="p2x" type="number" placeholder="x" required />
              <input name="p2y" type="number" placeholder="y" required />
              <label htmlFor={`dist-${d.id}`}>{t('p.draw.dist')}</label>
              <input
                id={`dist-${d.id}`}
                name="realDistanceM"
                type="number"
                step="0.01"
                min="0.01"
                required
              />
              <div className="actions">
                <button className="btn secondary" type="submit">
                  {t('p.draw.calibrate')}
                </button>
              </div>
            </form>
          </details>
          <h4>{t('p.draw.table')}</h4>
          <ul>
            {d.tables.map((tb) => (
              <li key={tb.id}>
                {tb.tableType} × {tb.count}
              </li>
            ))}
          </ul>
          <form action={addTableAction.bind(null, listing.id, d.id)}>
            <input name="tableType" type="text" placeholder={t('p.draw.table_type')} required />
            <input name="widthM" type="number" step="0.01" min="0" placeholder={t('p.draw.w')} />
            <input name="heightM" type="number" step="0.01" min="0" placeholder={t('p.draw.h')} />
            <input name="count" type="number" min={1} defaultValue={1} />
            <button className="btn secondary" type="submit">
              {t('p.draw.add_table')}
            </button>
          </form>
          <h4>{t('p.draw.fixture')}</h4>
          <ul>
            {d.fixtures.map((f) => (
              <li key={f.id}>{f.kind}</li>
            ))}
          </ul>
          <form action={addFixtureAction.bind(null, listing.id, d.id)}>
            <input name="kind" type="text" placeholder={t('p.draw.fixture_kind')} required />
            <button className="btn secondary" type="submit">
              {t('p.draw.add_fixture')}
            </button>
          </form>
          <h4>{t('p.draw.poi')}</h4>
          <ul>
            {d.pois.map((p) => (
              <li key={p.id}>
                {p.kind}
                {p.label ? ` — ${p.label}` : ''}
              </li>
            ))}
          </ul>
          <form action={addPoiAction.bind(null, listing.id, d.id)}>
            <input name="kind" type="text" placeholder={t('p.draw.poi_kind')} required />
            <button className="btn secondary" type="submit">
              {t('p.draw.add_poi')}
            </button>
          </form>
          <details>
            <summary>{t('p.draw.parking')}</summary>
            <form action={parkingAction.bind(null, listing.id, d.id)}>
              <label>
                <input
                  type="checkbox"
                  name="onSite"
                  value="true"
                  defaultChecked={d.parking?.onSite === true}
                />{' '}
                {t('p.draw.parking_onsite')}
              </label>
              <label htmlFor={`sc-${d.id}`}>{t('p.draw.parking_count')}</label>
              <input
                id={`sc-${d.id}`}
                name="spaceCount"
                type="number"
                min={0}
                defaultValue={d.parking?.spaceCount ?? ''}
              />
              <label htmlFor={`dc-${d.id}`}>{t('p.draw.parking_drawing_count')}</label>
              <input
                id={`dc-${d.id}`}
                name="drawingSpaceCount"
                type="number"
                min={0}
                defaultValue={d.parking?.drawingSpaceCount ?? ''}
              />
              <label>
                <input
                  type="checkbox"
                  name="onStreet"
                  value="true"
                  defaultChecked={d.parking?.onStreet === true}
                />{' '}
                {t('p.draw.parking_street')}
              </label>
              <label>
                <input
                  type="checkbox"
                  name="paid"
                  value="true"
                  defaultChecked={d.parking?.paid === true}
                />{' '}
                {t('p.draw.parking_paid')}
              </label>
              <label>
                <input
                  type="checkbox"
                  name="accessibleSpaces"
                  value="true"
                  defaultChecked={d.parking?.accessibleSpaces === true}
                />{' '}
                {t('p.draw.parking_accessible')}
              </label>
              <label htmlFor={`wd-${d.id}`}>{t('p.draw.parking_walk')}</label>
              <input
                id={`wd-${d.id}`}
                name="walkingDistanceM"
                type="number"
                min={0}
                defaultValue={d.parking?.walkingDistanceM ?? ''}
              />
              <div className="actions">
                <button className="btn secondary" type="submit">
                  {t('p.draw.save_parking')}
                </button>
              </div>
            </form>
          </details>
        </div>
      ))}
      <details>
        <summary>{t('p.draw.add')}</summary>
        <form action={addDrawingAction.bind(null, listing.id)}>
          <label htmlFor="assetId">{t('p.draw.asset')}</label>
          <input id="assetId" name="assetId" type="text" required />
          <label htmlFor="spaceName">{t('p.draw.space')}</label>
          <input id="spaceName" name="spaceName" type="text" required />
          <label htmlFor="realWidthM">{t('p.draw.w')}</label>
          <input id="realWidthM" name="realWidthM" type="number" step="0.01" min="0" />
          <label htmlFor="realHeightM">{t('p.draw.h')}</label>
          <input id="realHeightM" name="realHeightM" type="number" step="0.01" min="0" />
          <div className="actions">
            <button className="btn" type="submit">
              {t('p.draw.add')}
            </button>
          </div>
        </form>
      </details>

      <h2>{t('p.cat.title')}</h2>
      {catalogues.map((c) => (
        <div key={c.id} className="card">
          <h3>{c.name}</h3>
          <ul>
            {c.items.map((i) => (
              <li key={i.id}>
                {i.variety}
                {i.seasonality ? ` · ${i.seasonality}` : ''}
                {i.pricePerStemBani != null ? ` · ${i.pricePerStemBani} bani/fir` : ''}
                {i.colours.length ? ` · ${i.colours.join(', ')}` : ''}
              </li>
            ))}
          </ul>
          <form action={addCatalogueItemAction.bind(null, listing.id, c.id)}>
            <input name="variety" type="text" placeholder={t('p.cat.variety')} required />
            <input name="seasonality" type="text" placeholder={t('p.cat.season')} />
            <input name="pricePerStemBani" type="number" min={0} placeholder={t('p.cat.price')} />
            <input name="colours" type="text" placeholder={t('p.cat.colours')} />
            <input name="imageAssetId" type="text" placeholder={t('p.cat.image')} />
            <button className="btn secondary" type="submit">
              {t('p.cat.add_item')}
            </button>
          </form>
        </div>
      ))}
      <form action={createCatalogueAction.bind(null, listing.id)}>
        <input name="name" type="text" placeholder={t('p.cat.name')} required />
        <button className="btn" type="submit">
          {t('p.cat.new')}
        </button>
      </form>
    </main>
  );
}
