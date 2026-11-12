import { notFound } from 'next/navigation';
import { getPublicEventPage } from '@eventdesk/core';
import { getLocale, tf } from '../../lib/i18n';
import { formatDate } from '@eventdesk/shared';
import { LangToggle } from '../../../components/LangToggle';

// C-06/C-10: the public guest event page — venue address with an external navigation
// link (opens the guest's maps app, rel="noopener noreferrer" SEC7), programme, menu,
// and the read-only space view (POIs V9, parking V10). No guest identities, no
// unpublished seating, no visitor tracking (D1/D4).
export default async function PublicEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  let page;
  try {
    page = await getPublicEventPage(slug);
  } catch {
    notFound();
  }
  const o = page.occasion;
  return (
    <main className="wrap">
      <div className="row between">
        <h1>{o.title}</h1>
        <LangToggle />
      </div>
      <p className="muted">
        {o.dateStart ? formatDate(o.dateStart, locale) : ''}
        {o.capacityTotal ? ` · ${o.seatsTaken}/${o.capacityTotal}` : ''}
      </p>
      {o.venueAddress && (
        <p>
          📍 {o.venueAddress}{' '}
          {o.venueMapsUrl && (
            <a href={o.venueMapsUrl} target="_blank" rel="noopener noreferrer">
              {t('c.pub.navigate')}
            </a>
          )}
        </p>
      )}
      <h2>{t('c.prog.title')}</h2>
      {page.programme.length === 0 && <p className="muted">—</p>}
      <ul>
        {page.programme.map((p) => (
          <li key={p.id}>
            {p.startsAt ? formatDate(p.startsAt, locale) + ' — ' : ''}
            {p.title}
          </li>
        ))}
      </ul>
      <h2>{t('c.menu.title')}</h2>
      {page.menus.map((m) => (
        <div key={m.id}>
          <strong>{m.name}</strong>
          <ul>
            {m.items.map((it) => (
              <li key={it.id}>
                {it.name} {it.dietTags.length ? `(${it.dietTags.join(', ')})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {page.spaceView && (
        <>
          <h2>{t('c.pub.layout')}</h2>
          <ul>
            {page.spaceView.pois.map((p) => (
              <li key={p.id}>{p.label ?? p.kind}</li>
            ))}
          </ul>
          {page.spaceView.parking && (
            <p className="muted">
              {t('p.draw.parking')}:{' '}
              {page.spaceView.parking.onSite == null
                ? t('common.unknown')
                : page.spaceView.parking.onSite
                  ? t('common.yes')
                  : t('common.no')}
              {page.spaceView.parking.spaceCount != null &&
                ` · ${page.spaceView.parking.spaceCount}`}
            </p>
          )}
        </>
      )}
    </main>
  );
}
