import { notFound } from 'next/navigation';
import { getGuestView } from '@eventdesk/core';
import { isLocale, t, type Locale } from '@eventdesk/i18n';
import { Card, Notice } from '@eventdesk/ui';
import { rsvpNextAction, submitRsvpAction } from '../../../actions/rsvp';

// A6: custom RSVP questions are shown one at a time on the guest link. Children are
// only an attending count ("+n copii"); free-text answers with child-like details are
// flagged and the guest is warned. SEC11: honeypot + time-to-submit floor included.
export default async function RsvpPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
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
  const questions = view.questions;

  // Step machine: 0 = adults, 1 = children, 2 = per-person attendance + lead email,
  // 3.. = one custom question per screen, then submit.
  const totalSteps = 3 + questions.length;
  const step = Math.min(Math.max(Number(sp.step ?? 0), 0), totalSteps);

  const hiddenFields = (extra: Record<string, string> = {}) => (
    <>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="step" value={String(step)} />
      <input type="hidden" name="lang" value={locale} />
      <input type="hidden" name="shownAt" value={sp.shownAt ?? String(Date.now())} />
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        style={{ position: 'absolute', left: -9999 }}
        aria-hidden="true"
      />
      {Object.entries({ ...sp, ...extra }).map(([k, v]) =>
        k === 'step' || k === 'lang' || k === 'shownAt' || k === 'website' ? null : (
          <input key={k} type="hidden" name={k} value={v ?? ''} />
        )
      )}
    </>
  );

  if (step === totalSteps) {
    return (
      <main className="wrap">
        <Card>
          <h1>{t(locale, 'rsvp.submit')}</h1>
          <form action={submitRsvpAction}>
            {hiddenFields()}
            <div className="actions">
              <button className="btn" type="submit">
                {t(locale, 'rsvp.submit')}
              </button>
            </div>
          </form>
        </Card>
      </main>
    );
  }

  if (step === 0) {
    return (
      <main className="wrap">
        <Card>
          <h1>{t(locale, 'rsvp.adults')}</h1>
          <form action={rsvpNextAction}>
            {hiddenFields({ adults: sp.adults ?? '1' })}
            <input
              name="adults"
              type="number"
              min={0}
              max={50}
              defaultValue={Number(sp.adults ?? 1)}
              required
            />
            <div className="actions">
              <button className="btn" type="submit">
                {t(locale, 'rsvp.next')}
              </button>
            </div>
          </form>
        </Card>
      </main>
    );
  }

  if (step === 1) {
    return (
      <main className="wrap">
        <Card>
          <h1>{t(locale, 'rsvp.children')}</h1>
          <Notice>{t(locale, 'rsvp.children.note')}</Notice>
          <form action={rsvpNextAction}>
            {hiddenFields({ children: sp.children ?? '0' })}
            <input
              name="children"
              type="number"
              min={0}
              max={50}
              defaultValue={Number(sp.children ?? 0)}
              required
            />
            <div className="actions">
              <button className="btn" type="submit">
                {t(locale, 'rsvp.next')}
              </button>
            </div>
          </form>
        </Card>
      </main>
    );
  }

  if (step === 2) {
    return (
      <main className="wrap">
        <Card>
          <h1>{t(locale, 'rsvp.attendance')}</h1>
          <form action={rsvpNextAction}>
            {hiddenFields()}
            {view.household.guests.map((g) => (
              <div className="row" key={g.id}>
                <input type="hidden" name={`attend_${g.id}`} value="off" />
                <input
                  type="checkbox"
                  id={`a_${g.id}`}
                  name={`attend_${g.id}`}
                  value="on"
                  defaultChecked
                />
                <label htmlFor={`a_${g.id}`} style={{ margin: 0 }}>
                  {g.name}
                </label>
              </div>
            ))}
            <label htmlFor="leadEmail">{t(locale, 'guests.leadEmail')}</label>
            <input id="leadEmail" name="leadEmail" type="email" defaultValue={sp.leadEmail ?? ''} />
            <div className="actions">
              <button className="btn" type="submit">
                {t(locale, 'rsvp.next')}
              </button>
            </div>
          </form>
        </Card>
      </main>
    );
  }

  const q = questions[step - 3]!;
  return (
    <main className="wrap">
      <Card>
        <h1>{q.promptKey}</h1>
        {q.kind === 'free_text' && <Notice>{t(locale, 'rsvp.child_warning')}</Notice>}
        <form action={rsvpNextAction}>
          {hiddenFields()}
          <input type="hidden" name="qindex" value={q.id} />
          <input
            name="answer"
            type="text"
            defaultValue={sp[`q_${q.id}`] ?? ''}
            required={q.required}
          />
          <div className="actions">
            <button className="btn" type="submit">
              {t(locale, 'rsvp.next')}
            </button>
          </div>
        </form>
      </Card>
    </main>
  );
}

export const dynamic = 'force-dynamic';
