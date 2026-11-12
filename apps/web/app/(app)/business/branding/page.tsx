import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/session';
import { getLocale, tf } from '../../../lib/i18n';
import { getBusinessForAccount, listLibrary } from '@eventdesk/core';
import {
  addLibraryItemAction,
  removeLibraryItemAction,
  setBrandingAction,
} from '../../../actions/business';

// P19/P20: branding (logo, name, one accent colour) shown on guest pages of the
// business's occasions, and the shared library (templates, checklists, supplier
// contacts) visible to the whole team.
export default async function BrandingPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = tf(locale);
  const business = await getBusinessForAccount(user.accountId);
  if (!business) redirect('/business');
  const library = await listLibrary(business.id, user.accountId);

  return (
    <main className="wrap">
      <h1>{t('p.brand.title')}</h1>
      {business.planLapsedAt && <div className="notice">{t('p.bocc.lapsed')}</div>}
      <form action={setBrandingAction.bind(null, business.id)}>
        <label htmlFor="name">{t('p.biz.name')}</label>
        <input id="name" name="name" type="text" defaultValue={business.name} required />
        <label htmlFor="logoAssetId">{t('p.brand.logo')}</label>
        <input
          id="logoAssetId"
          name="logoAssetId"
          type="text"
          defaultValue={business.logoAssetId ?? ''}
        />
        <label htmlFor="accentColor">{t('p.brand.accent')}</label>
        <input
          id="accentColor"
          name="accentColor"
          type="text"
          defaultValue={business.accentColor ?? ''}
          placeholder="#aabbcc"
          pattern="#[0-9a-fA-F]{6}"
        />
        <div className="actions">
          <button className="btn" type="submit">
            {t('common.save')}
          </button>
        </div>
      </form>

      <h2>{t('p.lib.title')}</h2>
      {library.length === 0 && <div className="notice">{t('p.lib.empty')}</div>}
      {library.map((item) => (
        <div key={item.id} className="card">
          <strong>{item.title}</strong> <span className="label-factual">{item.kind}</span>
          <pre className="mono">{JSON.stringify(item.payload).slice(0, 200)}</pre>
          <form action={removeLibraryItemAction.bind(null, item.id, business.id)}>
            <button className="btn secondary" type="submit">
              {t('common.delete')}
            </button>
          </form>
        </div>
      ))}
      <form action={addLibraryItemAction.bind(null, business.id)}>
        <label htmlFor="kind">{t('p.lib.kind')}</label>
        <select id="kind" name="kind" defaultValue="checklist">
          <option value="template">{t('p.lib.kind.template')}</option>
          <option value="checklist">{t('p.lib.kind.checklist')}</option>
          <option value="supplier_contact">{t('p.lib.kind.supplier_contact')}</option>
        </select>
        <label htmlFor="title">{t('p.lib.title_label')}</label>
        <input id="title" name="title" type="text" required />
        <label htmlFor="note">{t('p.lib.note')}</label>
        <textarea id="note" name="note" rows={2} />
        <div className="actions">
          <button className="btn" type="submit">
            {t('p.lib.add')}
          </button>
        </div>
      </form>
    </main>
  );
}
