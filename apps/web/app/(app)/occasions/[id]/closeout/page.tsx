import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { prisma } from '@eventdesk/db';
import { Card } from '@eventdesk/ui';
import { closeoutAction } from '../../../../actions/deliveries';

// B10: closeout list of unpaid balances, returns and deposits; lessons carried to
// the next occasion; starts the retention clock (private requests purged at
// closeout+30d, INF6).
export default async function CloseoutPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const closeout = await prisma.closeout.findUnique({ where: { occasionId: id } });
  return (
    <>
      <Card>
        <h2>{t('closeout.run')}</h2>
        <form action={closeoutAction.bind(null, id)}>
          <label>{t('closeout.lessons')}</label>
          <textarea name="lessons" rows={3} />
          <div className="actions">
            <button className="btn attention" type="submit">
              {t('closeout.run')}
            </button>
          </div>
        </form>
      </Card>
      {closeout && (
        <Card>
          <h2>{t('closeout.list')}</h2>
          <div className="label-factual">{t('closeout.unpaid')}</div>
          <pre className="mono">{JSON.stringify(closeout.unpaidBalances, null, 1)}</pre>
          <div className="label-factual">{t('closeout.returns')}</div>
          <pre className="mono">{JSON.stringify(closeout.returns, null, 1)}</pre>
          {closeout.lessons && (
            <>
              <div className="label-factual">{t('closeout.lessons')}</div>
              <p>{closeout.lessons}</p>
            </>
          )}
        </Card>
      )}
    </>
  );
}
