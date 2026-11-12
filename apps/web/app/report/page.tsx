import { getLocale, tf } from '../lib/i18n';
import { reportContentAction } from '../actions/lau';

// LAU8 (DSA notice-and-action): anyone can report illegal content or an unlawful
// listing; every report is logged (SEC10 audit) and decided in the console with the
// reason given to the affected party (W3 flow). Moderation rules in plain Romanian.
export default async function ReportPage() {
  const locale = await getLocale();
  const t = tf(locale);
  return (
    <main className="wrap">
      <h1>{t('lau.report.title')}</h1>
      <p className="muted">{t('lau.report.hint')}</p>
      <div className="notice">
        <strong>{t('lau.report.rules_title')}</strong> {t('lau.report.rules')}
      </div>
      <form action={reportContentAction}>
        <label>{t('lau.report.contact')}</label>
        <input name="contact" type="text" required />
        <label>{t('lau.report.kind')}</label>
        <select name="kind" defaultValue="illegal_content">
          <option value="illegal_content">{t('lau.report.kind.illegal_content')}</option>
          <option value="unlawful_listing">{t('lau.report.kind.unlawful_listing')}</option>
          <option value="other">{t('lau.report.kind.other')}</option>
        </select>
        <label>{t('lau.report.listing')}</label>
        <input name="listingId" type="text" />
        <label>{t('lau.report.detail')}</label>
        <textarea name="detail" required rows={5} />
        <button className="btn" type="submit">
          {t('lau.report.submit')}
        </button>
      </form>
      <p className="muted">{t('lau.report.thanks')}</p>
    </main>
  );
}
