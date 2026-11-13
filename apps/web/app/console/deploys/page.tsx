import { DEPLOY_ROLES, DEPLOY_STALE_MS, getDeployOverview, type DeployView } from "@ed/core/deploys";
import { formatDateTime } from "@ed/i18n/format";
import { Cluster, DescriptionList, EmptyState, Notice, Page, PageHeader, Section, SheetTrigger, Stack, Table, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { abandonDeployAction, emergencyDeployAction, requestDeployAction, rollbackAction } from "@/app/actions/deploys";
import { NoRole } from "../_components/NoRole";
import { SpecForm } from "../_components/SpecForm";
import { requireConsole } from "../_lib";
import styles from "../console.module.css";
import { AutoRefresh } from "./_AutoRefresh";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("deploys"))("title") };
}

type Tone = "success" | "danger" | "attention" | "neutral";
const ciTone = (s: string): Tone => (s === "success" ? "success" : s === "failure" ? "danger" : s === "pending" ? "attention" : "neutral");
const stateTone = (s: string): Tone =>
  s === "succeeded" ? "success" : s === "failed" || s === "rolled_back" ? "danger" : s === "cancelled" ? "neutral" : "attention";
const short = (hash: string) => hash.slice(0, 7);

/** W10: releases, what is live, request / emergency / rollback, live progress and history. */
export default async function DeploysPage({ searchParams }: { searchParams: Promise<{ candidate?: string }> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("deploys");
  const tc = await getTranslations("console");
  if (!has(...DEPLOY_ROLES)) return <NoRole title={t("title")} roles={DEPLOY_ROLES} />;

  const overview = await getDeployOverview(ctx, { candidate: (await searchParams).candidate });
  const { config, live, active, candidate } = overview;
  const when = (d: Date | string | null) => (d ? formatDateTime(new Date(d), ctx.locale) : "—");
  const duration = (ms: number | null) =>
    ms === null ? "—" : t("history.durationValue", { minutes: Math.floor(ms / 60_000), seconds: Math.round((ms % 60_000) / 1000) });
  const has_ = <K extends string>(group: string, key: K) => t.has(`${group}.${key}` as never);
  const eventLabel = (event: string) => (has_("events", event) ? t(`events.${event}` as never) : event);
  const stageLabel = (stage: string | null | undefined) => (stage && has_("stages", stage) ? t(`stages.${stage}` as never) : "—");
  const mismatch = !!live && !!overview.runningVersion && overview.runningVersion !== "dev" && overview.runningVersion !== live.tag;
  const stale = active ? ctx.now.getTime() - Date.parse(active.log.at(-1)?.at ?? active.createdAt.toISOString()) >= DEPLOY_STALE_MS : false;
  const canDeployCandidate = !!candidate && !active && candidate.ciStatus === "success" && live?.tag !== candidate.tag;

  const notes = (d: DeployView) => {
    const parts: string[] = [];
    if (d.reason) parts.push(d.reason);
    if (d.rollbackReason) parts.push(d.rollbackReason);
    if (d.state === "rolled_back" && d.previousTag) parts.push(t("history.rolledBackTo", { tag: d.previousTag }));
    const failure = d.state === "failed" && !d.rollbackReason ? [...d.log].reverse().find((l) => l.note) : undefined;
    if (failure?.note) parts.push(failure.note);
    return parts.length ? parts.join(" · ") : "—";
  };

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />

      {!config.configured ? (
        <Notice tone="attention" title={t("config.title")}>
          <Stack gap={2}>
            <span>{t("config.body")}</span>
            <code>{config.missing.join(", ")}</code>
            <span>{t("config.steps")}</span>
          </Stack>
        </Notice>
      ) : null}
      {config.configured && !config.recordTokenSet ? <Notice tone="attention">{t("config.recordToken")}</Notice> : null}
      {overview.githubUnavailable ? (
        <Notice tone="danger" title={t("config.githubDownTitle")}>
          {t("config.githubDown")}
        </Notice>
      ) : null}

      {active ? (
        <Section title={t("active.title")}>
          <AutoRefresh />
          <Notice tone="attention" title={t("active.body", { tag: active.tag })}>
            {active.state === "approved" ? t("active.waiting") : t("refreshing")}
          </Notice>
          <DescriptionList
            cols={3}
            items={[
              { term: t("history.kind"), value: t(`kinds.${active.kind}`) },
              { term: t("active.stage"), value: active.state === "approved" ? t("states.approved") : stageLabel(active.stage) },
              { term: t("active.started"), value: <span className="ed-num">{when(active.startedAt)}</span> },
              { term: t("history.requester"), value: active.requesterLabel ?? "—" },
              { term: t("history.approver"), value: active.approverLabel ?? t("history.nobody") },
              { term: t("live.hash"), value: <code>{short(active.commitHash)}</code> },
            ]}
          />
          <Table caption={t("active.progress")}>
            <thead>
              <tr>
                <th scope="col">{t("history.when")}</th>
                <th scope="col">{t("active.progress")}</th>
                <th scope="col">{t("history.note")}</th>
              </tr>
            </thead>
            <tbody>
              {active.log.map((entry, i) => (
                <tr key={`${entry.at}-${i}`}>
                  <td className="ed-num">{when(entry.at)}</td>
                  <td>{entry.event === "stage" ? stageLabel(entry.stage) : eventLabel(entry.event)}</td>
                  <td className="ed-small">{entry.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {stale ? (
            <SheetTrigger label={t("active.abandon")} title={t("active.abandonTitle")} closeLabel={tc("close")} variant="danger-quiet">
              <p>{t("active.abandonBody")}</p>
              <SpecForm
                action={abandonDeployAction}
                hidden={{ id: active.id }}
                refreshOnSuccess
                variant="danger"
                block
                success={t("active.abandoned")}
                fields={[{ kind: "textarea", name: "reason", label: t("active.abandonReason"), required: true, maxLength: 1000, rows: 3 }]}
                submitLabel={t("active.abandonSubmit")}
                pendingLabel={t("active.abandoning")}
              />
            </SheetTrigger>
          ) : null}
        </Section>
      ) : null}

      <Section title={t("live.title")}>
        {live ? (
          <>
            {mismatch ? <Notice tone="attention">{t("live.mismatch")}</Notice> : null}
            <DescriptionList
              cols={3}
              items={[
                { term: t("live.tag"), value: <strong>{live.tag}</strong> },
                { term: t("live.hash"), value: <code title={live.commitHash}>{short(live.commitHash)}</code> },
                { term: t("live.at"), value: <span className="ed-num">{when(live.at)}</span> },
                { term: t("live.running"), value: overview.runningVersion ?? <span className="ed-muted">{t("live.runningUnknown")}</span> },
                ...(config.repo ? [{ term: t("config.repo"), value: config.repo }] : []),
              ]}
            />
          </>
        ) : (
          <EmptyState title={t("live.none")}>{t("live.noneBody")}</EmptyState>
        )}
      </Section>

      {overview.pending.length > 0 ? (
        <Section title={t("pending.title")}>
          {overview.singleOperatorMode ? <Notice tone="attention">{t("pending.singleOperator")}</Notice> : null}
          <Stack gap={2}>
            {overview.pending.map((p) => (
              <Cluster key={p.id} justify="between">
                <span>{t("pending.body", { tag: p.tag, who: p.requesterLabel ?? "—" })}</span>
                <Link href="/console/approvals">{t("pending.open")}</Link>
              </Cluster>
            ))}
          </Stack>
        </Section>
      ) : null}

      {config.configured ? (
        <Section title={t("releases.title")}>
          {overview.tags.length === 0 ? (
            overview.githubUnavailable ? null : (
              <EmptyState title={t("releases.none")}>{t("releases.noneBody")}</EmptyState>
            )
          ) : (
            <Table caption={t("releases.title")}>
              <thead>
                <tr>
                  <th scope="col">{t("releases.tag")}</th>
                  <th scope="col">{t("releases.hash")}</th>
                  <th scope="col">{t("releases.ci")}</th>
                  <th scope="col">
                    <span className="ed-vh">{t("releases.view")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.tags.map((tag) => (
                  <tr key={tag.tag}>
                    <td>
                      <strong>{tag.tag}</strong>
                      {tag.live ? <span className="ed-small ed-muted"> · {t("releases.isLive")}</span> : null}
                    </td>
                    <td>
                      <code title={tag.commitHash}>{short(tag.commitHash)}</code>
                    </td>
                    <td>
                      <Tag tone={ciTone(tag.ciStatus)}>{t(`ci.${tag.ciStatus}`)}</Tag>
                    </td>
                    <td className={styles.nowrap}>
                      {candidate?.tag === tag.tag ? (
                        <span className="ed-small ed-muted">{t("releases.viewing")}</span>
                      ) : (
                        <Link href={`/console/deploys?candidate=${encodeURIComponent(tag.tag)}#candidate`}>{t("releases.view")}</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      ) : null}

      {candidate ? (
        <Section
          id="candidate"
          title={t("candidate.title", { tag: candidate.tag })}
          actions={
            has("security_administrator") && !active && live?.tag !== candidate.tag ? (
              <SheetTrigger label={t("emergency.open")} title={t("emergency.title", { tag: candidate.tag })} closeLabel={tc("close")} variant="danger-quiet">
                <Stack gap={3}>
                  <p>{t("emergency.body")}</p>
                  {candidate.ciStatus !== "success" ? <Notice tone="danger">{t("emergency.ciWarning")}</Notice> : null}
                  <SpecForm
                    action={emergencyDeployAction}
                    hidden={{ tag: candidate.tag }}
                    refreshOnSuccess
                    variant="danger"
                    block
                    success={t("emergency.started")}
                    fields={[{ kind: "textarea", name: "reason", label: t("emergency.reason"), hint: t("emergency.reasonHint"), required: true, maxLength: 1000, rows: 3 }]}
                    submitLabel={t("emergency.submit")}
                    pendingLabel={t("emergency.submitting")}
                  />
                </Stack>
              </SheetTrigger>
            ) : null
          }
        >
          <Cluster gap={2}>
            <code title={candidate.commitHash}>{short(candidate.commitHash)}</code>
            <Tag tone={ciTone(candidate.ciStatus)}>{t(`ci.${candidate.ciStatus}`)}</Tag>
          </Cluster>

          {live?.tag === candidate.tag ? (
            <Notice>{t("candidate.isLive")}</Notice>
          ) : candidate.commits === null ? (
            <Notice>{t("candidate.firstDeploy")}</Notice>
          ) : candidate.commits.length === 0 ? (
            <p className="ed-muted">{t("candidate.commitsNone")}</p>
          ) : (
            <>
              <Table caption={t("candidate.commits")}>
                <thead>
                  <tr>
                    <th scope="col">{t("candidate.commit")}</th>
                    <th scope="col">{t("candidate.change")}</th>
                    <th scope="col">{t("candidate.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidate.commits.map((c) => (
                    <tr key={c.hash}>
                      <td>
                        <code title={c.hash}>{short(c.hash)}</code>
                      </td>
                      <td>{c.title}</td>
                      <td className="ed-num">{when(c.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {candidate.total > candidate.commits.length ? (
                <p className="ed-small ed-muted">{t("candidate.more", { shown: candidate.commits.length, total: candidate.total })}</p>
              ) : null}
            </>
          )}

          {candidate.ciStatus !== "success" && live?.tag !== candidate.tag ? <Notice tone="danger">{t("candidate.ciRefused")}</Notice> : null}
          {canDeployCandidate ? (
            <SpecForm
              action={requestDeployAction}
              hidden={{ tag: candidate.tag }}
              refreshOnSuccess
              success={
                <>
                  {t("request.requested")} <Link href="/console/approvals">{t("request.requestedLink")}</Link>
                </>
              }
              fields={[{ kind: "textarea", name: "reason", label: t("request.reason"), hint: t("request.reasonHint"), required: true, maxLength: 1000, rows: 3 }]}
              submitLabel={t("request.submit")}
              pendingLabel={t("request.submitting")}
            />
          ) : null}
        </Section>
      ) : null}

      {config.configured && live ? (
        <Section
          title={t("rollback.title")}
          actions={
            overview.rollbackTarget && !active ? (
              <SheetTrigger
                label={t("rollback.open", { tag: overview.rollbackTarget })}
                title={t("rollback.sheetTitle", { tag: overview.rollbackTarget })}
                closeLabel={tc("close")}
                variant="danger-quiet"
              >
                <Stack gap={3}>
                  <p>{t("rollback.body", { tag: overview.rollbackTarget })}</p>
                  <SpecForm
                    action={rollbackAction}
                    refreshOnSuccess
                    variant="danger"
                    block
                    success={t("rollback.started")}
                    fields={[{ kind: "textarea", name: "reason", label: t("rollback.reason"), hint: t("rollback.reasonHint"), required: true, maxLength: 1000, rows: 3 }]}
                    submitLabel={t("rollback.submit")}
                    pendingLabel={t("rollback.submitting")}
                  />
                </Stack>
              </SheetTrigger>
            ) : null
          }
        >
          <p className="ed-small ed-muted">{overview.rollbackTarget ? t("rollback.body", { tag: overview.rollbackTarget }) : t("rollback.none")}</p>
        </Section>
      ) : null}

      <Section title={t("history.title")}>
        {overview.history.length === 0 ? (
          <EmptyState title={t("history.none")} />
        ) : (
          <Table caption={t("history.title")}>
            <thead>
              <tr>
                <th scope="col">{t("history.when")}</th>
                <th scope="col">{t("history.kind")}</th>
                <th scope="col">{t("history.release")}</th>
                <th scope="col">{t("history.requester")}</th>
                <th scope="col">{t("history.approver")}</th>
                <th scope="col">{t("history.result")}</th>
                <th scope="col" data-num>
                  {t("history.duration")}
                </th>
                <th scope="col">{t("history.note")}</th>
              </tr>
            </thead>
            <tbody>
              {overview.history.map((d) => (
                <tr key={d.id}>
                  <td className="ed-num">{when(d.createdAt)}</td>
                  <td>
                    {t(`kinds.${d.kind}`)}
                    {d.emergency ? (
                      <>
                        {" "}
                        <Tag tone="danger">{t("history.emergency")}</Tag>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <strong>{d.tag}</strong> <code title={d.commitHash}>{short(d.commitHash)}</code>
                    <div className="ed-small ed-muted">{t(`ci.${d.ciStatus}`)}</div>
                  </td>
                  <td className={styles.cell}>{d.requesterLabel ?? "—"}</td>
                  <td className={styles.cell}>{d.approverLabel ?? <span className="ed-muted">{t("history.nobody")}</span>}</td>
                  <td>
                    <Tag tone={stateTone(d.state)}>{t(`states.${d.state}`)}</Tag>
                  </td>
                  <td data-num>{d.finishedAt && d.startedAt ? duration(d.durationMs) : "—"}</td>
                  <td className={`ed-small ${styles.cell}`}>{notes(d)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </Page>
  );
}
