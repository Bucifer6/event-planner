import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGuestViewByQr } from '@eventdesk/core';
import { isLocale, t, type Locale } from '@eventdesk/i18n';
import { formatDate } from '@eventdesk/shared';
import { LangToggle } from '../../../../components/LangToggle';
import IncidentBanner from '../../../../components/IncidentBanner';

// C-09: the QR on a printed invitation opens the guest's OWN invitation view through
// the scoped qrId (the raw token stays hashed, SEC2). Same single-household view as
// the link; seating shown only when published (C-08).
export default async function GuestQrPage({
  params,
  searchParams,
}: {
  params: Promise<{ qrId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { qrId } = await params;
  const sp = await searchParams;
  let view;
  try {
    view = await getGuestViewByQr(qrId);
  } catch {
    notFound();
  }
  const locale: Locale = isLocale(sp.lang) ? sp.lang : (view.invitation.locale as Locale);
  return (
    <main className="wrap">
      <IncidentBanner />
      <div className="row between">
        <h1>{view.occasion.title}</h1>
        <LangToggle />
      </div>
      <p className="muted">
        {view.occasion.dateStart ? formatDate(view.occasion.dateStart, locale) : '—'} ·{' '}
        {view.household.name}
      </p>
      {view.seat && (
        <div className="notice">
          {t(locale, 'c.seat.yours')}: {view.seat.tableRef}
          {view.seat.seat ? ` · ${t(locale, 'c.seat.seat_n')} ${view.seat.seat}` : ''}
        </div>
      )}
      <p>
        <Link href={`/e/${view.occasion.publicSlug ?? ''}`}>{t(locale, 'c.pub.tab')}</Link>
      </p>
    </main>
  );
}
