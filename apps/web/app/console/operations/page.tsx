import { getSignInLimits, SIGN_IN_LIMIT_DEFAULTS } from "@ed/core/ratelimit";
import { formatDateTime, formatInteger } from "@ed/i18n/format";
import { BACKUP_JOB, listJobRuns, readQueueMetrics, RESTORE_TEST_JOB } from "@ed/jobs";
import { DescriptionList, EmptyState, Notice, Page, PageHeader, Section, SheetTrigger, Table, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requestSignInLimits } from "@/app/actions/console";
import { NoRole } from "../_components/NoRole";
import { SpecForm } from "../_components/SpecForm";
import { requireConsole } from "../_lib";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("console.ops"))("title") };
}

type Run = Awaited<ReturnType<typeof listJobRuns>>[number];

/** Backups, restore tests, queue health and the sign-in rate limits (LAU5, INF10, SEC16). */
export default async function OperationsPage() {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("console");
  if (!has("security_administrator", "platform_admin")) {
    return <NoRole title={t("ops.title")} roles={["security_administrator", "platform_admin"]} />;
  }
  const [queue, backups, restores, limits] = await Promise.all([
    readQueueMetrics(ctx),
    listJobRuns(ctx, BACKUP_JOB, 10),
    listJobRuns(ctx, RESTORE_TEST_JOB, 6),
    getSignInLimits(ctx),
  ]);
  const n = (value: number) => formatInteger(value, ctx.locale);
  const limitKeys = Object.keys(SIGN_IN_LIMIT_DEFAULTS) as Array<keyof typeof SIGN_IN_LIMIT_DEFAULTS>;

  const runsTable = (caption: string, runs: Run[]) =>
    runs.length === 0 ? (
      <EmptyState title={t("ops.runs.none")}>{t("ops.runs.noneBody")}</EmptyState>
    ) : (
      <Table caption={caption}>
        <thead>
          <tr>
            <th scope="col">{t("ops.runs.started")}</th>
            <th scope="col">{t("ops.runs.finished")}</th>
            <th scope="col">{t("ops.runs.status")}</th>
            <th scope="col">{t("ops.runs.detail")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="ed-num">{formatDateTime(run.startedAt, ctx.locale)}</td>
              <td className="ed-num">{formatDateTime(run.finishedAt, ctx.locale)}</td>
              <td>
                <Tag tone={run.status === "ok" ? "success" : run.status === "failed" ? "danger" : "neutral"}>{t(`ops.runs.statuses.${run.status}`)}</Tag>
              </td>
              <td className="ed-small">
                {run.detail
                  ? Object.entries(run.detail as Record<string, unknown>)
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(" · ")
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    );

  return (
    <Page>
      <PageHeader title={t("ops.title")} description={t("ops.description")} />

      <Section title={t("ops.queue.title")}>
        {queue ? (
          <>
            {queue.alerts.length > 0 ? (
              <Notice tone="danger" title={t("ops.queue.alertTitle")}>
                {queue.alerts.map((a) => t(`ops.queue.alert.${a}`)).join(" · ")}
              </Notice>
            ) : null}
            <DescriptionList
              cols={3}
              items={[
                { term: t("ops.queue.depth"), value: <span className="ed-num">{n(queue.depth)}</span> },
                { term: t("ops.queue.running"), value: <span className="ed-num">{n(queue.running)}</span> },
                { term: t("ops.queue.scheduled"), value: <span className="ed-num">{n(queue.scheduled)}</span> },
                { term: t("ops.queue.dead"), value: <span className="ed-num">{n(queue.dead)}</span> },
                { term: t("ops.queue.oldest"), value: <span className="ed-num">{t("ops.queue.seconds", { count: n(queue.oldestDueSeconds) })}</span> },
                { term: t("ops.queue.doneLastHour"), value: <span className="ed-num">{n(queue.doneLastHour)}</span> },
                { term: t("ops.queue.failedLastHour"), value: <span className="ed-num">{n(queue.failedLastHour)}</span> },
                { term: t("ops.queue.errorRate"), value: <span className="ed-num">{`${Math.round(queue.errorRate * 100)}%`}</span> },
                { term: t("ops.queue.snapshot"), value: formatDateTime(new Date(queue.at), ctx.locale) },
              ]}
            />
          </>
        ) : (
          <EmptyState title={t("ops.queue.none")}>{t("ops.queue.noneBody")}</EmptyState>
        )}
      </Section>

      <Section title={t("ops.backups")}>{runsTable(t("ops.backups"), backups)}</Section>
      <Section title={t("ops.restoreTests")}>{runsTable(t("ops.restoreTests"), restores)}</Section>

      <Section
        title={t("ops.limits.title")}
        actions={
          has("security_administrator") ? (
            <SheetTrigger label={t("ops.limits.change")} title={t("ops.limits.changeTitle")} closeLabel={t("close")}>
              <SpecForm
                action={requestSignInLimits}
                refreshOnSuccess
                block
                success={
                  <>
                    {t("ops.limits.requested")} <Link href="/console/approvals">{t("access.requestedLink")}</Link>
                  </>
                }
                fields={[
                  ...limitKeys.map((k) => ({
                    kind: "number" as const,
                    name: k,
                    label: t(`ops.limits.keys.${k}`),
                    hint: t("ops.limits.defaultHint", { value: SIGN_IN_LIMIT_DEFAULTS[k] }),
                    defaultValue: String(limits[k]),
                    required: true,
                  })),
                  { kind: "textarea" as const, name: "reason", label: t("access.reason"), hint: t("ops.limits.reasonHint"), required: true, maxLength: 1000, rows: 3 },
                ]}
                submitLabel={t("access.submit")}
                pendingLabel={t("access.submitting")}
              />
            </SheetTrigger>
          ) : null
        }
      >
        <p className="ed-small ed-muted">{t("ops.limits.body")}</p>
        <Table caption={t("ops.limits.title")}>
          <thead>
            <tr>
              <th scope="col">{t("ops.limits.limit")}</th>
              <th scope="col" data-num>
                {t("ops.limits.current")}
              </th>
              <th scope="col" data-num>
                {t("ops.limits.default")}
              </th>
            </tr>
          </thead>
          <tbody>
            {limitKeys.map((k) => (
              <tr key={k}>
                <td>{t(`ops.limits.keys.${k}`)}</td>
                <td data-num>
                  {n(limits[k])}
                  {limits[k] !== SIGN_IN_LIMIT_DEFAULTS[k] ? <span className="ed-small ed-muted"> · {t("ops.limits.changed")}</span> : null}
                </td>
                <td data-num>{n(SIGN_IN_LIMIT_DEFAULTS[k])}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </Page>
  );
}
