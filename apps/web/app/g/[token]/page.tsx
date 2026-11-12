import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGuestView } from '@eventdesk/core';
import { isLocale, t, type Locale } from '@eventdesk/i18n';
import { formatDate } from '@eventdesk/shared';
import { Card, Notice } from '@eventdesk/ui';
import { LangToggle } from '../../../components/LangToggle';
import { votePollAction } from '../../actions/rsvp';

// S6/SEC2: the guest link exposes only its own household's view. L2: the link opens in
// the invitation's language; one-tap switch via ?lang=.
export default async function GuestPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  let view;
  try {
    view = await getGuestView(token);
  } catch {
    notFound();
  }
  const locale: Locale = isLocale(sp.lang) ? sp.lang : (view.invitation.locale as Locale);
  return (
    <main className="wrap">
      <div className="row between">
        <h1>{t(locale, 'rsvp.welcome', { occasion: view.occasion.title })}</h1>
        <LangToggle guestBase={`/g/${token}`} />
      </div>
      {view.changedSinceLastVisit && <Notice attention>{t(locale, 'rsvp.changed')}</Notice>}
      <Card>
        <h2>{view.household.name}</h2>
        <p className="muted">{view.household.guests.map((g) => g.name).join(', ')}</p>
        <Notice>{t(locale, 'guests.children.note')}</Notice>
        <Link className="btn" href={`/g/${token}/rsvp?lang=${locale}`}>
          RSVP
        </Link>
      </Card>
      {view.polls.map((poll) => (
        <Card key={poll.id}>
          <strong>{poll.title ?? t(locale, 'poll.title')}</strong>
          {poll.decidedDate ? (
            <Notice>
              {t(locale, 'poll.decided')}: {formatDate(poll.decidedDate, locale)}
            </Notice>
          ) : (
            <form action={votePollAction}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="pollId" value={poll.id} />
              <div className="row">
                {(['yes', 'maybe', 'no'] as const).map((choice) => (
                  <button
                    key={choice}
                    className="btn secondary"
                    name="choice"
                    value={choice}
                    type="submit"
                  >
                    {t(locale, `common.${choice}`)}
                  </button>
                ))}
              </div>
              {poll.votes[0] && (
                <div className="muted mono">{t(locale, `common.${poll.votes[0].choice}`)}</div>
              )}
            </form>
          )}
        </Card>
      ))}
      {view.lastResponse && (
        <Card>
          <div className="label-factual">
            {t(locale, 'rsvp.adults')}: {view.lastResponse.adults} · +
            {view.lastResponse.childrenCount} {locale === 'ro' ? 'copii' : 'children'}
          </div>
        </Card>
      )}
    </main>
  );
}
