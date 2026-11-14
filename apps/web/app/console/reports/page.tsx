import { countContentReports, listContentReports, type ContentReportState } from "@ed/core/reports";
import { formatDateTime, formatInteger } from "@ed/i18n/format";
import { buttonClassName, EmptyState, Notice, Page, PageHeader, Table, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { NoRole } from "../_components/NoRole";
import { requireConsole } from "../_lib";
import styles from "../console.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("console.reports"))("title") };
}

const TABS = ["open", "actioned", "dismissed"] as const;
const reportTone = (s: ContentReportState) => (s === "actioned" ? "danger" : s === "dismissed" ? "neutral" : s === "reviewing" ? "accent" : "attention");

/** LAU8: reports of illegal content or unlawful listings, waiting for a decision. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ state?: string; decided?: string }> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("console");
  if (!has("listing_moderator", "platform_admin")) {
    return <NoRole title={t("reports.title")} roles={["listing_moderator", "platform_admin"]} />;
  }
  const sp = await searchParams;
  const state = (TABS as readonly string[]).includes(sp.state ?? "") ? (sp.state as (typeof TABS)[number]) : "open";
  const [reports, counts] = await Promise.all([listContentReports(ctx, { state }), countContentReports(ctx)]);
  const tabCount = { open: counts.received + counts.reviewing, actioned: counts.actioned, dismissed: counts.dismissed };

  return (
    <Page>
      <PageHeader title={t("reports.title")} description={t("reports.description")} />
      {sp.decided ? <Notice tone="success" title={t("reports.decidedNotice")} /> : null}
      <nav aria-label={t("reports.filterLabel")}>
        <ul className="ed-tabs">
          {TABS.map((tab) => (
            <li key={tab}>
              <Link className="ed-tab" href={tab === "open" ? "/console/reports" : `/console/reports?state=${tab}`} aria-current={tab === state ? "page" : undefined}>
                {t(`reports.tabs.${tab}`)} <span className="ed-num">({formatInteger(tabCount[tab], ctx.locale)})</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {reports.length === 0 ? (
        <EmptyState title={t(`reports.empty.${state}`)}>{state === "open" ? t("reports.emptyBody") : null}</EmptyState>
      ) : (
        <Table caption={t("reports.title")}>
          <thead>
            <tr>
              <th scope="col">{t("reports.reference")}</th>
              <th scope="col">{t("reports.received")}</th>
              <th scope="col">{t("reports.target")}</th>
              <th scope="col">{t("reports.category")}</th>
              <th scope="col">{t("reports.state")}</th>
              <th scope="col">
                <span className="ed-vh">{t("reports.open")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td className={styles.nowrap}>{r.reference}</td>
                <td className="ed-num">{formatDateTime(r.createdAt, ctx.locale)}</td>
                <td className={styles.cell}>{r.targetRef}</td>
                <td>{t(`reports.categories.${r.reasonCategory}`)}</td>
                <td>
                  <Tag tone={reportTone(r.state)}>{t(`reports.states.${r.state}`)}</Tag>
                </td>
                <td>
                  <Link href={`/console/reports/${r.id}`} className={buttonClassName({ size: "sm" })} aria-label={t("reports.openNamed", { reference: r.reference })}>
                    {t("reports.open")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Page>
  );
}
