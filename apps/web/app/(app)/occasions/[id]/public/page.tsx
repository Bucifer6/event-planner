import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { prisma } from '@eventdesk/db';
import { listPublicRegistrations } from '@eventdesk/core';
import { publicPageAction, venueAction } from '../../../../actions/releasec';

// C-06/C-10: public event page config (slug, open/close, conditional questions),
// venue address + external maps link (SEC7 noopener), registrations with waitlist.
export default async function PublicPageManage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const occ = await prisma.occasion.findUniqueOrThrow({ where: { id } });
  const regs = await listPublicRegistrations(id, user.accountId);

  return (
    <>
      <h2>{t('c.pub.title')}</h2>
      <form action={publicPageAction.bind(null, id)}>
        <label htmlFor="slug">{t('c.pub.slug')}</label>
        <input id="slug" name="slug" type="text" defaultValue={occ.publicSlug ?? ''} />
        <label>
          <input type="checkbox" name="on" defaultChecked={occ.publicPageOn} /> {t('c.pub.on')}
        </label>
        <label htmlFor="questions">{t('c.pub.questions')}</label>
        <textarea
          id="questions"
          name="questions"
          rows={2}
          defaultValue={
            occ.publicQuestions
              ? JSON.stringify(occ.publicQuestions)
              : '[{"id":"q1","label":"Vii cu mașina?","type":"yesno"}]'
          }
        />
        <div className="actions">
          <button className="btn" type="submit">
            {t('common.save')}
          </button>
        </div>
      </form>
      <form action={venueAction.bind(null, id)}>
        <label htmlFor="address">{t('c.pub.address')}</label>
        <input id="address" name="address" type="text" defaultValue={occ.venueAddress ?? ''} />
        <label htmlFor="mapsUrl">{t('c.pub.maps')}</label>
        <input id="mapsUrl" name="mapsUrl" type="url" defaultValue={occ.venueMapsUrl ?? ''} />
        <div className="actions">
          <button className="btn secondary" type="submit">
            {t('common.save')}
          </button>
        </div>
      </form>
      {occ.publicPageOn && occ.publicSlug && (
        <p>
          <a
            className="btn secondary"
            href={`/e/${occ.publicSlug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('c.pub.open_page')}
          </a>
        </p>
      )}
      <h3>{t('c.pub.registrations')}</h3>
      {regs.map((r) => (
        <div key={r.id} className="card">
          {r.name} · <span className="label-factual">{r.state}</span>
        </div>
      ))}
    </>
  );
}
