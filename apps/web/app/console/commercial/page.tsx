import { getCommercialOverview, getFreePhaseDashboard } from "@ed/core/billing";
import { listFeaturedSlots } from "@ed/core/featured";
import { listCategories, listCounties } from "@ed/core/geography";
import { getMonetizationConsole, NOTICE_DAYS } from "@ed/core/monetization";
import { formatDate, formatDateTime, formatInteger, formatMoney } from "@ed/i18n/format";
import { DescriptionList, EmptyState, Figure, Figures, Notice, Page, PageHeader, Section, Table, Tag, Unknown } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { recordAcceptanceAction, requestDisableAction, requestEnableAction, requestPriceChangeAction, requestRefundAction, setMonthlyCostAction } from "@/app/actions/billing";
import { createFeaturedSlotAction, endFeaturedSlotAction } from "@/app/actions/featured";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { NoRole } from "../_components/NoRole";
import { SpecForm } from "../_components/SpecForm";
import { requireConsole } from "../_lib";
import { SandboxCheckout } from "./SandboxCheckout";
import styles from "./commercial.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("console.title") };
}

const TABS = ["cost", "switch", "billing", "prices"] as const;
type Tab = (typeof TABS)[number];
const ROLES = ["commercial_manager", "platform_admin"] as const;

/**
 * W6 — Commercial. While monetization is OFF this is the free-phase cost dashboard, the
 * switch with its history, and the test-mode tools behind the billing acceptance (MON4).
 * Nothing is purchasable. Every change that matters (the switch, prices, refunds) is a
 * REQUEST that a second person approves under "Aprobări" (W9).
 */
export default async function ConsoleCommercialPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("billing");
  const c = await getTranslations("common");
  if (!has(...ROLES)) return <NoRole title={t("console.title")} roles={[...ROLES]} />;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "cost";
  const mon = await getMonetizationConsole(ctx);
  const canRequest = has("commercial_manager");
  const n = (v: number) => formatInteger(v, ctx.locale);
  const money = (v: number) => formatMoney(v, "RON", ctx.locale);
  const phaseTone = mon.view.phase === "on" ? "success" : mon.view.phase === "notice" ? "attention" : "neutral";

  let body;
  if (tab === "cost") {
    const d = await getFreePhaseDashboard(ctx);
    body = (
      <>
        <Section title={t("console.cost.title")} level={2}>
          <Figure
            size="hero"
            label={t("console.cost.monthly")}
            value={money(d.monthlyCost.minor)}
            note={d.monthlyCost.placeholder ? t("console.cost.placeholder") : t("console.cost.perMonth")}
            noteTone={d.monthlyCost.placeholder ? "danger" : undefined}
          />
          <Figures>
            <Figure label={t("console.cost.businesses")} value={n(d.businesses)} note={t("console.cost.now")} />
            <Figure label={t("console.cost.listings")} value={n(d.liveListings)} note={t("console.cost.now")} />
            <Figure label={t("console.cost.enquiries")} value={d.enquiries30 === null ? <Unknown label={c("unknown")} /> : n(d.enquiries30)} note={t("console.cost.last30")} />
            <Figure label={t("console.cost.income")} value={money(0)} note={mon.view.phase === "on" ? t("console.cost.incomeOn") : t("console.cost.incomeOff")} />
          </Figures>
          <p className="ed-muted">{t(d.pricesConfirmed ? "console.cost.breakEven" : "console.cost.breakEvenPlaceholder", { plans: n(d.breakEvenPlans) })}</p>
        </Section>
        <Section title={t("console.cost.setTitle")} level={2}>
          <div className={styles.narrow}>
            <SpecForm
              action={setMonthlyCostAction}
              fields={[{ kind: "number", name: "amount", label: t("console.cost.amount"), hint: t("console.cost.amountHint"), required: true, maxLength: 12, defaultValue: d.monthlyCost.placeholder ? "" : String(d.monthlyCost.minor / 100) }]}
              submitLabel={t("console.cost.save")}
              pendingLabel={t("console.saving")}
              variant="secondary"
              success={t("console.saved")}
              refreshOnSuccess
            />
          </div>
        </Section>
      </>
    );
  } else if (tab === "switch") {
    body = (
      <>
        <Section title={t("console.switch.title")} level={2}>
          <DescriptionList
            cols={3}
            items={[
              { term: t("console.switch.state"), value: <Tag tone={phaseTone}>{t(`console.switch.phase.${mon.view.phase}`)}</Tag> },
              { term: t("console.switch.noticeStart"), value: mon.view.noticeStartsAt ? formatDate(mon.view.noticeStartsAt, ctx.locale) : "—" },
              { term: t("console.switch.effective"), value: mon.view.effectiveAt ? formatDate(mon.view.effectiveAt, ctx.locale) : "—" },
            ]}
          />
          <p className="ed-muted">{t(`console.switch.about.${mon.view.phase}`, { days: NOTICE_DAYS })}</p>
          {mon.reminders.length > 0 ? (
            <ol className={styles.timeline} aria-label={t("console.switch.timeline")}>
              {mon.reminders.map((r) => (
                <li key={r.daysBefore}>
                  <span>{formatDate(r.at, ctx.locale)}</span>
                  <span>{t("console.switch.reminder", { days: r.daysBefore })}</span>
                  <span>{r.sentAt ? <Tag tone="success">{t("console.switch.sent", { count: r.businesses ?? 0 })}</Tag> : <Tag>{t("console.switch.planned")}</Tag>}</span>
                </li>
              ))}
              <li>
                <span>{formatDate(mon.view.effectiveAt!, ctx.locale)}</span>
                <span>{t("console.switch.takesEffect")}</span>
                <span />
              </li>
            </ol>
          ) : null}
        </Section>

        <div className={styles.grid}>
          <Section title={t("console.acceptance.title")} level={2}>
            <div className={styles.narrow}>
              <p className="ed-muted">{t("console.acceptance.body")}</p>
              {mon.acceptance ? (
                <Notice tone="success" title={t("console.acceptance.recorded", { date: formatDateTime(mon.acceptance.at, ctx.locale) })}>
                  <span className={styles.pre}>
                    {mon.acceptance.evidenceRef}
                    {mon.acceptance.notes ? `\n${mon.acceptance.notes}` : ""}
                  </span>
                </Notice>
              ) : (
                <Notice tone="attention" title={t("console.acceptance.missing")} />
              )}
              <SpecForm
                action={recordAcceptanceAction}
                fields={[
                  { kind: "text", name: "evidenceRef", label: t("console.acceptance.evidence"), hint: t("console.acceptance.evidenceHint"), required: true, maxLength: 300 },
                  { kind: "textarea", name: "notes", label: t("console.acceptance.notes"), rows: 3, maxLength: 2000, optionalLabel: c("optional") },
                ]}
                submitLabel={t("console.acceptance.record")}
                pendingLabel={t("console.saving")}
                variant="secondary"
                success={t("console.saved")}
                refreshOnSuccess
              />
            </div>
          </Section>

          <Section title={mon.view.state === "on" ? t("console.switch.disableTitle") : t("console.switch.enableTitle")} level={2}>
            <div className={styles.narrow}>
              {mon.view.state === "off" ? (
                <>
                  <p className="ed-muted">{t("console.switch.enableBody", { days: NOTICE_DAYS })}</p>
                  {mon.singleOperator ? <Notice tone="attention" title={t("console.switch.singleOperator")} /> : null}
                  {!mon.acceptance ? <Notice tone="attention" title={t("console.switch.needsAcceptance")} /> : null}
                </>
              ) : (
                <p className="ed-muted">{t("console.switch.disableBody")}</p>
              )}
              {!canRequest ? (
                <p className="ed-muted">{t("console.switch.requesterOnly")}</p>
              ) : mon.view.state === "on" || (mon.acceptance && !mon.singleOperator) ? (
                <SpecForm
                  action={mon.view.state === "on" ? requestDisableAction : requestEnableAction}
                  fields={[{ kind: "textarea", name: "reason", label: t("console.reason"), hint: t("console.reasonHint"), required: true, rows: 3, maxLength: 1000 }]}
                  submitLabel={mon.view.state === "on" ? t("console.switch.requestDisable") : t("console.switch.requestEnable")}
                  pendingLabel={t("console.requesting")}
                  success={
                    <>
                      {t("console.requested")} <Link href="/console/approvals">{t("console.openApprovals")}</Link>
                    </>
                  }
                  refreshOnSuccess
                />
              ) : null}
            </div>
          </Section>
        </div>

        <Section title={t("console.history.title")} level={2}>
          {mon.history.length === 0 ? (
            <EmptyState title={t("console.history.empty")} />
          ) : (
            <div className={styles.rel}>
              <Table caption={t("console.history.title")}>
                <thead>
                  <tr>
                    <th scope="col">{t("console.history.when")}</th>
                    <th scope="col">{t("console.history.change")}</th>
                    <th scope="col">{t("console.history.requester")}</th>
                    <th scope="col">{t("console.history.approvers")}</th>
                    <th scope="col">{t("console.switch.noticeStart")}</th>
                    <th scope="col">{t("console.switch.effective")}</th>
                  </tr>
                </thead>
                <tbody>
                  {mon.history.map((h) => (
                    <tr key={h.id}>
                      <td>{formatDateTime(h.at, ctx.locale)}</td>
                      <td>{t(`console.history.changes.${h.change}`)}</td>
                      <td>{h.requestedByStaffId.slice(-6)}</td>
                      <td>{h.approverStaffIds.map((x) => x.slice(-6)).join(", ")}</td>
                      <td>{h.noticeStartsAt ? formatDate(h.noticeStartsAt, ctx.locale) : "—"}</td>
                      <td>{h.effectiveAt ? formatDate(h.effectiveAt, ctx.locale) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Section>
      </>
    );
  } else if (tab === "billing") {
    const [o, slots, cats, cos] = await Promise.all([getCommercialOverview(ctx), listFeaturedSlots(ctx), listCategories(ctx), listCounties(ctx)]);
    const on = mon.view.phase === "on";
    body = (
      <>
        <Section title={t("console.processor.title")} level={2}>
          <DescriptionList
            cols={3}
            items={[
              { term: t("console.processor.key"), value: o.processor.keyPresent ? <Tag tone="success">{t("console.processor.present")}</Tag> : <Tag>{t("console.processor.absent")}</Tag> },
              { term: t("console.processor.webhook"), value: o.processor.webhookSecretPresent ? <Tag tone="success">{t("console.processor.present")}</Tag> : <Tag>{t("console.processor.absent")}</Tag> },
              { term: t("console.processor.mode"), value: o.processor.testMode ? t("console.processor.test") : t("console.processor.live") },
            ]}
          />
          <p className="ed-muted">{t("console.processor.body")}</p>
          <div className={styles.narrow}>
            {o.processor.keyPresent && o.processor.testMode ? <SandboxCheckout /> : <p className="ed-muted">{t("console.sandbox.unavailable")}</p>}
          </div>
        </Section>

        <Section title={t("console.subs.title")} level={2}>
          {!on ? <p className="ed-muted">{t("console.subs.offNote")}</p> : null}
          {o.subscriptions.length === 0 ? (
            <EmptyState title={t("console.subs.empty")} />
          ) : (
            <div className={styles.rel}>
              <Table caption={t("console.subs.title")}>
                <thead>
                  <tr>
                    <th scope="col">{t("console.subs.business")}</th>
                    <th scope="col">{t("console.subs.plan")}</th>
                    <th scope="col">{t("console.subs.status")}</th>
                    <th scope="col">{t("console.subs.periodEnd")}</th>
                    <th scope="col">{t("console.subs.id")}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.subscriptions.map((s) => (
                    <tr key={s.id}>
                      <td className={styles.cell}>{s.businessName}</td>
                      <td>
                        {t(`paid.planNames.${s.plan}`)} {s.sandbox ? <Tag>{t("console.subs.sandbox")}</Tag> : null}
                      </td>
                      <td>
                        <Tag tone={s.status === "active" ? "success" : s.status === "canceled" ? "neutral" : "attention"}>{t(`paid.status.${s.status}`)}</Tag>
                      </td>
                      <td>{s.status === "grace" && s.graceUntil ? formatDate(s.graceUntil, ctx.locale) : s.currentPeriodEnd ? formatDate(s.currentPeriodEnd, ctx.locale) : "—"}</td>
                      <td>{s.id}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Section>

        {o.invoices.length > 0 ? (
          <Section title={t("console.invoices.title")} level={2}>
            <div className={styles.rel}>
              <Table caption={t("console.invoices.title")}>
                <thead>
                  <tr>
                    <th scope="col">{t("console.invoices.number")}</th>
                    <th scope="col">{t("console.invoices.fiscalRef")}</th>
                    <th scope="col">{t("console.subs.status")}</th>
                    <th scope="col" data-num>
                      {t("paid.col.net")}
                    </th>
                    <th scope="col" data-num>
                      {t("console.invoices.tva")}
                    </th>
                    <th scope="col" data-num>
                      {t("paid.col.gross")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {o.invoices.map((i) => (
                    <tr key={i.id}>
                      <td>{i.number ?? "—"}</td>
                      <td className={styles.cell}>{i.fiscalRef ?? "—"}</td>
                      <td>{t(`console.invoices.status.${i.status}`)}</td>
                      <td data-num className="ed-num">
                        {money(i.netMinor)}
                      </td>
                      <td data-num className="ed-num">
                        {money(i.tvaMinor)}
                      </td>
                      <td data-num className="ed-num">
                        {money(i.grossMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Section>
        ) : null}

        {on ? (
          <>
            <Section title={t("console.refunds.title")} level={2}>
              {o.refunds.length === 0 ? (
                <EmptyState title={t("console.refunds.empty")} />
              ) : (
                <div className={styles.rel}>
                  <Table caption={t("console.refunds.title")}>
                    <thead>
                      <tr>
                        <th scope="col">{t("console.history.when")}</th>
                        <th scope="col">{t("console.refunds.kind")}</th>
                        <th scope="col" data-num>
                          {t("console.refunds.amount")}
                        </th>
                        <th scope="col">{t("console.subs.status")}</th>
                        <th scope="col">{t("console.reason")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.refunds.map((r) => (
                        <tr key={r.id}>
                          <td>{formatDate(r.createdAt, ctx.locale)}</td>
                          <td>{t(`console.refunds.kinds.${r.kind}`)}</td>
                          <td data-num className="ed-num">
                            {money(r.amountMinor)}
                          </td>
                          <td>
                            <Tag tone={r.state === "done" ? "success" : r.state === "rejected" ? "danger" : "attention"}>{t(`console.refunds.states.${r.state}`)}</Tag>
                          </td>
                          <td className={styles.cell}>{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
              {canRequest ? (
                <div className={styles.narrow}>
                  <h3>{t("console.refunds.requestTitle")}</h3>
                  {mon.singleOperator ? (
                    <Notice tone="attention" title={t("console.switch.singleOperator")} />
                  ) : (
                    <SpecForm
                      action={requestRefundAction}
                      fields={[
                        { kind: "text", name: "subscriptionId", label: t("console.refunds.subscription"), hint: t("console.refunds.subscriptionHint"), required: true, maxLength: 64 },
                        { kind: "chips", name: "kind", label: t("console.refunds.kind"), required: true, defaultValue: "refund", options: [{ value: "refund", label: t("console.refunds.kinds.refund") }, { value: "credit", label: t("console.refunds.kinds.credit") }] },
                        { kind: "number", name: "amount", label: t("console.refunds.amount"), hint: t("console.cost.amountHint"), required: true, maxLength: 12 },
                        { kind: "textarea", name: "reason", label: t("console.reason"), hint: t("console.reasonHint"), required: true, rows: 3, maxLength: 1000 },
                      ]}
                      submitLabel={t("console.refunds.request")}
                      pendingLabel={t("console.requesting")}
                      variant="secondary"
                      success={
                        <>
                          {t("console.requested")} <Link href="/console/approvals">{t("console.openApprovals")}</Link>
                        </>
                      }
                      refreshOnSuccess
                    />
                  )}
                </div>
              ) : null}
            </Section>

            <Section title={t("console.featured.title")} level={2}>
              <p className="ed-muted">{t("console.featured.body")}</p>
              {slots.length === 0 ? (
                <EmptyState title={t("console.featured.empty")} />
              ) : (
                <div className={styles.rel}>
                  <Table caption={t("console.featured.title")}>
                    <thead>
                      <tr>
                        <th scope="col">{t("console.featured.listing")}</th>
                        <th scope="col">{t("console.featured.category")}</th>
                        <th scope="col">{t("console.featured.county")}</th>
                        <th scope="col">{t("console.featured.until")}</th>
                        <th scope="col" aria-label={t("console.featured.end")} />
                      </tr>
                    </thead>
                    <tbody>
                      {slots.map((s) => (
                        <tr key={s.id}>
                          <td className={styles.cell}>{s.listingName}</td>
                          <td>{cats.find((x) => x.id === s.categoryId)?.name ?? s.categoryId}</td>
                          <td>{s.countyCode ? (cos.find((x) => x.code === s.countyCode)?.name ?? s.countyCode) : t("console.featured.allCounties")}</td>
                          <td>{s.endsAt ? formatDate(s.endsAt, ctx.locale) : "—"}</td>
                          <td>
                            <ActionForm action={endFeaturedSlotAction} hidden={{ slotId: s.id }} refreshOnSuccess variant="danger-quiet" block={false} submitLabel={t("console.featured.end")} pendingLabel={t("console.saving")} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
              <div className={styles.narrow}>
                <h3>{t("console.featured.addTitle")}</h3>
                <SpecForm
                  action={createFeaturedSlotAction}
                  fields={[
                    { kind: "text", name: "listingId", label: t("console.featured.listingId"), hint: t("console.featured.listingIdHint"), required: true, maxLength: 64 },
                    { kind: "select", name: "categoryId", label: t("console.featured.category"), required: true, placeholder: t("console.choose"), options: cats.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name })) },
                    { kind: "select", name: "countyCode", label: t("console.featured.county"), placeholder: t("console.featured.allCounties"), options: cos.filter((x) => x.active).map((x) => ({ value: x.code, label: x.name })) },
                    { kind: "number", name: "days", label: t("console.featured.days"), maxLength: 3, optionalLabel: c("optional") },
                  ]}
                  submitLabel={t("console.featured.add")}
                  pendingLabel={t("console.saving")}
                  variant="secondary"
                  success={t("console.saved")}
                  refreshOnSuccess
                />
              </div>
            </Section>
          </>
        ) : null}
      </>
    );
  } else {
    const o = await getCommercialOverview(ctx);
    const p = o.prices;
    const major = (v: number) => String(v / 100).replace(".", ",");
    body = (
      <Section title={t("console.prices.title")} level={2}>
        <p className="ed-muted">{t("console.prices.body")}</p>
        {!p.confirmed ? <Notice tone="attention" title={t("console.prices.placeholder")} /> : null}
        <div className={styles.narrow}>
          <Table caption={t("console.prices.title")}>
            <thead>
              <tr>
                <th scope="col">{t("paid.col.what")}</th>
                <th scope="col" data-num>
                  {t("paid.col.net")}
                </th>
                <th scope="col" data-num>
                  {t("paid.col.gross")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["businessMonthly", p.businessMonthlyMinor],
                  ["businessYearly", p.businessYearlyMinor],
                  ["featuredMonthly", p.featuredMonthlyMinor],
                ] as const
              ).map(([key, net]) => (
                <tr key={key}>
                  <td>{t(`paid.plans.${key}`)}</td>
                  <td data-num className="ed-num">
                    {money(net)}
                  </td>
                  <td data-num className="ed-num">
                    {money(net + Math.round((net * p.tvaRateBp) / 10_000))}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="ed-muted">{t("console.prices.tvaNow", { rate: major(p.tvaRateBp) })}</p>
          {canRequest ? (
            <SpecForm
              action={requestPriceChangeAction}
              fields={[
                { kind: "number", name: "businessMonthly", label: t("console.prices.businessMonthly"), required: true, maxLength: 12, defaultValue: major(p.businessMonthlyMinor) },
                { kind: "number", name: "businessYearly", label: t("console.prices.businessYearly"), required: true, maxLength: 12, defaultValue: major(p.businessYearlyMinor) },
                { kind: "number", name: "featuredMonthly", label: t("console.prices.featuredMonthly"), required: true, maxLength: 12, defaultValue: major(p.featuredMonthlyMinor) },
                { kind: "number", name: "tva", label: t("console.prices.tva"), hint: t("console.prices.tvaHint"), required: true, maxLength: 5, defaultValue: major(p.tvaRateBp) },
                { kind: "textarea", name: "reason", label: t("console.reason"), hint: t("console.reasonHint"), required: true, rows: 3, maxLength: 1000 },
              ]}
              submitLabel={t("console.prices.request")}
              pendingLabel={t("console.requesting")}
              variant="secondary"
              success={
                <>
                  {t("console.requested")} <Link href="/console/approvals">{t("console.openApprovals")}</Link>
                </>
              }
              refreshOnSuccess
            />
          ) : (
            <p className="ed-muted">{t("console.switch.requesterOnly")}</p>
          )}
        </div>
      </Section>
    );
  }

  return (
    <Page>
      <PageHeader title={t("console.title")} description={t("console.description")} actions={<Tag tone={phaseTone}>{t(`console.switch.phase.${mon.view.phase}`)}</Tag>} />
      <nav aria-label={t("console.tabsLabel")}>
        <ul className="ed-tabs">
          {TABS.map((x) => (
            <li key={x}>
              <Link className="ed-tab" href={x === "cost" ? "/console/commercial" : `/console/commercial?tab=${x}`} aria-current={x === tab ? "page" : undefined}>
                {t(`console.tabs.${x}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.body}>{body}</div>
    </Page>
  );
}
