import { DIET_TAGS } from "@ed/core/menus";
import { FORM_STAMP_FIELD, HONEYPOT_FIELD, issueFormStamp } from "@ed/core/ratelimit";
import { getOwnRegistration } from "@ed/core/registrations";
import { getRegistrantRequests } from "@ed/core/requests";
import { formatDate, formatDateTime } from "@ed/i18n/format";
import { isAppError } from "@ed/shared/errors";
import { DescriptionList, Notice, Seal, SheetTrigger } from "@ed/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IncidentBanner } from "@/components/incident-banner/IncidentBanner";
import { guestTranslator } from "@/lib/guest";
import { EventBlock } from "../../../_components/content";
import styles from "../../../_components/event.module.css";
import { CancelRegistrationForm, PrivateRequestForm } from "../../../_components/forms";
import { manageHref, PUBLIC_LANG_PARAM, publicCtx, publicHref, publicLocale } from "../../../_lib/public";

// The registrant's private manage link (C-06, C-07): see the registration, cancel it, send a
// private request. The token in the address is the only credential; an unknown token gets the
// same plain "not found" as an unknown page.

type Props = {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ManageRegistrationPage({ params, searchParams }: Props) {
  const [{ slug, token }, sp] = await Promise.all([params, searchParams]);
  const locale = publicLocale(sp[PUBLIC_LANG_PARAM]);
  const ctx = await publicCtx(locale);
  const t = guestTranslator(locale, "publicpage");
  const tq = guestTranslator(locale, "requests.guest");
  const tr = guestTranslator(locale);

  let own: Awaited<ReturnType<typeof getOwnRegistration>> = null;
  try {
    own = await getOwnRegistration(ctx, { slug, token });
  } catch (e) {
    if (isAppError(e) && e.code === "RATE_LIMITED") {
      return (
        <div className="ed-solo" lang={locale}>
          <main className="ed-solo__main" id="main">
            <div className={styles.plain}>
              <Seal size={40} />
              <h1 className={styles.resultTitle}>{t("public.throttledTitle")}</h1>
              <p className="ed-muted">{t("public.throttledBody")}</p>
            </div>
          </main>
        </div>
      );
    }
    throw e;
  }
  if (!own) notFound();
  const requests = await getRegistrantRequests(ctx, { slug, token });
  const justCancelled = (Array.isArray(sp.cancelled) ? sp.cancelled[0] : sp.cancelled) === "1";
  const guard = { hidden: { slug, token, lang: locale }, stamp: issueFormStamp(ctx.now), stampField: FORM_STAMP_FIELD, honeypotField: HONEYPOT_FIELD, honeypotLabel: tq("honeypot") };

  return (
    <div className="ed-solo" lang={locale}>
      <header className={`ed-solo__head ${styles.head}`}>
        <Seal size={32} />
        <nav className="ed-langswitch" aria-label={tr("common.languages.switchTo")}>
          <a href={manageHref(slug, token, "ro")} aria-current={locale === "ro" ? "true" : undefined} lang="ro" title="Română">
            RO
          </a>
          <a href={manageHref(slug, token, "en")} aria-current={locale === "en" ? "true" : undefined} lang="en" title="English">
            EN
          </a>
        </nav>
      </header>

      <main className="ed-solo__main" id="main">
        <IncidentBanner />
        <div className={styles.result}>
          <p className="ed-label">{t("manage.eyebrow")}</p>
          <h1 className={styles.resultTitle}>{own.eventTitle[locale]}</h1>
          <p className={styles.venueLine}>
            <strong>{own.status === "waitlisted" ? t("manage.status.waitlisted", { n: own.position ?? 1 }) : t(`manage.status.${own.status}`)}</strong>
          </p>
          {own.status === "waitlisted" ? <p className="ed-muted">{t("result.waitlistedBody")}</p> : null}
        </div>

        {justCancelled && own.status === "cancelled" ? (
          <Notice tone="success" role="status">
            {t("manage.cancelled")}
          </Notice>
        ) : null}

        <DescriptionList
          items={[
            { term: t("manage.name"), value: own.name },
            { term: t("manage.party"), value: t("manage.partyValue", { adults: own.adults, children: own.children }) },
            { term: t("manage.since"), value: formatDateTime(own.createdAt, locale) },
          ]}
        />

        <p>
          <a href={publicHref(slug, locale)}>{t("manage.backToEvent")}</a>
        </p>

        {requests && (requests.canSend || requests.sent.length > 0) ? (
          <EventBlock title={tq("title")} intro={tq("intro")}>
            {requests.sent.length > 0 ? (
              <div>
                <p className="ed-small ed-muted">{tq("sentBefore")}</p>
                <ul className={styles.sentList}>
                  {requests.sent.map((s, i) => (
                    <li key={i}>{tq("sentRow", { kind: tr(`requests.kinds.${s.kind}`), date: formatDate(new Date(s.at), locale) })}</li>
                  ))}
                </ul>
                <p className="ed-small ed-muted">{tq("sentNote")}</p>
              </div>
            ) : null}
            {requests.canSend ? (
              <PrivateRequestForm
                mode="registrant"
                guard={guard}
                lang={locale}
                dietTags={DIET_TAGS.map((d) => ({ value: d, label: tr(`menus.diet.${d}`) }))}
                labels={{
                  kind: tq("kind"),
                  kindDietary: tq("kindDietary"),
                  kindAccess: tq("kindAccess"),
                  kindOther: tq("kindOther"),
                  dietTag: tq("dietTag"),
                  dietTagNone: tq("dietTagNone"),
                  body: tq("body"),
                  bodyHint: tq("bodyHint"),
                  optional: tr("common.optional"),
                  childDetailsMessage: tr("rsvp.errors.childDetails"),
                  childWarningTitle: tq("childWarningTitle"),
                  childWarningBody: tq("childWarningBody"),
                  sendAnyway: tq("sendAnyway"),
                  send: tq("send"),
                  sending: tq("sending"),
                  sent: tq("sent"),
                  retryAt: t.raw("form.retryAt") as string,
                }}
              />
            ) : null}
          </EventBlock>
        ) : null}

        {own.canCancel ? (
          <section className={styles.block}>
            <SheetTrigger label={t("manage.cancel")} title={t("manage.cancelTitle")} closeLabel={tr("common.actions.close")} variant="danger-quiet">
              <p>{t("manage.cancelBody")}</p>
              <CancelRegistrationForm
                slug={slug}
                token={token}
                lang={locale}
                doneHref={manageHref(slug, token, locale, { cancelled: "1" })}
                labels={{ submit: t("manage.cancelSubmit"), cancelling: t("manage.cancelling"), retryAt: t.raw("form.retryAt") as string }}
              />
            </SheetTrigger>
          </section>
        ) : null}
      </main>

      <footer className="ed-solo__foot">
        <p>{t("public.foot")}</p>
      </footer>
    </div>
  );
}
