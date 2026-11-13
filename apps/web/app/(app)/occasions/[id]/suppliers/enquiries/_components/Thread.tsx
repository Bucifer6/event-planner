import type { BudgetBand, EnquirySide, EnquiryState, SharedView, ThreadMessage } from "@ed/core/enquiries";
import { formatDate, formatDateTime } from "@ed/i18n/format";
import { DescriptionList, Tag, Unknown, type Tone } from "@ed/ui";
import { IconDownload } from "@ed/ui/icons";
import type { ReactNode } from "react";
import styles from "./enquiries.module.css";

// The thread as both sides read it: the shared facts, then the letters. Presentational and
// server-safe; the pages pass translated labels. Nothing here knows who the planner is.

type T = (key: string, params?: Record<string, string | number>) => string;
type Locale = "ro" | "en";

export const STATE_TONE: Record<EnquiryState, Tone> = { sent: "neutral", awaiting: "attention", answered: "success", closed: "neutral" };

/** "2027-06-12" → the locale's date. */
export function dayLabel(day: string, locale: Locale): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return formatDate(new Date(Date.UTC(y, m - 1, d, 12)), locale);
}

/**
 * P33: the state in words, with its date. An unanswered enquiry always says when it was
 * sent — a silent business is visible, never a blank.
 */
export function statusLine(
  t: T,
  thread: { state: EnquiryState; sentAt: Date; resentAt: Date | null; lastMessageAt: Date; closedBy: EnquirySide | null; firstAnsweredAt?: Date | null },
  locale: Locale,
  viewer: EnquirySide,
): string {
  const sent = formatDate(thread.sentAt, locale);
  const resent = thread.resentAt ? ` · ${t("status.resentOn", { date: formatDate(thread.resentAt, locale) })}` : "";
  switch (thread.state) {
    case "sent":
      return `${t(viewer === "planner" ? "status.sentNoAnswer" : "status.sentOn", { date: sent })}${resent}`;
    case "awaiting":
      return viewer === "planner" ? t("status.awaiting", { date: formatDate(thread.lastMessageAt, locale) }) : `${t("status.sentOn", { date: sent })}${resent}`;
    case "answered":
      return viewer === "planner" ? t("status.answered", { date: formatDate(thread.lastMessageAt, locale) }) : `${t("status.sentOn", { date: sent })}${resent}`;
    case "closed": {
      const by = thread.closedBy ?? "planner";
      const key = viewer === "planner" ? (by === "planner" ? "status.closedByPlanner" : "status.closedByBusiness") : by === "planner" ? "status.closedByPlannerB" : "status.closedByBusinessB";
      return `${t(key)} · ${t("status.sentOn", { date: sent })}`;
    }
  }
}

export function StateTag({ t, state, viewer }: { t: T; state: EnquiryState; viewer: EnquirySide }) {
  return <Tag tone={STATE_TONE[state]}>{t(`${viewer === "planner" ? "states" : "statesBusiness"}.${state}`)}</Tag>;
}

/** The fields the planner chose to send — the same list on both sides (P8, F5, D3). */
export function SharedFacts({
  t,
  shared,
  kindLabel,
  budgetLabel,
  email,
  locale,
  viewer,
}: {
  t: T;
  shared: SharedView;
  /** Translated occasion kind (plain enquiries). */
  kindLabel?: string;
  budgetLabel?: (band: BudgetBand) => string;
  /** The shared email, or null when the box was not ticked. */
  email: string | null;
  locale: Locale;
  viewer: EnquirySide;
}) {
  const notSet = <Unknown label={t("thread.notSet")} />;
  const notSaid = <Unknown label={t("thread.notSaid")} />;
  const emailValue: ReactNode = email ? <a href={`mailto:${email}`}>{email}</a> : <Unknown label={t(viewer === "planner" ? "thread.emailNotShared" : "thread.emailNotSharedBusiness")} />;
  const common = [
    { term: t("thread.date"), value: shared.date ? <span className="ed-num">{dayLabel(shared.date, locale)}</span> : notSet },
    { term: t("thread.guests"), value: shared.guests !== null ? <span className="ed-num">{shared.guests}</span> : notSaid },
  ];
  if (shared.kind === "quote_request") {
    return (
      <div className={styles.block}>
        <div className={styles.block}>
          <span className="ed-label">{t("thread.arrangement")}</span>
          <p className={styles.pre}>{shared.description}</p>
          {shared.designRef ? <p className="ed-small ed-muted">{t("thread.design", { id: shared.designRef.designId, version: shared.designRef.version })}</p> : null}
          {shared.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived link to a private file
            <img className={styles.sketch} src={shared.imageUrl} alt={t("thread.imageAlt")} loading="lazy" width={360} height={270} />
          ) : null}
        </div>
        <DescriptionList cols={3} items={[...common, { term: t("thread.email"), value: emailValue }]} />
      </div>
    );
  }
  const area = [shared.locality, shared.county].filter(Boolean).join(", ");
  return (
    <DescriptionList
      cols={3}
      items={[
        { term: t("thread.kind"), value: kindLabel ?? shared.occasionKind },
        ...common,
        { term: t("thread.area"), value: area || notSaid },
        { term: t("thread.budget"), value: shared.budgetBand && budgetLabel ? budgetLabel(shared.budgetBand) : notSaid },
        { term: t("thread.email"), value: emailValue },
      ]}
    />
  );
}

/**
 * The letters, oldest first. The other side's words are set in the display serif; your own
 * in the working face. `quoteAction` adds something beside a quote (the planner's "Acceptă").
 */
export function Letters({
  t,
  messages,
  viewer,
  locale,
  limit,
  quoteAction,
}: {
  t: T;
  messages: ThreadMessage[];
  viewer: EnquirySide;
  locale: Locale;
  /** Show only the latest N (the supplier page). */
  limit?: number;
  quoteAction?: (message: ThreadMessage) => ReactNode;
}) {
  const shown = limit ? messages.slice(-limit) : messages;
  if (shown.length === 0) return <p className={`ed-muted ${styles.none}`}>{t("thread.noMessages")}</p>;
  const author = (side: EnquirySide) => (side === viewer ? t(viewer === "planner" ? "thread.you" : "thread.yourBusiness") : t(side === "planner" ? "thread.planner" : "thread.business"));
  return (
    <ol className={styles.letters}>
      {shown.map((m) => (
        <li key={m.id} className={styles.letter} data-side={m.side === viewer ? "own" : "other"}>
          <div className={styles.letterHead}>
            <span className="ed-label">{author(m.side)}</span>
            <time className="ed-label ed-num" dateTime={m.at.toISOString()}>
              {formatDateTime(m.at, locale)}
            </time>
          </div>
          {m.body ? <p className={styles.letterBody}>{m.body}</p> : null}
          {m.quote ? (
            <div className={styles.quote}>
              <a className={styles.quoteLink} href={m.quote.url} download aria-label={t("thread.download", { name: m.quote.name })}>
                <IconDownload size={18} />
                <span>
                  {t("thread.quote")} · {m.quote.name}
                </span>
              </a>
              {quoteAction ? quoteAction(m) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
