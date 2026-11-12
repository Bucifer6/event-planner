import { consoleData, requestMonetizationAction } from '../../../actions/console';
import { Card, Notice } from '@eventdesk/ui';
import { getLocale, tf } from '../../../lib/i18n';

// W6/MON2: the single platform-level monetization switch, OFF by default; enabling
// requires a second-person approval and starts the 60-day public notice (P28).
// MON5: while OFF, Featured placement does not exist anywhere.
export default async function MonetizationPage() {
  const data = await consoleData();
  const locale = await getLocale();
  const t = tf(locale);
  return (
    <>
      <h1>{t('console.monetization')}</h1>
      <Card>
        <div className="row between">
          <span>{t('console.switch_state')}</span>
          <strong className="label-factual">{data.mon.state}</strong>
        </div>
        {data.mon.state === 'OFF' && (
          <>
            <Notice>{t('console.free_phase')}</Notice>
            <form action={requestMonetizationAction}>
              <button className="btn attention" type="submit">
                {t('console.request_enable')}
              </button>
            </form>
          </>
        )}
        {data.mon.state === 'ON' && <Notice attention>{t('console.notice_started')}</Notice>}
      </Card>
    </>
  );
}
