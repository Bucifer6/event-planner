import { getDashboard } from "@ed/core/staff";
import { formatDate, formatDateTime, formatInteger } from "@ed/i18n/format";
import { readQueueMetrics } from "@ed/jobs";
import { BarList, buttonClassName, DescriptionList, EmptyState, Figure, Figures, Notice, Page, PageHeader, Section, Table, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireConsole } from "./_lib";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("console.dashboard"))("title") };
}

/** W1: the platform at a glance — counts and broad status only, never planner content. */
export default async function ConsoleDashboardPage() {
  const { ctx } = await requireConsole();
  const t = await getTranslations("console");
  const [dash, queue] = await Promise.all([getDashboard(ctx), readQueueMetrics(ctx)]);
  const n = (value: number) => formatInteger(value, ctx.locale);
  const statusLabel = (key: string) => (t.has(`dashboard.occasionStatus.${key}` as never) ? t(`dashboard.occasionStatus.${key}` as never) : key);

  return (
    <Page>
      <PageHeader
        title={t("dashboard.title")}
        description={t("dashboard.description")}
        actions={
          dash.approvals.pending > 0 ? (
            <Link href="/console/approvals" className={buttonClassName({ variant: "primary" })}>
              {t("dashboard.openApprovals", { count: dash.approvals.pending })}
            </Link>
          ) : null
        }
      />

      {dash.staff.singleOperatorMode ? (
        <Notice tone="attention" title={t("singleOperator.title")}>
          {t("singleOperator.body")}
        </Notice>
      ) : null}
      {dash.incident.active ? (
        <Notice
          tone="danger"
          title={t("dashboard.incidentActive")}
          actions={<Link href="/console/incidents">{t("dashboard.incidentLink")}</Link>}
        >
          {dash.incident.startedAt ? t("dashboard.incidentSince", { time: formatDateTime(new Date(dash.incident.startedAt), ctx.locale) }) : null}
        </Notice>
      ) : null}

      <Section title={t("dashboard.platform")}>
        <Figure
          size="hero"
          label={t("dashboard.accountsLabel", { date: formatDate(ctx.now, ctx.locale) })}
          value={n(dash.accounts.total)}
          note={t("dashboard.accountsNote", {
            email: n(dash.accounts.email),
            anonymous: n(dash.accounts.anonymous),
            deleting: n(dash.accounts.pendingDeletion),
          })}
        />
        <Figures>
          <Figure label={t("dashboard.occasions")} value={n(dash.occasions.total)} note={t("dashboard.totalToDate")} />
          <Figure label={t("dashboard.pendingApprovals")} value={n(dash.approvals.pending)} note={t("dashboard.now")} />
          <Figure label={t("dashboard.activeStaff")} value={n(dash.staff.active)} note={t("dashboard.now")} />
          {dash.extra.map((c) => (
            <Figure
              key={c.key}
              label={t.has(`dashboard.counters.${c.key}` as never) ? t(`dashboard.counters.${c.key}` as never) : c.key}
              value={n(c.total)}
              note={t("dashboard.totalToDate")}
            />
          ))}
        </Figures>
      </Section>

      <Section title={t("dashboard.occasionsByStatus")}>
        {dash.occasions.total === 0 ? (
          <EmptyState title={t("dashboard.noOccasions")} />
        ) : (
          <BarList
            items={Object.entries(dash.occasions.byStatus).map(([key, value]) => ({
              key,
              label: statusLabel(key),
              value,
              display: n(value),
            }))}
          />
        )}
      </Section>

      <Section title={t("dashboard.queue")}>
        {queue ? (
          <DescriptionList
            cols={3}
            items={[
              { term: t("ops.queue.depth"), value: <span className="ed-num">{n(queue.depth)}</span> },
              { term: t("ops.queue.running"), value: <span className="ed-num">{n(queue.running)}</span> },
              { term: t("ops.queue.dead"), value: <span className="ed-num">{n(queue.dead)}</span> },
              { term: t("ops.queue.failedLastHour"), value: <span className="ed-num">{n(queue.failedLastHour)}</span> },
              {
                term: t("ops.queue.alerts"),
                value: queue.alerts.length === 0 ? <Tag tone="success">{t("ops.queue.noAlerts")}</Tag> : <Tag tone="danger">{queue.alerts.map((a) => t(`ops.queue.alert.${a}`)).join(", ")}</Tag>,
              },
              { term: t("ops.queue.snapshot"), value: formatDateTime(new Date(queue.at), ctx.locale) },
            ]}
          />
        ) : (
          <EmptyState title={t("ops.queue.none")}>{t("ops.queue.noneBody")}</EmptyState>
        )}
      </Section>

      <Section title={t("dashboard.recentRuns")}>
        {dash.recentJobRuns.length === 0 ? (
          <EmptyState title={t("ops.runs.none")}>{t("ops.runs.noneBody")}</EmptyState>
        ) : (
          <Table caption={t("dashboard.recentRuns")}>
            <thead>
              <tr>
                <th scope="col">{t("ops.runs.job")}</th>
                <th scope="col">{t("ops.runs.status")}</th>
                <th scope="col">{t("ops.runs.finished")}</th>
              </tr>
            </thead>
            <tbody>
              {dash.recentJobRuns.map((run, i) => (
                <tr key={`${run.name}-${run.finishedAt}-${i}`}>
                  <td>{run.name}</td>
                  <td>
                    <Tag tone={run.status === "ok" ? "success" : run.status === "failed" ? "danger" : "neutral"}>
                      {t(`ops.runs.statuses.${run.status as "ok" | "failed" | "skipped"}`)}
                    </Tag>
                  </td>
                  <td className="ed-num">{formatDateTime(new Date(run.finishedAt), ctx.locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </Page>
  );
}
