import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { getOccasionForMember } from '@eventdesk/core';
import { Card } from '@eventdesk/ui';
import { deleteOccasionAction, previewDateMoveAction } from '../../../../actions/occasions';

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const { occasion } = await getOccasionForMember(id, user.accountId);
  return (
    <>
      <Card>
        <h2>{t('settings.date.move')}</h2>
        <p className="muted mono">
          {occasion.dateStart
            ? new Date(occasion.dateStart).toISOString().slice(0, 10)
            : t('common.unknown')}
        </p>
        <form action={previewDateMoveAction.bind(null, id)}>
          <label htmlFor="newDate">{t('settings.date.new')}</label>
          <input id="newDate" name="newDate" type="date" required />
          <div className="actions">
            <button className="btn" type="submit">
              {t('settings.date.preview')}
            </button>
          </div>
        </form>
      </Card>
      <Card>
        <h2>{t('settings.delete')}</h2>
        <form action={deleteOccasionAction.bind(null, id)}>
          <div className="actions">
            <button className="btn attention" type="submit">
              {t('settings.delete')}
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
