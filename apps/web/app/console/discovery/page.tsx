import "@ed/core/listings"; // registers the "listing" moderation kind used on approval
import { listClaims } from "@ed/core/claims";
import { countDiscoveryDrafts, listDiscoveryDrafts, listDiscoveryRuns, listDiscoverySources, listObjections, type DiscoveryDraftState } from "@ed/core/discovery";
import { formatDate, formatDateTime, formatInteger } from "@ed/i18n/format";
import { buttonClassName, EmptyState, ExternalLink, Figure, Figures, Notice, Page, PageHeader, Table, Tag } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { decideObjectionAction, rejectClaimAction, runSourceAction, setSourceEnabledAction, submitClaimAction } from "@/app/actions/discovery";
import { NoRole } from "../_components/NoRole";
import { SpecForm } from "../_components/SpecForm";
import { requireConsole } from "../_lib";
import { DraftBatchForm, type DraftRowView } from "./_components/DraftBatchForm";
import styles from "./discovery.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("discovery"))("title") };
}

const TABS = ["sources", "drafts", "runs", "objections", "claims"] as const;
type Tab = (typeof TABS)[number];
const DRAFT_STATES: DiscoveryDraftState[] = ["pending", "duplicate_review", "approved", "rejected"];
type SP = { tab?: string; state?: string; done?: string; created?: string };

/**
 * W5: discovery management — run, pause and configure sources (BD7), review the drafts they
 * produce in batches with one recorded reason, read the run log, handle removal requests
 * and objections (BD6) and send verified claims to the approvals queue (P30).
 */
export default async function DiscoveryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("discovery");
  if (!has("listing_moderator", "platform_admin")) return <NoRole title={t("title")} roles={["listing_moderator", "platform_admin"]} />;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "sources";
  const href = (next: Tab, extra = "") => (next === "sources" && !extra ? "/console/discovery" : `/console/discovery?tab=${next}${extra}`);
  const [counts, openObjections, openClaims] = await Promise.all([countDiscoveryDrafts(ctx), listObjections(ctx, { state: "open" }), listClaims(ctx, { state: "open" })]);
  const overdue = openObjections.filter((o) => o.overdue).length;
  const waitingClaims = openClaims.filter((c) => c.claim.state !== "code_sent");

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      {sp.created ? <Notice tone="success" title={t("sourceForm.created")} /> : null}
      {sp.done && ["approve", "reject", "discard"].includes(sp.done) ? <Notice tone="success" title={t(`drafts.done.${sp.done as "approve" | "reject" | "discard"}`)} /> : null}

      <Figures>
        <Figure label={t("figures.pending")} value={formatInteger(counts.pending, ctx.locale)} note={t("figures.now")} />
        <Figure label={t("figures.duplicates")} value={formatInteger(counts.duplicate_review, ctx.locale)} note={t("figures.now")} />
        <Figure
          label={t("figures.objections")}
          value={formatInteger(openObjections.length, ctx.locale)}
          note={overdue > 0 ? t("figures.overdue", { n: overdue }) : t("figures.onTime")}
          noteTone={overdue > 0 ? "danger" : undefined}
        />
        <Figure label={t("figures.claims")} value={formatInteger(waitingClaims.length, ctx.locale)} note={t("figures.now")} />
      </Figures>

      <nav aria-label={t("tabsLabel")}>
        <ul className="ed-tabs">
          {TABS.map((x) => (
            <li key={x}>
              <Link className="ed-tab" href={href(x)} aria-current={x === tab ? "page" : undefined}>
                {t(`tabs.${x}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "sources" ? <Sources /> : null}
      {tab === "drafts" ? <Drafts state={sp.state} canApprove={has("listing_moderator")} /> : null}
      {tab === "runs" ? <Runs /> : null}
      {tab === "objections" ? <Objections state={sp.state} /> : null}
      {tab === "claims" ? <Claims state={sp.state} /> : null}
    </Page>
  );
}

async function Sources() {
  const { ctx } = await requireConsole();
  const t = await getTranslations("discovery");
  const rows = await listDiscoverySources(ctx);
  const add = (
    <Link href="/console/discovery/sources/new" className={buttonClassName({ variant: "primary" })}>
      <IconPlus size={18} />
      {rows.length === 0 ? t("sources.addFirst") : t("sources.add")}
    </Link>
  );
  if (rows.length === 0) {
    return (
      <EmptyState title={t("sources.emptyTitle")} action={add}>
        {t("sources.emptyBody")}
      </EmptyState>
    );
  }
  return (
    <section className={`ed-section ${styles.rel}`}>
      <div className="ed-section__head">
        <h2>{t("tabs.sources")}</h2>
        <div className="ed-cluster">{add}</div>
      </div>
      {rows.map(({ source, lastRun, pendingDrafts }) => (
        <div key={source.id} className={styles.block}>
          <div className={styles.blockHead}>
            <span className={styles.blockTitle}>{source.name}</span>
            <Tag tone={source.enabled ? "success" : "neutral"}>{source.enabled ? t("sources.enabled") : t("sources.paused")}</Tag>
          </div>
          <span className={styles.small}>
            {t(`kinds.${source.kind}`)} · {t("sources.rate", { n: source.rateLimitPerHour })} · {source.termsReference}
          </span>
          <span className={styles.small}>
            {t("sources.cols.lastRun")}:{" "}
            {lastRun
              ? t("sources.lastRunSummary", { date: formatDateTime(lastRun.startedAt, ctx.locale), seen: lastRun.itemsSeen, drafts: lastRun.draftsCreated, duplicates: lastRun.duplicatesQueued })
              : t("sources.neverRun")}
            {pendingDrafts > 0 ? ` · ${t("sources.pendingDrafts", { n: pendingDrafts })}` : ""}
          </span>
          <div className={styles.forms}>
            {source.enabled ? (
              <>
                <SpecForm action={runSourceAction} hidden={{ sourceId: source.id }} fields={[]} submitLabel={t("sources.run")} pendingLabel={t("sources.running")} variant="secondary" success={t("sources.queued")} refreshOnSuccess />
                <SpecForm action={setSourceEnabledAction} hidden={{ id: source.id, enabled: "false" }} fields={[]} submitLabel={t("sources.pause")} pendingLabel={t("sources.switching")} variant="danger-quiet" refreshOnSuccess />
              </>
            ) : (
              <SpecForm action={setSourceEnabledAction} hidden={{ id: source.id, enabled: "true" }} fields={[]} submitLabel={t("sources.enable")} pendingLabel={t("sources.switching")} variant="secondary" refreshOnSuccess />
            )}
            <Link href={`/console/discovery/sources/${source.id}`} className={buttonClassName({ variant: "quiet" })} aria-label={t("sources.editNamed", { name: source.name })}>
              {t("sources.edit")}
            </Link>
          </div>
        </div>
      ))}
    </section>
  );
}

async function Drafts({ state: raw, canApprove }: { state?: string; canApprove: boolean }) {
  const { ctx } = await requireConsole();
  const t = await getTranslations("discovery");
  const state = (DRAFT_STATES as string[]).includes(raw ?? "") ? (raw as DiscoveryDraftState) : "pending";
  const rows = await listDiscoveryDrafts(ctx, { state });
  const open = state === "pending" || state === "duplicate_review";
  const views: DraftRowView[] = rows.map((r) => ({
    id: r.draft.id,
    name: r.draft.name,
    category: r.categoryName,
    categoryText: r.draft.categoryGuessText,
    area: r.localityName ? [r.localityName, r.countyName].filter(Boolean).join(", ") : null,
    areaText: r.draft.areaText,
    contact: r.draft.publicContactRoute,
    hasEmail: !!r.draft.publicEmail,
    sourceName: r.sourceName,
    sourceUrl: r.draft.sourceUrl,
    collected: formatDate(r.draft.collectedAt, ctx.locale),
    duplicate: r.duplicateOf ? { kind: r.duplicateOf.kind, name: r.duplicateOf.name } : null,
    approvable: r.approvable,
  }));
  return (
    <section className="ed-section">
      <nav aria-label={t("drafts.filterLabel")}>
        <ul className={styles.subtabs}>
          {DRAFT_STATES.map((s) => (
            <li key={s}>
              <Link href={`/console/discovery?tab=drafts&state=${s}`} aria-current={s === state ? "page" : undefined}>
                {t(`drafts.states.${s}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {rows.length === 0 ? (
        <EmptyState
          title={t("drafts.emptyTitle")}
          action={
            <Link href="/console/discovery" className={buttonClassName({ variant: "secondary" })}>
              {t("drafts.emptyAction")}
            </Link>
          }
        >
          {t("drafts.emptyBody")}
        </EmptyState>
      ) : open ? (
        <DraftBatchForm rows={views} state={state} canApprove={canApprove} />
      ) : (
        <div className={styles.rel}>
          <Table caption={t("tabs.drafts")}>
            <thead>
              <tr>
                <th scope="col">{t("drafts.cols.name")}</th>
                <th scope="col">{t("drafts.cols.category")}</th>
                <th scope="col">{t("drafts.cols.area")}</th>
                <th scope="col">{t("drafts.cols.source")}</th>
                <th scope="col">{t("drafts.states." + state)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.draft.id}>
                  <td className={styles.subject}>
                    <strong>{r.draft.name}</strong>
                  </td>
                  <td className={styles.narrowCell}>{r.categoryName ?? r.draft.categoryGuessText ?? "—"}</td>
                  <td className={styles.narrowCell}>{r.localityName ?? r.draft.areaText ?? "—"}</td>
                  <td className={styles.narrowCell}>{r.sourceName}</td>
                  <td className={styles.narrowCell}>
                    <span className="ed-num">{r.draft.decidedAt ? t("drafts.decidedOn", { date: formatDate(r.draft.decidedAt, ctx.locale) }) : ""}</span>
                    {r.draft.listingId ? (
                      <Link href={`/directory/listing/${r.draft.listingId}`} className={styles.small}>
                        {t("drafts.listing")}
                      </Link>
                    ) : null}
                    {state === "approved" ? (
                      <span className={styles.small}>{r.draft.invitationSentAt ? t("drafts.invited", { date: formatDate(r.draft.invitationSentAt, ctx.locale) }) : r.draft.publicEmail ? "" : t("drafts.notInvited")}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </section>
  );
}

async function Runs() {
  const { ctx } = await requireConsole();
  const t = await getTranslations("discovery");
  const runs = await listDiscoveryRuns(ctx, { limit: 100 });
  if (runs.length === 0) return <EmptyState title={t("runs.emptyTitle")}>{t("runs.emptyBody")}</EmptyState>;
  return (
    <section className={`ed-section ${styles.rel}`}>
      <Table caption={t("tabs.runs")}>
        <thead>
          <tr>
            <th scope="col">{t("runs.cols.started")}</th>
            <th scope="col">{t("runs.cols.source")}</th>
            <th scope="col">{t("runs.cols.seen")}</th>
            <th scope="col">{t("runs.cols.drafts")}</th>
            <th scope="col">{t("runs.cols.duplicates")}</th>
            <th scope="col">{t("runs.cols.skipped")}</th>
            <th scope="col">{t("runs.cols.outcome")}</th>
            <th scope="col">{t("runs.cols.by")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="ed-num">{formatDateTime(r.startedAt, ctx.locale)}</td>
              <td className={styles.narrowCell}>{r.sourceName}</td>
              <td className="ed-num">{formatInteger(r.itemsSeen, ctx.locale)}</td>
              <td className="ed-num">{formatInteger(r.draftsCreated, ctx.locale)}</td>
              <td className="ed-num">{formatInteger(r.duplicatesQueued, ctx.locale)}</td>
              <td className="ed-num">{formatInteger(r.skipped, ctx.locale)}</td>
              <td className={styles.narrowCell}>
                {r.stoppedReason === "kill_switch" || r.stoppedReason === "rate_limit" ? (
                  <Tag tone="attention">{t(`runs.stopped.${r.stoppedReason}`)}</Tag>
                ) : (
                  <Tag tone={r.finishedAt ? "neutral" : "accent"}>{r.finishedAt ? t("runs.finished") : t("runs.running")}</Tag>
                )}
                {r.errors.length > 0 ? (
                  <details className={styles.details}>
                    <summary>{t("runs.errors", { n: r.errors.length })}</summary>
                    <ul className="ed-small">
                      {r.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </td>
              <td>{r.triggeredBy.startsWith("staff:") ? t("runs.staff") : t("runs.schedule")}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

async function Objections({ state: raw }: { state?: string }) {
  const { ctx } = await requireConsole();
  const t = await getTranslations("discovery");
  const state = raw === "handled" ? "handled" : "open";
  const rows = await listObjections(ctx, { state });
  return (
    <section className="ed-section">
      <nav aria-label={t("drafts.filterLabel")}>
        <ul className={styles.subtabs}>
          {(["open", "handled"] as const).map((s) => (
            <li key={s}>
              <Link href={`/console/discovery?tab=objections${s === "handled" ? "&state=handled" : ""}`} aria-current={s === state ? "page" : undefined}>
                {t(`objections.tabs.${s}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {rows.length === 0 ? (
        <EmptyState title={state === "open" ? t("objections.emptyTitle") : t("objections.emptyHandled")}>{state === "open" ? t("objections.emptyBody") : null}</EmptyState>
      ) : (
        rows.map((o) => (
          <div key={o.id} className={styles.block}>
            <div className={styles.blockHead}>
              <span className={styles.blockTitle}>{o.listingName}</span>
              {o.state === "received" ? (
                <Tag tone={o.overdue ? "danger" : "attention"}>{o.overdue ? t("objections.overdue") : t("objections.daysLeft", { n: Math.max(0, o.daysLeft) })}</Tag>
              ) : (
                <Tag tone={o.state === "honoured" ? "success" : "neutral"}>{t(`objections.states.${o.state}`)}</Tag>
              )}
            </div>
            <span className={styles.small}>
              {t(`objections.kinds.${o.kind}`)} · {t("objections.received", { date: formatDate(o.receivedAt, ctx.locale) })} · {t("objections.due", { date: formatDate(o.dueAt, ctx.locale) })}
              {o.viaInvitation ? ` · ${t("objections.viaInvitation")}` : ""}
            </span>
            <p className={styles.pre}>{o.message ?? <span className="ed-unknown">{t("objections.noMessage")}</span>}</p>
            {o.contactEmail ? <span className={styles.small}>{t("objections.contact", { email: o.contactEmail })}</span> : null}
            {o.state === "received" ? (
              <SpecForm
                action={decideObjectionAction}
                hidden={{ id: o.id }}
                fields={[
                  { kind: "chips", name: "decision", label: t("objections.decision"), required: true, options: [{ value: "honour", label: t("objections.decisions.honour") }, { value: "decline", label: t("objections.decisions.decline") }] },
                  { kind: "textarea", name: "note", label: t("objections.note"), hint: t("objections.noteHint"), required: true, rows: 3, maxLength: 2000 },
                ]}
                submitLabel={t("objections.submit")}
                pendingLabel={t("objections.submitting")}
                variant="secondary"
                success={t("objections.done")}
                refreshOnSuccess
              >
                <p className="ed-small ed-muted">{t("objections.honourNote")}</p>
              </SpecForm>
            ) : (
              <>
                <span className={styles.small}>{o.handledAt ? t("objections.handled", { date: formatDate(o.handledAt, ctx.locale) }) : ""}</span>
                {o.handlingNote ? <p className={styles.pre}>{o.handlingNote}</p> : null}
              </>
            )}
          </div>
        ))
      )}
    </section>
  );
}

async function Claims({ state: raw }: { state?: string }) {
  const { ctx } = await requireConsole();
  const t = await getTranslations("discovery");
  const state = raw === "decided" ? "decided" : "open";
  const rows = await listClaims(ctx, { state });
  return (
    <section className="ed-section">
      <nav aria-label={t("drafts.filterLabel")}>
        <ul className={styles.subtabs}>
          {(["open", "decided"] as const).map((s) => (
            <li key={s}>
              <Link href={`/console/discovery?tab=claims${s === "decided" ? "&state=decided" : ""}`} aria-current={s === state ? "page" : undefined}>
                {t(`claims.tabs.${s}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {rows.length === 0 ? (
        <EmptyState title={state === "open" ? t("claims.emptyTitle") : t("claims.emptyDecided")}>{state === "open" ? t("claims.emptyBody") : null}</EmptyState>
      ) : (
        rows.map(({ claim, listingName, sourceUrl, publicContactRoute, claimantEmail }) => {
          const ready = claim.state === "verified" || claim.state === "needs_check";
          return (
            <div key={claim.id} className={styles.block}>
              <div className={styles.blockHead}>
                <span className={styles.blockTitle}>{listingName}</span>
                <Tag tone={claim.state === "approved" ? "success" : claim.state === "rejected" ? "danger" : ready ? "attention" : "neutral"}>{t(`claims.states.${claim.state}`)}</Tag>
              </div>
              <span className={styles.small}>
                {t(`claims.methods.${claim.method}`)} · {t("claims.claimant", { email: claimantEmail ?? "—" })} · {t("claims.business", { name: claim.businessName ?? t("claims.existingBusiness") })}
              </span>
              {claim.statement ? <p className={styles.pre}>{t("claims.statement", { text: claim.statement })}</p> : null}
              <span className={styles.small}>
                {publicContactRoute ? t("claims.contactRoute", { route: publicContactRoute }) : ""}
                {sourceUrl && /^https?:\/\//.test(sourceUrl) ? (
                  <>
                    {" · "}
                    <ExternalLink href={sourceUrl}>{t("claims.source")}</ExternalLink>
                  </>
                ) : null}
              </span>
              {claim.checkNote ? <p className={styles.pre}>{t("claims.recorded", { note: claim.checkNote })}</p> : null}
              {claim.state === "in_approval" ? (
                <Notice
                  title={t("claims.inApproval")}
                  actions={
                    <Link href="/console/approvals" className="ed-btn">
                      {t("claims.approvals")}
                    </Link>
                  }
                />
              ) : null}
              {ready ? (
                <>
                  <SpecForm
                    action={submitClaimAction}
                    hidden={{ claimId: claim.id }}
                    fields={[
                      {
                        kind: "textarea",
                        name: "checkNote",
                        label: t("claims.check"),
                        hint: claim.method === "moderator" ? t("claims.checkHint") : t("claims.checkHintCode"),
                        required: claim.method === "moderator",
                        rows: 3,
                        maxLength: 2000,
                      },
                    ]}
                    submitLabel={t("claims.submit")}
                    pendingLabel={t("claims.submitting")}
                    variant="secondary"
                    success={t("claims.submitted")}
                    refreshOnSuccess
                  />
                  <details className={styles.details}>
                    <summary>{t("claims.reject")}</summary>
                    <SpecForm
                      action={rejectClaimAction}
                      hidden={{ claimId: claim.id }}
                      fields={[{ kind: "textarea", name: "reason", label: t("claims.rejectReason"), required: true, rows: 3, maxLength: 1000 }]}
                      submitLabel={t("claims.reject")}
                      pendingLabel={t("claims.rejecting")}
                      variant="danger"
                      success={t("claims.rejected")}
                      refreshOnSuccess
                    />
                  </details>
                </>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}
