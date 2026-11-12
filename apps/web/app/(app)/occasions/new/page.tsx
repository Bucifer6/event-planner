import { requireUser } from '../../../lib/session';
import { getLocale, tf } from '../../../lib/i18n';
import { listTemplates, TEMPLATE_KINDS } from '@eventdesk/core';
import { createOccasionAction } from '../../../actions/occasions';

export default async function NewOccasionPage() {
  await requireUser();
  const locale = await getLocale();
  const t = tf(locale);
  const templates = await listTemplates();
  return (
    <main className="wrap">
      <h1>{t('occ.new.title')}</h1>
      <form action={createOccasionAction}>
        <label htmlFor="title">{t('occ.title.label')}</label>
        <input id="title" name="title" type="text" required />
        <label htmlFor="kind">{t('occ.kind.label')}</label>
        <select id="kind" name="kind">
          {TEMPLATE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`templates.${k}.name`)}
            </option>
          ))}
          <option value="custom">—</option>
        </select>
        <label htmlFor="template">{t('occ.template.label')}</label>
        <select id="template" name="template">
          <option value="blank">{t('occ.template.blank')}</option>
          {templates.map((tpl) => (
            <option key={tpl.kind} value={tpl.kind}>
              {t(tpl.nameKey)}
            </option>
          ))}
        </select>
        <label htmlFor="dateMode">{t('occ.dateMode.label')}</label>
        <select id="dateMode" name="dateMode" defaultValue="date">
          <option value="date">{t('occ.datemode.date')}</option>
          <option value="range">{t('occ.datemode.range')}</option>
          <option value="poll">{t('occ.datemode.poll')}</option>
        </select>
        <label htmlFor="dateStart">{t('occ.date.label')}</label>
        <input id="dateStart" name="dateStart" type="date" />
        <label htmlFor="dateEnd">{t('occ.dateEnd.label')}</label>
        <input id="dateEnd" name="dateEnd" type="date" />
        <label htmlFor="capacity">{t('occ.capacity.label')}</label>
        <input id="capacity" name="capacity" type="number" min={1} />
        <div className="actions">
          <button className="btn" type="submit">
            {t('occ.create')}
          </button>
        </div>
      </form>
    </main>
  );
}
