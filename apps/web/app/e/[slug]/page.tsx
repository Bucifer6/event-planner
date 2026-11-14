import { getPublicEvent, publicQuestionField, type PublicEvent } from "@ed/core/publicpage";
import { FORM_STAMP_FIELD, HONEYPOT_FIELD, issueFormStamp } from "@ed/core/ratelimit";
import { REGISTRATION_MAX_ADULTS, REGISTRATION_MAX_CHILDREN } from "@ed/core/registrations";
import { formatTime, formatWeekdayDate } from "@ed/i18n/format";
import { newId } from "@ed/shared/ids";
import { Invitation, Notice, Seal } from "@ed/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandBlock, brandScope } from "@/app/g/[token]/Branding"; // Release P (P20): business name, logo, accent
import { IncidentBanner } from "@/components/incident-banner/IncidentBanner";
import { guestTranslator } from "@/lib/guest";
import { EventBlock, JourneyFacts, MenuCard, ProgrammeList, VenueLines } from "../_components/content";
import styles from "../_components/event.module.css";
import { RegistrationForm, type RegistrationLabels, type RegistrationQuestion } from "../_components/forms";
import { PUBLIC_LANG_PARAM, publicCtx, publicHref, publicLocale } from "../_lib/public";
import { HelpFootLink } from "@/components/help/HelpFootLink";

// The public event page (C-06, C-10, SEC7, SEC11, Q3). No account, no cookie: anyone with the
// address reads what the planner published. Server-rendered; the only client code is the
// registration form. An unknown address, an unpublished page and a closed occasion get the
// same notFound(). The venue link is a plain external maps link (no embedded map, no
// third-party script) rendered with rel="noopener noreferrer".

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const locale = publicLocale(sp[PUBLIC_LANG_PARAM]);
  const base: Metadata = { robots: { index: false, follow: false }, referrer: "same-origin" };
  const event = await getPublicEvent(await publicCtx(locale), slug).catch(() => null);
  return event ? { ...base, title: event.title[locale], description: event.description[locale]?.slice(0, 160) } : base;
}

function whenLine(event: PublicEvent, locale: "ro" | "en", undecided: string): string | null {
  if (!event.dateShown) return null;
  if (!event.startsAt) return undecided;
  const day = formatWeekdayDate(event.startsAt, locale, event.timezone);
  if (event.endsAt && formatWeekdayDate(event.endsAt, locale, event.timezone) !== day) return `${day} – ${formatWeekdayDate(event.endsAt, locale, event.timezone)}`;
  // occasions dated by day are anchored at noon: only a real time of day is shown
  const time = formatTime(event.startsAt, locale, event.timezone);
  return time === "12:00" || time === "00:00" ? day : `${day} · ${time}`;
}

export default async function PublicEventPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const locale = publicLocale(sp[PUBLIC_LANG_PARAM]);
  const ctx = await publicCtx(locale);
  const event = await getPublicEvent(ctx, slug);
  if (!event) notFound();

  const t = guestTranslator(locale, "publicpage");
  const tr = guestTranslator(locale);
  const scope = brandScope(event.branding);
  const reg = event.registration;
  const day = (d: Date) => formatWeekdayDate(d, locale, event.timezone);

  const questions: RegistrationQuestion[] = reg.questions.map((q) => ({
    id: q.id,
    field: publicQuestionField(q.id),
    text: q[locale],
    kind: q.kind,
    options: q.options.map((o) => ({ id: o.id, label: o[locale] })),
    required: q.required,
    showIf: q.showIf,
  }));

  const labels: RegistrationLabels = {
    name: t("form.name"),
    email: t("form.email"),
    emailHint: t("form.emailHint"),
    adults: t("form.adults"),
    children: t("form.children"),
    childrenHint: t("form.childrenHint"),
    decrease: t("form.decrease"),
    increase: t("form.increase"),
    optional: t("form.optional"),
    consent: t("form.consent"),
    privacy: t("form.privacy"),
    submit: reg.full ? t("form.submitWaitlist") : t("form.submit"),
    sending: t("form.sending"),
    retryAt: t.raw("form.retryAt") as string,
    registeredEyebrow: t("result.registeredEyebrow"),
    registeredTitle: t("result.registeredTitle"),
    waitlistedEyebrow: t("result.waitlistedEyebrow"),
    waitlistedTitle: t.raw("result.waitlistedTitle") as string,
    waitlistedBody: t("result.waitlistedBody"),
    linkTitle: t("result.linkTitle"),
    linkBody: t("result.linkBody"),
    linkOpen: t("result.linkOpen"),
    linkCopy: t("result.linkCopy"),
    linkCopied: t("result.linkCopied"),
    replayed: t("result.replayed"),
  };

  return (
    <div className={`ed-solo${scope.className ? ` ${scope.className}` : ""}`} style={scope.style} lang={locale}>
      <header className={`ed-solo__head ${styles.head}`}>
        <Seal size={32} />
        <nav className="ed-langswitch" aria-label={tr("common.languages.switchTo")}>
          <a href={publicHref(slug, "ro")} aria-current={locale === "ro" ? "true" : undefined} lang="ro" title="Română">
            RO
          </a>
          <a href={publicHref(slug, "en")} aria-current={locale === "en" ? "true" : undefined} lang="en" title="English">
            EN
          </a>
        </nav>
      </header>

      <main className="ed-solo__main" id="main">
        <IncidentBanner />
        {event.branding ? <BrandBlock branding={event.branding} label={t("public.organisedBy")} /> : null}

        {event.status === "cancelled" ? (
          <Notice tone="attention" title={t("public.cancelledTitle")}>
            {t("public.cancelledBody")}
          </Notice>
        ) : null}
        {event.status === "postponed" ? (
          <Notice tone="attention" title={t("public.postponedTitle")}>
            {t("public.postponedBody")}
          </Notice>
        ) : null}

        <Invitation kicker={t("public.kicker")} title={event.title[locale]} meta={whenLine(event, locale, t("public.dateUndecided"))}>
          {event.venue ? <VenueLines name={event.venue.name} address={event.venue.address} href={event.venue.navigationHref} locale={locale} /> : null}
        </Invitation>

        {event.description[locale] ? <p className={styles.prose}>{event.description[locale]}</p> : null}

        {event.programme ? (
          <EventBlock title={t("public.programme")}>
            <ProgrammeList items={event.programme} locale={locale} />
          </EventBlock>
        ) : null}

        {event.menus ? (
          <EventBlock title={t("public.menu")}>
            <MenuCard menus={event.menus} locale={locale} />
          </EventBlock>
        ) : null}

        {event.journey ? (
          <EventBlock title={tr("guestevent.journey.title")} intro={tr("guestevent.journey.intro")}>
            <JourneyFacts journey={event.journey} locale={locale} />
          </EventBlock>
        ) : null}

        {reg.window !== "off" ? (
          <EventBlock title={t("form.title")} id="inregistrare">
            {reg.window === "notYet" && reg.opensAt ? <Notice>{t("form.notYet", { date: day(reg.opensAt) })}</Notice> : null}
            {reg.window === "closed" ? <Notice>{t("form.closed")}</Notice> : null}
            {reg.window === "open" ? (
              <>
                <p className="ed-muted">{t("form.intro")}</p>
                {reg.full ? <Notice tone="attention">{t("form.fullNote")}</Notice> : null}
                {reg.closesAt ? <p className="ed-small ed-muted">{t("form.closesOn", { date: day(new Date(reg.closesAt.getTime() - 1000)) })}</p> : null}
                <RegistrationForm
                  guard={{ hidden: { slug, lang: locale }, stamp: issueFormStamp(ctx.now), stampField: FORM_STAMP_FIELD, honeypotField: HONEYPOT_FIELD, honeypotLabel: t("form.honeypot") }}
                  lang={locale}
                  idempotencyKey={`reg_${newId()}`}
                  questions={questions}
                  privacyUrl={reg.privacyUrl[locale]}
                  maxAdults={REGISTRATION_MAX_ADULTS}
                  maxChildren={REGISTRATION_MAX_CHILDREN}
                  labels={labels}
                />
              </>
            ) : null}
          </EventBlock>
        ) : null}
      </main>

      <footer className="ed-solo__foot">
        <p>{t("public.foot")}</p>
        <HelpFootLink section="invited" />
      </footer>
    </div>
  );
}
