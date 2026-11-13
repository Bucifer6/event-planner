import { getBusinessView } from "@ed/core/business";
import { listBusinessEnquiries } from "@ed/core/enquiries";
import { formatDate } from "@ed/i18n/format";
import { buttonClassName, EmptyState, List, Section } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import styles from "@/app/(app)/occasions/[id]/suppliers/enquiries/_components/enquiries.module.css";
import { StateTag, statusLine } from "@/app/(app)/occasions/[id]/suppliers/enquiries/_components/Thread";
import { requireCtx } from "@/lib/ctx";
import { waitingText } from "./_wait";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("enquiries"))("inbox.title") };
}

const TABS = ["open", "closed"] as const;

/**
 * The business's inbox (P8–P12): enquiries and quote requests from planners, the ones that
 * wait longest first, each with its state and waiting time. Any active member may answer.
 * Only what the planner chose to send is ever shown (D3).
 */
export default async function BusinessEnquiriesPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ state?: string }> }) {
  const [{ businessId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("enquiries");
  const tt = (k: string, p?: Record<string, string | number>) => t(k as never, p as never);
  const state = (TABS as readonly string[]).includes(sp.state ?? "") ? (sp.state as (typeof TABS)[number]) : "open";
  const [view, threads] = await Promise.all([orNotFound(getBusinessView(ctx, businessId)), orNotFound(listBusinessEnquiries(ctx, businessId, { state }))]);
  const base = `/business/${businessId}`;

  return (
    <Section title={t("inbox.title")} level={2}>
      <p className="ed-muted">{t("inbox.description")}</p>
      <nav aria-label={t("inbox.tabsLabel")}>
        <ul className="ed-tabs">
          {TABS.map((tab) => (
            <li key={tab}>
              <Link className="ed-tab" href={tab === "open" ? `${base}/enquiries` : `${base}/enquiries?state=${tab}`} aria-current={tab === state ? "page" : undefined}>
                {t(`inbox.tabs.${tab}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {threads.length === 0 ? (
        state === "open" ? (
          <EmptyState
            title={t("inbox.emptyOpenTitle")}
            action={
              <Link href={base} className={buttonClassName({ variant: "secondary" })}>
                {t("inbox.emptyOpenAction")}
              </Link>
            }
          >
            {t("inbox.emptyOpenBody")}
          </EmptyState>
        ) : (
          <EmptyState title={t("inbox.emptyClosedTitle")} />
        )
      ) : (
        <List>
          {threads.map((th) => (
            <li key={th.id} className="ed-row">
              <Link href={`${base}/enquiries/${th.id}`} className={styles.rowLink} aria-label={t("inbox.openNamed", { date: formatDate(th.sentAt, ctx.locale) })}>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {t(`kinds.${th.kind}`)} {t("inbox.for", { listing: th.listingName })}
                  </span>
                  <span className={styles.rowMeta}>{statusLine(tt, th, ctx.locale, "business")}</span>
                </span>
                <span className={styles.rowEnd}>
                  <StateTag t={tt} state={th.state} viewer="business" />
                  {th.waitingMinutes !== null ? <span className={`${styles.rowMeta} ed-num`}>{t("inbox.waiting", { time: waitingText(tt, th.waitingMinutes) })}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </List>
      )}

      <p className="ed-small ed-muted">
        {view.business.nudge48h ? t("inbox.nudgeOn") : t("inbox.nudgeOff")} <Link href={`${base}/settings`}>{t("inbox.nudgeSettings")}</Link>
      </p>
    </Section>
  );
}
