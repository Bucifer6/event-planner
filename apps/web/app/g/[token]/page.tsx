import { getOccasionBranding } from "@ed/core/bizoccasions"; // Release P (P20)
import { getGuestInvitationText } from "@ed/core/invitationtext"; // custom wording (MCP5 label)
import { getGuestView, markGuestLinkViewed, type GuestView } from "@ed/core/invitations";
import { FORM_STAMP_FIELD, HONEYPOT_FIELD, issueFormStamp } from "@ed/core/ratelimit";
import { questionField } from "@ed/core/rsvp";
import { formatDateTime, formatTime, formatWeekdayDate } from "@ed/i18n/format";
import { DescriptionList, ExternalLink, Invitation, Notice, Seal } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { IncidentBanner } from "@/components/incident-banner/IncidentBanner";
import { childrenForm, GUEST_LANG_PARAM, guestHref, guestTranslator, resolveGuestRequest } from "@/lib/guest";
import { BrandBlock, brandScope } from "./Branding"; // Release P (P20)
import styles from "./guest.module.css";
import { RsvpWizard, type WizardLabels, type WizardQuestion } from "./rsvp-wizard";
import type { GuestFormBase } from "./section-forms";
import { GuestSections } from "./sections";

// The guest link (A6, S6, SEC2, SEC7, L2, INF5, Q3) — the most-seen page of the product.
// Public: no account, no cookie. The token decides the household; the invitation decides the
// language (?lang= switches wording only). Server-rendered; the only client code is the
// one-question-per-screen form.

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const req = await resolveGuestRequest(token, first(sp[GUEST_LANG_PARAM]));
  const base: Metadata = { robots: { index: false, follow: false }, referrer: "same-origin" };
  if (req.status !== "ok") return base;
  const view = await getGuestView(req.ctx).catch(() => null);
  return view ? { ...base, title: view.occasion.title } : base;
}

function whenLine(view: GuestView, locale: "ro" | "en", undecided: string): string {
  const { startsAt, endsAt, timezone } = view.occasion;
  if (!startsAt) return undecided;
  const day = formatWeekdayDate(startsAt, locale, timezone);
  if (endsAt && formatWeekdayDate(endsAt, locale, timezone) !== day) {
    return `${day} – ${formatWeekdayDate(endsAt, locale, timezone)}`;
  }
  // occasions dated by day are anchored at noon: only a real time of day is shown
  const time = formatTime(startsAt, locale, timezone);
  return time === "12:00" || time === "00:00" ? day : `${day} · ${time}`;
}

export default async function GuestLinkPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const req = await resolveGuestRequest(token, first(sp[GUEST_LANG_PARAM]));
  if (req.status === "notFound") notFound();

  if (req.status === "rateLimited") {
    const t = await getTranslations("rsvp.throttled");
    return (
      <div className="ed-solo">
        <main className="ed-solo__main" id="main">
          <div className={styles.plain}>
            <Seal size={40} />
            <h1 className={styles.confirmTitle}>{t("title")}</h1>
            <p className="ed-muted">
              {req.retryAt ? t("bodyAt", { time: formatTime(new Date(req.retryAt), "ro") }) : t("body")}
            </p>
          </div>
        </main>
      </div>
    );
  }

  const { ctx, locale } = req;
  const view = await getGuestView(ctx);
  await markGuestLinkViewed(ctx);
  // Release P (P20): name, logo and accent of the business running this occasion; null after handover (P22)
  const branding = await getOccasionBranding(ctx, view.occasion.id);
  const scope = brandScope(branding);
  // The planner's own wording for the plate. While it still is an assistant's draft it says so (MCP5).
  const wording = await getGuestInvitationText(ctx);
  const t = guestTranslator(locale, "rsvp");
  const tr = guestTranslator(locale);

  const editing = first(sp.edit) === "1";
  const response = view.rsvp.response;
  const answering = view.rsvp.open && (!response || editing);
  const base: GuestFormBase = {
    token,
    lang: locale,
    stamp: issueFormStamp(ctx.now),
    stampField: FORM_STAMP_FIELD,
    honeypotField: HONEYPOT_FIELD,
    honeypotLabel: t("form.honeypot"),
  };

  const questions: WizardQuestion[] = view.rsvp.questions.map((q) => ({
    id: q.id,
    field: questionField(q.id),
    text: q.text[locale],
    answerType: q.answerType,
    options: q.options.map((o) => ({ id: o.id, label: o[locale] })),
    required: q.required,
  }));

  const mapsHref = view.occasion.venueAddress
    ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(view.occasion.venueAddress)}`
    : null;

  const plate = (
    <Invitation
      kicker={t("invite.kicker")}
      title={view.occasion.title}
      meta={whenLine(view, locale, t("invite.dateUndecided"))}
    >
      {view.occasion.venueName || view.occasion.venueAddress ? (
        <p className={styles.venue}>
          {view.occasion.venueName}
          {view.occasion.venueName && view.occasion.venueAddress ? <br /> : null}
          {view.occasion.venueAddress}
          {mapsHref ? (
            <>
              <br />
              <ExternalLink href={mapsHref}>{t("invite.map")}</ExternalLink>
            </>
          ) : null}
        </p>
      ) : null}
      {wording.text ? (
        <div className={styles.wording}>
          <p className={styles.wordingText}>{wording.text}</p>
          {wording.externalAssistant ? <p className="ed-small ed-muted">{tr("whatif.external")}</p> : null}
        </div>
      ) : null}
      <p className={styles.household}>{t("invite.for", { name: view.household.name })}</p>
    </Invitation>
  );

  const sections = <GuestSections view={view} locale={locale} base={base} />;

  const labels: WizardLabels = {
    progress: t.raw("form.progress") as string,
    optional: tr("common.optional"),
    continue: tr("common.actions.continue"),
    back: tr("common.actions.back"),
    send: t("form.send"),
    sending: t("form.sending"),
    attendingQuestion: t("form.attendingQuestion"),
    attendingYes: t("form.attendingYes"),
    attendingMaybe: t("form.attendingMaybe"),
    attendingNo: t("form.attendingNo"),
    chooseAttending: t("errors.chooseAttending"),
    adultsQuestion: t("form.adultsQuestion"),
    adultsHint: t("form.adultsHint"),
    childrenQuestion: t("form.childrenQuestion"),
    childrenHint: t("form.childrenHint"),
    decrease: t("form.decrease"),
    increase: t("form.increase"),
    atLeastOneAdult: t("errors.atLeastOneAdult"),
    answerRequired: t("errors.answerRequired"),
    chooseOption: t("errors.chooseOption"),
    textHint: t("form.textHint"),
    childDetailsTitle: t("errors.childDetails"),
    childDetailsBody: t("form.childDetailsBody"),
    emailQuestion: t("form.emailQuestion"),
    emailHint: t("form.emailHint"),
    emailHintOnFile: t("form.emailHintOnFile"),
    emailLabel: t("form.emailLabel"),
    emailInvalid: tr("common.validation.invalidEmail"),
    reviewProgress: t("form.reviewProgress"),
    reviewTitle: t("form.reviewTitle"),
    reviewIntro: t("form.reviewIntro"),
    reviewAttending: t("summary.attending"),
    reviewAdults: t("summary.adults"),
    reviewChildren: t("summary.children"),
    reviewEmail: t("summary.email"),
    reviewEmailNone: t("summary.emailNone"),
    reviewEmailKept: t("summary.emailKept"),
    noAnswer: t("summary.noAnswer"),
    honeypot: t("form.honeypot"),
    retryAt: tr.raw("common.errors.retryAt") as string,
  };

  const attendingText = response
    ? { yes: t("form.attendingYes"), maybe: t("form.attendingMaybe"), no: t("form.attendingNo") }[response.attending]
    : "";

  return (
    <div className={`ed-solo${scope.className ? ` ${scope.className}` : ""}`} style={scope.style} lang={locale}>
      <header className={`ed-solo__head ${styles.head}`}>
        <Seal size={32} />
        <nav className="ed-langswitch" aria-label={tr("common.languages.switchTo")}>
          <a href={guestHref(token, "ro", editing ? { edit: "1" } : {})} aria-current={locale === "ro" ? "true" : undefined} lang="ro" title="Română">
            RO
          </a>
          <a href={guestHref(token, "en", editing ? { edit: "1" } : {})} aria-current={locale === "en" ? "true" : undefined} lang="en" title="English">
            EN
          </a>
        </nav>
      </header>

      <main className="ed-solo__main" id="main">
        <IncidentBanner />
        {branding ? <BrandBlock branding={branding} label={tr("bizoccasions.guest.organisedBy")} /> : null}

        {view.occasion.status === "cancelled" ? (
          <Notice tone="attention" title={t("status.cancelledTitle")}>
            {t("status.cancelledBody")}
          </Notice>
        ) : null}
        {view.occasion.status === "postponed" ? (
          <Notice tone="attention" title={t("status.postponedTitle")}>
            {t("status.postponedBody")}
          </Notice>
        ) : null}
        {view.changed ? (
          <Notice tone="accent" title={t("changes.title")}>
            {view.changed.reasonKey && tr.has(view.changed.reasonKey)
              ? tr(view.changed.reasonKey)
              : t("changes.generic")}
          </Notice>
        ) : null}

        {answering ? (
          <RsvpWizard
            token={token}
            lang={locale}
            stamp={base.stamp}
            stampField={FORM_STAMP_FIELD}
            honeypotField={HONEYPOT_FIELD}
            doneHref={guestHref(token, locale, { done: "1" })}
            questions={questions}
            hasEmail={view.household.hasEmail}
            labels={labels}
            initial={{
              attending: response?.attending ?? "",
              adults: response?.adultsCount ?? Math.max(1, view.household.adults.length),
              children: response?.childrenCount ?? 0,
              answers: Object.fromEntries(
                Object.entries(response?.answers ?? {}).map(([id, a]) => [id, a.optionId ?? a.valueText ?? ""]),
              ),
              email: "",
            }}
            intro={
              <>
                {plate}
                {view.rsvp.deadline ? (
                  <p className={`ed-small ed-muted ${styles.center}`}>
                    {t("form.deadline", { date: formatWeekdayDate(view.rsvp.deadline, locale, view.occasion.timezone) })}
                  </p>
                ) : null}
              </>
            }
            after={sections}
          />
        ) : (
          <>
            {plate}
            {response ? (
              <section className={styles.block} aria-labelledby="rsvp-recorded">
                <p className="ed-label">{t("recorded.eyebrow")}</p>
                <h2 className={styles.confirmTitle} id="rsvp-recorded">
                  {t(`recorded.title.${response.attending}`)}
                </h2>
                {first(sp.done) === "1" ? (
                  <Notice tone="success" role="status">
                    {t("recorded.saved")}
                  </Notice>
                ) : null}
                <DescriptionList
                  items={[
                    { term: t("summary.attending"), value: attendingText },
                    ...(response.attending === "no"
                      ? []
                      : [
                          { term: t("summary.adults"), value: <span className="ed-num">{response.adultsCount}</span> },
                          {
                            term: t("summary.children"),
                            value:
                              response.childrenCount > 0
                                ? t(`summary.children${childrenForm(response.childrenCount)}`, { count: response.childrenCount })
                                : t("summary.noChildren"),
                          },
                          ...view.rsvp.questions
                            .filter((q) => response.answers[q.id])
                            .map((q) => {
                              const a = response.answers[q.id]!;
                              return {
                                term: q.text[locale],
                                value: a.optionId ? (q.options.find((o) => o.id === a.optionId)?.[locale] ?? "") : (a.valueText ?? ""),
                              };
                            }),
                        ]),
                  ]}
                />
                <p className="ed-small ed-muted">
                  {t("recorded.at", { date: formatDateTime(response.answeredAt, locale) })}
                  {response.attending !== "no" ? ` ${t("recorded.childrenNote")}` : ""}
                </p>
                {view.rsvp.open ? (
                  <div>
                    <a className="ed-btn" href={guestHref(token, locale, { edit: "1" })}>
                      {t("recorded.change")}
                    </a>
                    {view.rsvp.deadline ? (
                      <p className={`ed-small ed-muted ${styles.gapTop}`}>
                        {t("recorded.changeUntil", { date: formatWeekdayDate(view.rsvp.deadline, locale, view.occasion.timezone) })}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="ed-small ed-muted">{t("recorded.closed")}</p>
                )}
              </section>
            ) : (
              <Notice title={t("closed.title")}>{t("closed.body")}</Notice>
            )}
            {sections}
          </>
        )}
      </main>

      <footer className="ed-solo__foot">
        <p>{t("foot.privacy")}</p>
      </footer>
    </div>
  );
}
