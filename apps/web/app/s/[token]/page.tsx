import { BRIEFING_FIELDS } from "@ed/core/briefings";
import { FORM_STAMP_FIELD, HONEYPOT_FIELD, issueFormStamp } from "@ed/core/ratelimit";
import { formatDateTime, formatTime, formatWeekdayDate } from "@ed/i18n/format";
import { DeltaList, ExternalLink, Invitation, Notice, Seal, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { IncidentBanner } from "@/components/incident-banner/IncidentBanner";
import { guestTranslator } from "@/lib/guest";
import { resolveSupplierRequest, SUPPLIER_LANG_PARAM, supplierHref } from "@/lib/supplier-link";
import { AckForm } from "./ack-form";
import styles from "./supplier.module.css";

// The supplier link (B4, S6, SEC2). Public: no account, no cookie. The token opens exactly ONE
// booking — its latest briefing, what changed since the version they acknowledged, the final
// order and their delivery slots — and nothing else of the occasion: no money, no guest list,
// no other supplier. The link's language decides the wording (?lang= switches it).

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const req = await resolveSupplierRequest(token, first(sp[SUPPLIER_LANG_PARAM]), true);
  const base: Metadata = { robots: { index: false, follow: false }, referrer: "same-origin" };
  return req.status === "ok" ? { ...base, title: `${guestTranslator(req.locale, "briefing")("link.metaTitle")} · ${req.view.occasion.title}` } : base;
}

export default async function SupplierLinkPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const req = await resolveSupplierRequest(token, first(sp[SUPPLIER_LANG_PARAM]), true);
  if (req.status === "notFound") notFound();

  if (req.status === "rateLimited") {
    const t = await getTranslations("briefing.throttled");
    return (
      <div className="ed-solo">
        <main className="ed-solo__main" id="main">
          <div className={styles.plain}>
            <Seal size={40} />
            <h1 className={styles.title}>{t("title")}</h1>
            <p className="ed-muted">{req.retryAt ? t("bodyAt", { time: formatTime(new Date(req.retryAt), "ro") }) : t("body")}</p>
          </div>
        </main>
      </div>
    );
  }

  const { view, locale, ctx } = req;
  const t = guestTranslator(locale, "briefing");
  const tr = guestTranslator(locale);
  const tz = view.occasion.timezone;
  const o = view.occasion;

  let when = t("link.dateUndecided");
  if (o.startsAt) {
    const day = formatWeekdayDate(o.startsAt, locale, tz);
    const last = o.endsAt ? formatWeekdayDate(o.endsAt, locale, tz) : day;
    const time = formatTime(o.startsAt, locale, tz);
    when = last !== day ? `${day} – ${last}` : time === "12:00" || time === "00:00" ? day : `${day} · ${time}`;
  }
  const mapsHref = o.venueAddress ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(o.venueAddress)}` : null;
  const briefing = view.briefing;
  const upToDate = !!briefing?.ack;
  const slotText = (from: Date | null, to: Date | null) =>
    from ? `${formatWeekdayDate(from, locale, tz)}, ${formatTime(from, locale, tz)}${to ? `–${formatTime(to, locale, tz)}` : ""}` : t("link.slotUnknown");

  return (
    <div className="ed-solo" lang={locale}>
      <header className={`ed-solo__head ${styles.head}`}>
        <Seal size={32} />
        <nav className="ed-langswitch" aria-label={tr("common.languages.switchTo")}>
          <a href={supplierHref(token, "ro")} aria-current={locale === "ro" ? "true" : undefined} lang="ro" title="Română">
            RO
          </a>
          <a href={supplierHref(token, "en")} aria-current={locale === "en" ? "true" : undefined} lang="en" title="English">
            EN
          </a>
        </nav>
      </header>

      <main className="ed-solo__main" id="main">
        <IncidentBanner />

        {o.status === "cancelled" || view.booking.state === "cancelled" ? (
          <Notice tone="attention" title={t("link.cancelledTitle")}>
            {t("link.cancelledBody")}
          </Notice>
        ) : null}
        {o.status === "postponed" ? (
          <Notice tone="attention" title={t("link.postponedTitle")}>
            {t("link.postponedBody")}
          </Notice>
        ) : null}

        <Invitation kicker={t("link.kicker")} title={o.title} meta={when}>
          {o.venueName || o.venueAddress ? (
            <p className={styles.venue}>
              {o.venueName}
              {o.venueName && o.venueAddress ? <br /> : null}
              {o.venueAddress}
              {mapsHref ? (
                <>
                  <br />
                  <ExternalLink href={mapsHref}>{t("link.map")}</ExternalLink>
                </>
              ) : null}
            </p>
          ) : null}
          <p className={styles.for}>{t("link.for", { name: view.supplier.name })}</p>
        </Invitation>

        <section className={styles.block} aria-labelledby="s-briefing">
          <div className={styles.blockHead}>
            <h2 className={styles.blockTitle} id="s-briefing">
              {t("link.briefingTitle")}
            </h2>
            {briefing ? <Tag tone={upToDate ? "success" : "attention"}>{t("link.version", { version: briefing.version })}</Tag> : null}
          </div>
          {!briefing ? (
            <p className="ed-muted">{t("link.noBriefing")}</p>
          ) : (
            <>
              <p className="ed-small ed-muted">{t("publishedOn", { date: formatDateTime(briefing.createdAt, locale) })}</p>
              {view.changes.length > 0 && view.acknowledged ? (
                <Notice tone="accent" title={t("link.changedTitle", { version: view.acknowledged.version })}>
                  <DeltaList
                    rows={view.changes.map((c) => ({
                      key: c.field,
                      kind: t(`fields.${c.field}`),
                      what: null,
                      before: c.before || t("link.emptyBefore"),
                      after: c.after || t("link.emptyAfter"),
                    }))}
                  />
                </Notice>
              ) : null}
              {BRIEFING_FIELDS.filter((f) => briefing.content[f]).map((f) => (
                <div key={f} className={styles.field}>
                  <span className="ed-label">{t(`fields.${f}`)}</span>
                  <p>{briefing.content[f]}</p>
                </div>
              ))}
            </>
          )}
        </section>

        {view.order ? (
          <section className={styles.block} aria-labelledby="s-order">
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle} id="s-order">
                {t("link.orderTitle")}
              </h2>
              <Tag>{t("link.version", { version: view.order.version })}</Tag>
            </div>
            <p className="ed-small ed-muted">
              {t("link.orderFixed", { date: formatDateTime(view.order.createdAt, locale) })} · {t("link.orderBasedOn", view.order.basedOn)}
            </p>
            <ul className={styles.items}>
              {view.order.items.map((item, i) => (
                <li key={i}>
                  <span>
                    {item.label}
                    {item.note ? <span className="ed-small ed-muted"> · {item.note}</span> : null}
                  </span>
                  <span className={styles.qty}>
                    {item.quantity}
                    {item.unit ? ` ${item.unit}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {view.deliveries.length > 0 ? (
          <section className={styles.block} aria-labelledby="s-deliveries">
            <h2 className={styles.blockTitle} id="s-deliveries">
              {t("link.deliveriesTitle")}
            </h2>
            <div>
              {view.deliveries.map((d) => (
                <div key={d.id} className={styles.slot}>
                  <span className={styles.slotTitle}>
                    {d.title} <span className="ed-small ed-muted">· {tr(`deliveries.kinds.${d.kind}`)}</span>
                  </span>
                  <span>{slotText(d.expectedFrom, d.expectedTo)}</span>
                  {d.place ? <span className="ed-muted">{d.place}</span> : null}
                  {d.items.length > 0 ? (
                    <span className="ed-small ed-muted">{d.items.map((i) => `${i.expectedQty}${i.unit ? ` ${i.unit}` : ""} × ${i.label}`).join(" · ")}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {briefing ? (
          <section className={styles.block} aria-labelledby="s-ack">
            <h2 className={styles.blockTitle} id="s-ack">
              {t("link.ackTitle")}
            </h2>
            {briefing.ack ? (
              <Notice tone="success" title={t("link.ackDone", { version: briefing.version })} role="status">
                {t("status.ackedBy", { name: briefing.ack.name, date: formatDateTime(briefing.ack.at, locale) })}
              </Notice>
            ) : (
              <>
                <p className="ed-muted">{t("link.ackIntro", { version: briefing.version })}</p>
                <AckForm
                  token={token}
                  lang={locale}
                  versionId={briefing.id}
                  defaultName={view.acknowledged?.name ?? view.supplier.contactName ?? ""}
                  stamp={issueFormStamp(ctx.now)}
                  stampField={FORM_STAMP_FIELD}
                  honeypotField={HONEYPOT_FIELD}
                  labels={{
                    name: t("link.ackName"),
                    nameHint: t("link.ackNameHint"),
                    submit: t("link.ackSubmit"),
                    pending: t("link.ackPending"),
                    honeypot: t("link.honeypot"),
                    retryAt: tr.raw("common.errors.retryAt") as string,
                  }}
                />
              </>
            )}
          </section>
        ) : null}
      </main>
      <footer className="ed-solo__foot">{t("link.footer")}</footer>
    </div>
  );
}
