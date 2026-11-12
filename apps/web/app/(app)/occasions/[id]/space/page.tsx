import Link from 'next/link';
import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { formatDateTime } from '@eventdesk/shared';
import { fitCheck, getSpaceModel } from '@eventdesk/core';
import { addCustomTableAction, attachSpaceModelAction } from '../../../../actions/business';
import { prisma } from '@eventdesk/db';

// P-06 (V4-V7): the occasion's space model — the venue's calibrated drawing pulled in
// on booking with a visible version + effective date; updates arrive as What-if
// previews (never a silent overwrite); custom tables are marked custom (V5); unknown
// dimensions are excluded from fit checks (V6).
export default async function SpacePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const model = await getSpaceModel(id, user.accountId);

  // candidate drawings: calibrated drawings of claimed listings of the occasion's
  // booked suppliers (P10 links enquiries to supplier records)
  const bookings = await prisma.booking.findMany({
    where: { occasionId: id },
    include: { supplier: true },
  });
  const supplierNames = bookings.map((b) => b.supplier.name);
  const allListings = await prisma.listing.findMany({
    where: { status: 'live', claimed: true, name: { in: supplierNames } },
    include: { drawings: true },
  });
  const candidates = allListings.flatMap((l) =>
    l.drawings.filter((d) => d.pixelsPerMeter != null).map((d) => ({ ...d, listingName: l.name }))
  );

  const fit = model
    ? fitCheck({
        tables: [
          ...model.drawing.tables.map((tb) => ({ widthM: tb.widthM, heightM: tb.heightM })),
          ...model.customTables.map((ct) => ({ widthM: ct.widthM, heightM: ct.heightM })),
        ],
      })
    : null;

  return (
    <main className="wrap">
      <div className="row between">
        <h1>{t('p.space.title')}</h1>
        <Link className="btn secondary" href={`/occasions/${id}/previews`}>
          {t('p.space.previews_link')}
        </Link>
      </div>
      {!model && <div className="notice">{t('p.space.no_model')}</div>}
      {model && (
        <div className="card">
          <h2>
            {t('p.space.version')} {model.version} — {model.drawing.spaceName}
          </h2>
          <div className="muted mono">
            {t('p.space.effective')}: {formatDateTime(model.effectiveAt, locale)} ·{' '}
            {t('p.draw.calibrated')} {model.drawing.pixelsPerMeter?.toFixed(2)} px/m
          </div>
          <h3>{t('p.draw.table')}</h3>
          <ul>
            {model.drawing.tables.map((tb) => (
              <li key={tb.id}>
                {tb.tableType} × {tb.count} —{' '}
                {tb.widthM != null && tb.heightM != null
                  ? `${tb.widthM}×${tb.heightM} m`
                  : t('common.unknown')}
              </li>
            ))}
            {model.customTables.map((ct) => (
              <li key={ct.id}>
                {ct.name} (custom) —{' '}
                {ct.widthM != null && ct.heightM != null
                  ? `${ct.widthM}×${ct.heightM} m`
                  : t('common.unknown')}
              </li>
            ))}
          </ul>
          <h3>{t('p.draw.fixture')}</h3>
          <ul>
            {model.drawing.fixtures.map((f) => (
              <li key={f.id}>
                {f.kind} —{' '}
                {f.widthM != null && f.heightM != null
                  ? `${f.widthM}×${f.heightM} m`
                  : t('common.unknown')}
              </li>
            ))}
          </ul>
          <h3>{t('p.draw.poi')}</h3>
          <ul>
            {model.drawing.pois.map((p) => (
              <li key={p.id}>
                {p.kind}
                {p.label ? ` — ${p.label}` : ''}
              </li>
            ))}
          </ul>
          {model.drawing.parking && (
            <>
              <h3>{t('p.draw.parking')}</h3>
              <ul>
                <li>
                  {t('p.draw.parking_onsite')}:{' '}
                  {model.drawing.parking.onSite == null
                    ? t('common.unknown')
                    : model.drawing.parking.onSite
                      ? t('common.yes')
                      : t('common.no')}
                </li>
                <li>
                  {t('p.draw.parking_count')}:{' '}
                  {model.drawing.parking.spaceCount ?? t('common.unknown')}
                </li>
                <li>
                  {t('p.draw.parking_street')}:{' '}
                  {model.drawing.parking.onStreet == null
                    ? t('common.unknown')
                    : model.drawing.parking.onStreet
                      ? t('common.yes')
                      : t('common.no')}
                </li>
                <li>
                  {t('p.draw.parking_paid')}:{' '}
                  {model.drawing.parking.paid == null
                    ? t('common.unknown')
                    : model.drawing.parking.paid
                      ? t('common.yes')
                      : t('common.no')}
                </li>
                <li>
                  {t('p.draw.parking_walk')}:{' '}
                  {model.drawing.parking.walkingDistanceM ?? t('common.unknown')} m
                </li>
              </ul>
            </>
          )}
          {fit && (
            <p className="muted mono">
              {t('p.space.fit')}: {t('p.space.fit_checked', { checked: fit.checked })} ·{' '}
              {t('p.space.fit_unknown', { excluded: fit.excludedUnknown })}
            </p>
          )}
          <form action={addCustomTableAction.bind(null, id)}>
            <h3>{t('p.space.custom_table')}</h3>
            <label htmlFor="name">{t('p.space.custom_name')}</label>
            <input id="name" name="name" type="text" required />
            <label htmlFor="widthM">{t('p.draw.w')}</label>
            <input id="widthM" name="widthM" type="number" step="0.01" min="0" />
            <label htmlFor="heightM">{t('p.draw.h')}</label>
            <input id="heightM" name="heightM" type="number" step="0.01" min="0" />
            <div className="actions">
              <button className="btn secondary" type="submit">
                {t('p.space.custom_table')}
              </button>
            </div>
          </form>
        </div>
      )}
      {candidates.length > 0 && (
        <>
          <h2>{t('p.draw.title')}</h2>
          {candidates.map((d) => (
            <div key={d.id} className="card">
              {d.listingName} — {d.spaceName} · v{d.version} · {t('p.draw.calibrated')}
              <form action={attachSpaceModelAction.bind(null, id, d.id)}>
                <button className="btn secondary" type="submit">
                  {t('p.space.attach')}
                </button>
              </form>
            </div>
          ))}
        </>
      )}
      {candidates.length === 0 && <p className="muted">{t('p.space.drawing_uncalibrated')}</p>}
    </main>
  );
}
