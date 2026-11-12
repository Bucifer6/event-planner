import { Card, Notice } from '@eventdesk/ui';
import { getLocale, tf } from '../../../lib/i18n';
import { consolePData, createNoticeAction, sendNoticeAction } from '../../../actions/pconsole';

// W7: platform communications go to BUSINESSES only — never to planner-entered
// contacts (19.11/BD6).
export default async function CommsPage() {
  const locale = await getLocale();
  const t = tf(locale);
  const data = await consolePData();

  return (
    <>
      <h1>{t('p.con.comms.title')}</h1>
      <Notice>{t('p.con.comms.hint')}</Notice>
      <Card>
        <form action={createNoticeAction}>
          <label htmlFor="subject">{t('p.con.comms.subject')}</label>
          <input id="subject" name="subject" type="text" required />
          <label htmlFor="body">{t('p.con.comms.body')}</label>
          <textarea id="body" name="body" rows={5} required />
          <div className="actions">
            <button className="btn" type="submit">
              {t('p.con.comms.draft')}
            </button>
          </div>
        </form>
      </Card>
      {data.notices.map((n) => (
        <Card key={n.id}>
          <strong>{n.subject}</strong>
          <div className="muted mono">
            {n.sentAt
              ? `${t('p.con.comms.sent')} ${n.sentAt.toISOString().slice(0, 10)} · ${n.recipientCount}`
              : t('p.con.comms.draft_label')}
          </div>
          <p>{n.body.slice(0, 200)}</p>
          {!n.sentAt && (
            <form action={sendNoticeAction.bind(null, n.id)}>
              <button className="btn" type="submit">
                {t('p.con.comms.send')}
              </button>
            </form>
          )}
        </Card>
      ))}
    </>
  );
}
