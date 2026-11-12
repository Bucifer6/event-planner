import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { exportPromotionPack } from '@eventdesk/core';

// C-12: promotion pack — generated copy and assets to EXPORT only; nothing is posted
// or spent automatically.
export default async function PromotionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const pack = await exportPromotionPack(id, user.accountId);

  return (
    <>
      <h2>{t('c.promo.title')}</h2>
      <div className="notice">{t('c.promo.export_only')}</div>
      <h3>RO</h3>
      <pre className="mono">{pack.copyRo}</pre>
      <h3>EN</h3>
      <pre className="mono">{pack.copyEn}</pre>
      <h3>{t('c.promo.assets')}</h3>
      <ul>
        {pack.assets.map((a) => (
          <li key={a.id} className="mono">
            {a.fileName} ({a.kind})
          </li>
        ))}
      </ul>
    </>
  );
}
