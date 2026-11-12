import Link from 'next/link';
import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { listHouseholds, listRsvpQuestions, getOccasionForMember } from '@eventdesk/core';
import { Card, Notice } from '@eventdesk/ui';
import {
  addQuestionAction,
  createHouseholdAction,
  createInvitationAction,
  importPreviewAction,
  revokeInvitationAction,
} from '../../../../actions/guests';

export default async function GuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ newlink?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const t = tf(locale);
  const households = await listHouseholds(id, user.accountId);
  const questions = await listRsvpQuestions(id, user.accountId);
  await getOccasionForMember(id, user.accountId);
  return (
    <>
      <Notice>{t('guests.children.note')}</Notice>
      {sp.newlink && (
        <Notice attention>
          <div>{t('guests.link')}</div>
          <div className="mono" style={{ wordBreak: 'break-all' }}>
            {sp.newlink}
          </div>
        </Notice>
      )}
      <Card>
        <h2>{t('guests.add')}</h2>
        <form action={createHouseholdAction.bind(null, id)}>
          <label htmlFor="name">{t('guests.household')}</label>
          <input id="name" name="name" type="text" required />
          <label htmlFor="leadEmail">{t('guests.leadEmail')}</label>
          <input id="leadEmail" name="leadEmail" type="email" />
          <label htmlFor="members">{t('guests.members')} (one per line)</label>
          <textarea id="members" name="members" rows={3} />
          <div className="actions">
            <button className="btn" type="submit">
              {t('guests.add')}
            </button>
          </div>
        </form>
      </Card>
      <Card>
        <h2>{t('guests.import')}</h2>
        <form action={importPreviewAction.bind(null, id)} encType="multipart/form-data">
          <input name="file" type="file" accept=".csv,.xlsx" required />
          <div className="actions">
            <button className="btn" type="submit">
              {t('guests.import.preview')}
            </button>
          </div>
        </form>
      </Card>
      <Card>
        <h2>{t('guests.questions')}</h2>
        <form action={addQuestionAction.bind(null, id)}>
          <select name="kind" defaultValue="free_text">
            <option value="menu_choice">menu_choice</option>
            <option value="allergies">allergies</option>
            <option value="accommodation_need">accommodation_need</option>
            <option value="transport_need">transport_need</option>
            <option value="free_text">free_text</option>
          </select>
          <input name="promptKey" type="text" placeholder="promptKey" />
          <div className="actions">
            <button className="btn" type="submit">
              {t('guests.questions.add')}
            </button>
          </div>
        </form>
        <ul>
          {questions.map((q) => (
            <li key={q.id} className="mono">
              {q.kind} — {q.promptKey}
            </li>
          ))}
        </ul>
      </Card>
      {households.map((h) => (
        <Card key={h.id}>
          <div className="row between">
            <strong>{h.name}</strong>
            <form action={createInvitationAction.bind(null, id, h.id)}>
              <button className="btn secondary" type="submit">
                {t('guests.invite')}
              </button>
            </form>
          </div>
          <div className="muted">{h.guests.map((g) => g.name).join(', ')}</div>
          {h.invitations.map((inv) => (
            <div key={inv.id} className="row between">
              <span className="mono">
                …{inv.revokedAt ? ` ${t('guests.revoked')}` : ` ${inv.locale} · ${inv.expiryMode}`}
              </span>
              {!inv.revokedAt && (
                <form action={revokeInvitationAction.bind(null, id, inv.id)}>
                  <button className="btn attention" type="submit">
                    {t('guests.revoke')}
                  </button>
                </form>
              )}
            </div>
          ))}
        </Card>
      ))}
      <Link href={`/occasions/${id}/guests`}>{''}</Link>
    </>
  );
}
